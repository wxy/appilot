import { log } from "../engine/logger";
import { powerMonitor } from "electron";
import { notifyDataChanged } from "./data-sync";
import {
  enrichKeywordFromSnapshots,
  evaluatePause,
  normalizeTrackedKeyword,
} from "../engine/rank-keywords";
import { appendRankSnapshots } from "../engine/rank-snapshots";
import { storefrontsForLanguage } from "../engine/storefronts";
import { resolveEffectiveCredentials } from "./credentials";
import {
  ensureProjectKeywordPool,
  findProductContext,
  getStoreSubmissionDrafts,
  isProductPostRelease,
  migrateLegacyStoreProducts,
  normalizeDraftIdentity,
} from "./project-state";
import {
  buildStatusTaskId,
  bootstrapRoundState,
  markRoundTaskDone,
  nextRunAt,
  nextRankRunAt,
  nextRunWithinMinutes,
  rebalanceCollapsedTasks,
  opsSyncTaskId,
  prioritizeGroupCompletion,
  pruneRoundMembers,
  rankGroupKey,
  reviewsSyncTaskId,
  seedScheduledTask,
  type SchedulerRoundState,
} from "./schedule";
import { getStore } from "./store";
import type { AppStore } from "./store";

interface ScheduledTaskBase {
  id: string;
  intervalMinutes: number;
  nextRunAt: string;
  lastRunAt?: string | null;
  firstRunAt?: string | null;
  executionCount: number;
  lastStatus?: "success" | "failed";
  enabled: boolean;
  consecutiveFailures?: number;
}

interface RankScheduledTask extends ScheduledTaskBase {
  kind: "rank";
  productId: string;
  keyword: string;
  queryLanguage: string;
  storefront: string;
  groupKey: string;
  lastDurationMs?: number;
}

interface GithubSyncTask extends ScheduledTaskBase {
  kind: "github-sync";
  projectId: string;
  lastDurationMs?: number;
}

interface OpsSyncTask extends ScheduledTaskBase {
  kind: "ops-sync";
  projectId: string;
  lastDurationMs?: number;
}

interface ReviewsSyncTask extends ScheduledTaskBase {
  kind: "reviews-sync";
  productId: string;
  lastDurationMs?: number;
}

interface BuildStatusTask extends ScheduledTaskBase {
  kind: "build-status";
  productId: string;
  lastDurationMs?: number;
}

export type ScheduledTask =
  | RankScheduledTask
  | GithubSyncTask
  | OpsSyncTask
  | ReviewsSyncTask
  | BuildStatusTask;

export interface RunningTaskInfo {
  kind?: "rank" | "github-sync" | "ops-sync" | "reviews-sync" | "build-status";
  keyword: string;
  language: string;
  storefront: string;
  startedAt: string;
}

let schedulerTimer: NodeJS.Timeout | null = null;
let schedulerRunning = false;
let overdueScattered = false;
let powerListenersRegistered = false;
/** How many rank tasks one scheduler tick may execute (throughput vs load). */
const MAX_RANK_TASKS_PER_TICK = 8;
const TICK_INTERVAL_MS = 60_000;
const TICK_INTERVAL_ACCEL_MS = 10_000;
const TASK_BREAK_MS = 1500;
const TASK_BREAK_ACCEL_MS = 200;
const ACCEL_MAX_ROUNDS = 6;
const ACCEL_MAX_TASKS_PER_TICK = 40;
const ACCEL_AUTO_OFF_MS = 5 * 60_000;
let schedulerPaused = false;
// 单次加速会话中已处理过的任务：添油时跳过，避免执行后被推回未来的任务被反复拉取。
let accelHandledTaskIds = new Set<string>();
// 执行记录的写入链：调度 tick 与手动触发并发写时保证串行，避免互相覆盖
// 导致统计（流量/入榜率）忽清忽恢复。
let executionsWriteChain: Promise<void> = Promise.resolve();
function appendExecution(store: AppStore, entry: Record<string, any>): Promise<void> {
  executionsWriteChain = executionsWriteChain
    .catch(() => undefined)
    .then(() => {
      const executions: any[] = Array.isArray(store.get("rankExecutions"))
        ? store.get("rankExecutions")
        : [];
      executions.push(entry);
      // 加速会话可能一次写上千条；5000 上限会截断近 24h 数据导致
      // 流量/入榜率统计波动（"清零又恢复"）。上限放宽并保留足够窗口。
      store.set("rankExecutions", executions.slice(-20000));
    });
  return executionsWriteChain;
}
/** What the scheduler is executing right now (for the timeline UI). */
let nowRunningTask: RunningTaskInfo | null = null;

export function isSchedulerTimerActive(): boolean {
  return Boolean(schedulerTimer);
}

export function schedulerStatusSnapshot(): {
  running: boolean;
  nowRunning: RunningTaskInfo | null;
} {
  return { running: schedulerRunning, nowRunning: nowRunningTask };
}

/**
 * Runs per day for rank tasks. Currently fixed at 1 (one unique
 * keyword × language × platform × storefront combo per day); the knob is
 * read from the store so a future settings UI can raise it without touching
 * the scheduler core.
 */
function rankRunsPerDay(store: AppStore): number {
  const value = store.get("rankRunsPerDay");
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(48, Math.floor(value)));
}

function rankTaskId(productId: string, keyword: string, queryLanguage: string, storefront: string): string {
  return `${productId}:${queryLanguage}:${storefront}:${keyword}`;
}

function taskSeed(task: Pick<RankScheduledTask, "productId" | "keyword" | "queryLanguage" | "storefront">): string {
  return [task.productId, task.queryLanguage, task.storefront, task.keyword].join(":");
}

function githubSyncTaskId(projectId: string): string {
  return `github-sync:${projectId}`;
}

/**
 * Bump when the shape of the cached PR list changes (e.g. new fields like
 * titles/commit counts/commit shas). Entries written by older builds must not
 * be trusted — the workbench would otherwise reuse an empty/stale PR list
 * instead of fetching fresh data.
 */
const GITHUB_SYNC_CACHE_PR_SCHEMA = 2;

/** Fresh pre-warmed GitHub data for a project, or null when stale/mismatched. */
export function githubSyncCacheEntry(
  s: any,
  project: any,
): {
  tag: string | null;
  release: any | null;
  pullRequests: any[];
  releases: any[];
} | null {
  const all = s.get("githubSyncCache") || {};
  const entry = all?.[project?.id];
  if (!entry) return null;
  if (new Date(entry.syncedAt).getTime() < Date.now() - 60 * 60_000) return null;
  if ((entry.lastSeenSha || null) !== (project?.lastReleaseSha || null)) return null;
  const pullRequests =
    entry.prSchemaVersion === GITHUB_SYNC_CACHE_PR_SCHEMA
      ? entry.pullRequests || []
      : [];
  return {
    tag: entry.tag ?? null,
    release: entry.release ?? null,
    pullRequests,
    releases: Array.isArray(entry.releases) ? entry.releases : [],
  };
}

// 按产品平台决定搜索实体：macOS 商店用 macSoftware，iOS 商店用 software。
// 不能用 lookup 的 kind 猜测——universal app 的 kind 常是 software，
// 导致 macOS 产品错误地采集 iOS 商店的排名（两个平台数据相同）。
function resolveRankEntity(product: any): "software" | "macSoftware" {
  return product?.platform === "macos" ? "macSoftware" : "software";
}

async function reconcileRankTasks(store: AppStore): Promise<void> {
  const projects: any[] = (store.get("projects") || []).map(migrateLegacyStoreProducts);
  for (const project of projects) ensureProjectKeywordPool(project);
  store.set("projects", projects);
  const existing: ScheduledTask[] = store.get("scheduledTasks") || [];
  const activeKeys = new Set<string>();
  const desiredTasks = new Map<string, ScheduledTask>();
  const runsPerDay = rankRunsPerDay(store);

  for (const project of projects) {
    const pool: any[] = (project.trackedKeywords || []).map((item: any) =>
      normalizeTrackedKeyword(item),
    );
    const poolBefore = JSON.stringify(pool);
    const storeProducts: any[] = project.storeProducts || [];
    for (const product of storeProducts) {
      if (!product.trackId) continue;
      if (!isProductPostRelease(project, product)) continue;
      const snapshots = Array.isArray(product.rankSnapshots) ? product.rankSnapshots : [];
      const platformKey = product.platform || "unknown";

      // The shared pool is queried per platform. 自动暂停已取消：连续未在榜
      // 的关键词先进入“待处理暂停”复核队列（pendingPausePlatforms），由用户
      // 在排名页分类处理；最终暂停（pausedPlatforms）只由用户操作产生。
      for (const localization of product.supportedLanguages || []) {
        const localizationCode = localization.code;
        const queryLanguages = localizationCode === "en" ? ["en"] : [localizationCode, "en"];
        for (const keyword of pool) {
          if (keyword.status === "paused") continue;
          const evaluated = evaluatePause(
            enrichKeywordFromSnapshots(keyword, snapshots),
            snapshots,
            undefined,
            // 复核/恢复后只统计新快照，避免处理完立刻又回到复核队列。
            keyword.pauseReviewedAt
              ? new Date(keyword.pauseReviewedAt)
              : undefined,
          );
          const pendingPlatforms = Array.isArray(keyword.pendingPausePlatforms)
            ? keyword.pendingPausePlatforms
            : [];
          const pausedPlatforms = Array.isArray(keyword.pausedPlatforms)
            ? keyword.pausedPlatforms
            : [];
          if (
            evaluated.status === "pending-pause" &&
            !pendingPlatforms.includes(platformKey) &&
            // 已最终暂停的平台不再重新进入复核队列。
            !pausedPlatforms.includes(platformKey)
          ) {
            keyword.pendingPausePlatforms = [...pendingPlatforms, platformKey];
            keyword.pendingPauseReason = evaluated.pausedReason || null;
          } else if (
            evaluated.status !== "pending-pause" &&
            pendingPlatforms.includes(platformKey)
          ) {
            // 排名恢复后自动解除待处理状态。
            keyword.pendingPausePlatforms = pendingPlatforms.filter(
              (item: string) => item !== platformKey,
            );
            if ((keyword.pendingPausePlatforms || []).length === 0) {
              keyword.pendingPauseReason = null;
            }
          }
          if (
            (keyword.pendingPausePlatforms || []).includes(platformKey) ||
            (keyword.pausedPlatforms || []).includes(platformKey)
          ) {
            continue;
          }
          if (!queryLanguages.includes(keyword.language)) continue;
          for (const storefront of storefrontsForLanguage(localizationCode)) {
            const id = rankTaskId(product.id, keyword.keyword, keyword.language, storefront);
            activeKeys.add(id);
            const previous = existing.find((task) => task.id === id);
            desiredTasks.set(id, {
              id,
              kind: "rank",
              productId: product.id,
              keyword: keyword.keyword,
              queryLanguage: keyword.language,
              storefront,
              groupKey: rankGroupKey(product.id, product.platform, keyword.language, storefront),
              intervalMinutes: Math.floor((24 * 60) / runsPerDay),
              nextRunAt: previous?.nextRunAt || nextRankRunAt(taskSeed({ productId: product.id, keyword: keyword.keyword, queryLanguage: keyword.language, storefront }), runsPerDay),
              lastRunAt: previous?.lastRunAt ?? null,
              firstRunAt: previous?.firstRunAt ?? null,
              executionCount: previous?.executionCount || 0,
              lastStatus: previous?.lastStatus,
              enabled: previous?.enabled ?? true,
              consecutiveFailures: previous?.consecutiveFailures || 0,
              lastDurationMs: previous?.lastDurationMs,
            });
          }
        }
      }
    }
    if (JSON.stringify(pool) !== poolBefore) {
      project.trackedKeywords = pool;
    }
  }

  const next = existing
    // Rank tasks are re-derived below; github-sync tasks are reconciled
    // separately and ops/reviews/build-status tasks are reconciled by
    // reconcileOpsTasks. All of them must survive this pass; drop only stale
    // rank kinds.
    .filter((task) =>
      task.kind === "github-sync" ||
      task.kind === "ops-sync" ||
      task.kind === "reviews-sync" ||
      task.kind === "build-status" ||
      (task.kind === "rank" && activeKeys.has(task.id)),
    )
    .map((task) => desiredTasks.get(task.id) || task);
  for (const task of desiredTasks.values()) {
    if (!next.some((existingTask) => existingTask.id === task.id)) {
      next.push(task);
    }
  }

  store.set("scheduledTasks", next);
  store.set("projects", projects);
  reconcileSchedulerRounds(store, next);
}

/**
 * Keep the per-group round state in sync with the current task membership.
 * Round progress is per product × platform × language × storefront: a round
 * completes when every keyword task in that group has run successfully.
 */
function reconcileSchedulerRounds(store: AppStore, tasks: ScheduledTask[]): void {
  const groups = new Map<string, ScheduledTask[]>();
  for (const task of tasks) {
    if (task.kind !== "rank" || !task.groupKey) continue;
    const list = groups.get(task.groupKey) || [];
    list.push(task);
    groups.set(task.groupKey, list);
  }
  const rounds: Record<string, SchedulerRoundState> = store.get("schedulerRounds") || {};
  const nextRounds: Record<string, SchedulerRoundState> = {};
  for (const [groupKey, groupTasks] of groups) {
    const memberIds = groupTasks.map((task) => task.id);
    const previous = rounds[groupKey];
    if (previous) {
      nextRounds[groupKey] = pruneRoundMembers(previous, memberIds);
    } else {
      nextRounds[groupKey] = bootstrapRoundState(groupTasks);
    }
  }
  store.set("schedulerRounds", nextRounds);
}

/**
 * One per-project background task that keeps the GitHub data cache warm:
 * fetch remote tags (never touches the worktree), then refresh the release
 * announcement + PR info cache so opening the workbench does not wait on the
 * GitHub API. The cache is consumed by checkForRelease via `githubCache`.
 */
async function reconcileGithubSyncTasks(store: AppStore): Promise<void> {
  const projects: any[] = store.get("projects") || [];
  const existing: ScheduledTask[] = store.get("scheduledTasks") || [];
  const desired = new Map<string, GithubSyncTask>();
  for (const project of projects) {
    if (!project?.repo?.githubUrl) continue;
    const id = githubSyncTaskId(project.id);
    const previous = existing.find((task) => task.id === id) as
      | GithubSyncTask
      | undefined;
    desired.set(id, {
      id,
      kind: "github-sync",
      projectId: project.id,
      intervalMinutes: previous?.intervalMinutes || 60,
      nextRunAt: previous?.nextRunAt || nextRunAt(id, 60),
      lastRunAt: previous?.lastRunAt ?? null,
      firstRunAt: previous?.firstRunAt ?? null,
      executionCount: previous?.executionCount || 0,
      lastStatus: previous?.lastStatus,
      enabled: previous?.enabled ?? true,
      consecutiveFailures: previous?.consecutiveFailures || 0,
      lastDurationMs: previous?.lastDurationMs,
    });
  }
  const next: ScheduledTask[] = [
    ...existing.filter((task) =>
      task.kind === "rank" ||
      task.kind === "ops-sync" ||
      task.kind === "reviews-sync" ||
      task.kind === "build-status",
    ),
    ...Array.from(desired.values()),
  ];
  store.set("scheduledTasks", next);
}

async function reconcileOpsTasks(store: AppStore): Promise<void> {
  const projects: any[] = (store.get("projects") || []).map(migrateLegacyStoreProducts);
  const existing: ScheduledTask[] = store.get("scheduledTasks") || [];
  const desired = new Map<string, ScheduledTask>();

  for (const project of projects) {
    if (!project?.localPath) continue;
    desired.set(
      opsSyncTaskId(project.id),
      seedScheduledTask(existing, {
        id: opsSyncTaskId(project.id),
        kind: "ops-sync",
        projectId: project.id,
        intervalMinutes: 24 * 60,
      }),
    );
    for (const product of project.storeProducts || []) {
      if (!product?.trackId || !isProductPostRelease(project, product)) continue;
      desired.set(
        reviewsSyncTaskId(product.id),
        seedScheduledTask(existing, {
          id: reviewsSyncTaskId(product.id),
          kind: "reviews-sync",
          productId: product.id,
          intervalMinutes: 24 * 60,
        }),
      );
      // Version status is derived from ASC data, so poll it whenever the
      // product has a copy draft — but only with complete ASC credentials.
      const creds = resolveEffectiveCredentials(store, project.id);
      const hasAscCredential = Boolean(
        creds.ascIssuerId && creds.ascKeyId && creds.ascPrivateKeyPath,
      );
      const hasDraft = getStoreSubmissionDrafts(project).some(
        (draft: any) => draft.productId === product.id,
      );
      if (hasAscCredential && hasDraft) {
        desired.set(
          buildStatusTaskId(product.id),
          seedScheduledTask(existing, {
            id: buildStatusTaskId(product.id),
            kind: "build-status",
            productId: product.id,
            intervalMinutes: 60,
          }),
        );
      }
    }
  }

  const next: ScheduledTask[] = [
    ...existing.filter((task) => !desired.has(task.id)),
    ...Array.from(desired.values()),
  ];
  store.set("scheduledTasks", next);
}

async function runRankTask(store: AppStore, task: RankScheduledTask): Promise<void> {
  const projects: any[] = store.get("projects") || [];
  let product: any = null;
  let project: any = null;
  for (const candidateProject of projects) {
    const candidate = (candidateProject.storeProducts || []).find(
      (item: any) => item.id === task.productId,
    );
    if (candidate) {
      project = candidateProject;
      product = candidate;
      break;
    }
  }
  if (!project || !product?.trackId) return;

  const pool = ensureProjectKeywordPool(project).trackedKeywords || [];
  const isActive = pool.some(
    (keyword: any) =>
      keyword.keyword === task.keyword &&
      keyword.language === task.queryLanguage &&
      keyword.status !== "paused" &&
      !(keyword.pendingPausePlatforms || []).includes(
        product.platform || "unknown",
      ) &&
      !(keyword.pausedPlatforms || []).includes(product.platform || "unknown"),
  );
  if (!isActive) {
    task.enabled = false;
    task.lastStatus = "failed";
    return;
  }

  const { searchAppStoreRank } = await import("../engine/rank-collector");
  const entity = await resolveRankEntity(product);
  const startedAt = Date.now();
  nowRunningTask = {
    keyword: task.keyword,
    language: task.queryLanguage,
    storefront: task.storefront,
    startedAt: new Date().toISOString(),
  };
  let durationMs = 0;
  let requestBytes = 0;
  let responseBytes = 0;
  let rank: number | null = null;
  let status: "success" | "failed" = "success";
  let snapshot: any = null;
  try {
    // 关联该 (关键词, 语言) 的竞品：同一次搜索顺带定位它们的排名。
    const competitors =
      (store.get("competitors") || {})[project.id] || [];
    const linkedCompetitors = competitors.filter((competitor: any) =>
      (competitor.linkedKeywords || []).some(
        (link: any) =>
          link.keyword === task.keyword &&
          link.language === task.queryLanguage,
      ),
    );
    // 只传与当前产品平台一致的竞品 trackId：iOS 产品用 software 实体搜索，
    // macOS 产品用 macSoftware，避免把另一平台的列表拿来对比。
    const { competitorTrackIdFor, migrateCompetitor } = await import(
      "../engine/competitor-radar"
    );
    const entityPlatform: "ios" | "macos" =
      product?.platform === "macos" ? "macos" : "ios";
    const candidateTrackIds = linkedCompetitors
      .map((competitor: any) =>
        competitorTrackIdFor(migrateCompetitor(competitor), entityPlatform),
      )
      .filter(Boolean);
    const result = await searchAppStoreRank({
      term: task.keyword,
      country: task.storefront,
      trackId: product.trackId,
      entity,
      candidateTrackIds: candidateTrackIds.length > 0 ? candidateTrackIds : undefined,
    });
    durationMs = result.durationMs;
    requestBytes = result.requestBytes;
    responseBytes = result.responseBytes;
    rank = result.rank;
    snapshot = {
      keyword: task.keyword,
      language: task.queryLanguage,
      storefront: task.storefront,
      rank: result.rank,
      totalResults: result.totalResults,
      checkedAt: new Date().toISOString(),
    };
    if (linkedCompetitors.length > 0 && result.candidateRanks) {
      const ranksAll: Record<string, Record<string, any[]>> =
        store.get("competitorRankSnapshots") || {};
      const rankById: Record<string, any[]> = ranksAll[project.id] || {};
      const checkedAt = new Date().toISOString();
      for (const competitor of linkedCompetitors) {
        const competitorTrackId = competitorTrackIdFor(
          migrateCompetitor(competitor),
          entityPlatform,
        );
        // 该竞品未在当前平台（iOS/macOS）上架：不写排名条目，界面按
        // trackIds 判定为“未上架”，而不是误显示“未上榜”。
        if (!competitorTrackId) continue;
        const entry = {
          keyword: task.keyword,
          language: task.queryLanguage,
          storefront: task.storefront,
          platform: entityPlatform,
          rank: result.candidateRanks[competitorTrackId] ?? null,
          checkedAt,
        };
        // 同一 (关键词, 商店, 平台) 只保留最新一条。
        const prev = rankById[competitor.id] || [];
        rankById[competitor.id] = [
          ...prev.filter(
            (item: any) =>
              !(
                item.keyword === entry.keyword &&
                item.storefront === entry.storefront &&
                // 旧数据无 platform 字段，写入新条目时一并替换。
                (item.platform == null || item.platform === entry.platform)
              ),
          ),
          entry,
        ].slice(-300);
      }
      ranksAll[project.id] = rankById;
      store.set("competitorRankSnapshots", ranksAll);
      notifyDataChanged("competitors");
    }
    task.consecutiveFailures = 0;
    task.lastStatus = "success";
  } catch (err: any) {
    status = "failed";
    durationMs = Date.now() - startedAt;
    log.warn(`Scheduled rank task failed for "${task.keyword}" in ${task.storefront}: ${err.message}`);
    task.consecutiveFailures = (task.consecutiveFailures || 0) + 1;
    task.lastStatus = "failed";
    if (task.consecutiveFailures >= 5) {
      task.enabled = false;
    }
  } finally {
    nowRunningTask = null;
  }

  task.lastRunAt = new Date().toISOString();
  task.executionCount += 1;
  task.lastDurationMs = durationMs;
  await appendExecution(store, {
    ts: new Date().toISOString(),
    taskId: task.id,
    productId: task.productId,
    keyword: task.keyword,
    language: task.queryLanguage,
    storefront: task.storefront,
    status,
    rank,
    durationMs,
    requestBytes,
    responseBytes,
  });
  task.firstRunAt = task.firstRunAt || task.lastRunAt;
  task.nextRunAt =
    task.lastStatus === "failed"
      ? nextRunWithinMinutes(taskSeed(task), 30)
      : nextRankRunAt(taskSeed(task), rankRunsPerDay(store));
  // 在 nextRunAt 更新后再通知界面刷新，避免读取到旧排期。
  notifyDataChanged("tasks");

  if (task.lastStatus === "success") {
    const rounds: Record<string, SchedulerRoundState> = store.get("schedulerRounds") || {};
    const state = rounds[task.groupKey];
    if (state) {
      rounds[task.groupKey] = markRoundTaskDone(state, task.id).state;
      store.set("schedulerRounds", rounds);
    }
  }

  // Re-read the latest projects before writing: the product object captured at
  // task start may be stale after the network call (concurrent IPC handlers
  // can replace the whole array, e.g. projects:remove). Apply the snapshot to
  // the freshest copy so concurrent edits are not clobbered.
  const latestProjects: any[] = store.get("projects") || [];
  const latestProduct = latestProjects
    .flatMap((p: any) => p.storeProducts || [])
    .find((item: any) => item.id === task.productId);
  if (latestProduct && snapshot) {
    const previous = Array.isArray(latestProduct.rankSnapshots)
      ? latestProduct.rankSnapshots
      : [];
    latestProduct.rankSnapshots = appendRankSnapshots(previous, [snapshot]);
    store.set("projects", latestProjects);
    notifyDataChanged("rank");
  }
}

async function runGithubSyncTask(store: AppStore, task: GithubSyncTask): Promise<void> {
  const projects: any[] = store.get("projects") || [];
  const project = projects.find((item: any) => item.id === task.projectId) || null;
  const startedAt = Date.now();
  nowRunningTask = {
    kind: "github-sync",
    keyword: "GitHub 同步",
    language: "",
    storefront: "",
    startedAt: new Date().toISOString(),
  };
  let durationMs = 0;
  let requestBytes = 0;
  let responseBytes = 0;
  let status: "success" | "failed" = "success";
  try {
    if (!project?.localPath) throw new Error("Project not found");
    const { fetchRemoteTags, checkForRelease } = await import("../engine/release-watcher");
    const { listGitHubReleases } = await import("../engine/github-api");
    // Background sync must never touch the worktree or local branches: fetch
    // only updates remote-tracking refs and tags.
    await fetchRemoteTags(project.localPath);
    const token = resolveEffectiveCredentials(store, task.projectId).githubToken;
    // Best-effort GitHub releases listing (drafts included with token). Empty
    // on private repos without a token / offline — checkForRelease degrades to
    // local git tags.
    const githubReleases = await listGitHubReleases(
      project.localPath,
      token,
      (rb, pb) => {
        requestBytes += rb;
        responseBytes += pb;
      },
    );
    const result = await checkForRelease(
      project.localPath,
      project.lastReleaseSha || null,
      token,
      {
        sync: false,
        githubReleases,
        onApiStats: (rb, pb) => {
          requestBytes += rb;
          responseBytes += pb;
        },
      },
    );
    const release = result.latest || null;
    const material = release?.material || null;
    const all: Record<string, any> = store.get("githubSyncCache") || {};
    all[task.projectId] = {
      tag: release?.tag || null,
      release: material?.githubRelease ?? null,
      pullRequests: material?.pullRequests || [],
      prSchemaVersion: GITHUB_SYNC_CACHE_PR_SCHEMA,
      releases: githubReleases,
      lastSeenSha: project.lastReleaseSha || null,
      syncedAt: new Date().toISOString(),
    };
    store.set("githubSyncCache", all);
    notifyDataChanged("releases");
    task.consecutiveFailures = 0;
    task.lastStatus = "success";
  } catch (err: any) {
    status = "failed";
    durationMs = Date.now() - startedAt;
    log.warn(`Scheduled GitHub sync failed for ${task.projectId}: ${err.message}`);
    task.consecutiveFailures = (task.consecutiveFailures || 0) + 1;
    task.lastStatus = "failed";
    if (task.consecutiveFailures >= 5) {
      task.enabled = false;
    }
  } finally {
    nowRunningTask = null;
  }

  task.lastRunAt = new Date().toISOString();
  task.executionCount += 1;
  task.lastDurationMs = durationMs;
  await appendExecution(store, {
    ts: new Date().toISOString(),
    taskId: task.id,
    productId: task.projectId,
    kind: "github-sync",
    status,
    durationMs,
    requestBytes,
    responseBytes,
  });
  notifyDataChanged("tasks");
  task.firstRunAt = task.firstRunAt || task.lastRunAt;
  task.nextRunAt =
    task.lastStatus === "failed"
      ? nextRunWithinMinutes(task.id, 30)
      : nextRunAt(task.id, task.intervalMinutes || 60);
}

async function runOpsSyncTask(store: AppStore, task: OpsSyncTask): Promise<void> {
  const projects: any[] = store.get("projects") || [];
  const project = projects.find((item: any) => item.id === task.projectId) || null;
  const startedAt = Date.now();
  nowRunningTask = {
    kind: "ops-sync",
    keyword: "数据同步",
    language: "",
    storefront: "",
    startedAt: new Date().toISOString(),
  };
  let durationMs = 0;
  let status: "success" | "failed" = "success";
  try {
    if (!project?.localPath) throw new Error("Project not found");
    const token = resolveEffectiveCredentials(store, task.projectId).githubToken;
    const { fetchTrafficSnapshot } = await import("../engine/gh-traffic");
    const snapshot = await fetchTrafficSnapshot(project.localPath, token);
    const opsStatusStore: Record<string, any> = store.get("opsStatus") || {};
    const opsSyncedAt = new Date().toISOString();
    if (snapshot) {
      const syncEntry = githubSyncCacheEntry(store, project);
      if (syncEntry?.tag) {
        const { fetchReleaseAssetDownloads } = await import("../engine/gh-traffic");
        const assets = await fetchReleaseAssetDownloads(project.localPath, syncEntry.tag, token);
        if (assets) {
          snapshot.assetTag = assets.tag;
          snapshot.assetDownloads = assets.assets;
        }
      }
      const all: Record<string, any[]> = store.get("trafficSnapshots") || {};
      const list = all[task.projectId] || [];
      if (list[list.length - 1]?.date !== snapshot.date) {
        all[task.projectId] = [...list, snapshot].slice(-90);
        store.set("trafficSnapshots", all);
      }
      opsStatusStore[task.projectId] = { trafficError: null, lastSyncedAt: opsSyncedAt };
    } else {
      opsStatusStore[task.projectId] = {
        trafficError: token
          ? "GitHub 流量接口无数据（Token 需要仓库 Administration 只读权限，或仓库不可访问）"
          : "未配置 GitHub Token",
        lastSyncedAt: opsSyncedAt,
      };
    }
    store.set("opsStatus", opsStatusStore);

    const competitors: any[] = (store.get("competitors") || {})[task.projectId] || [];
    if (competitors.length > 0) {
      const {
        competitorPlatforms,
        fetchCompetitorSnapshot,
        migrateCompetitor,
      } = await import("../engine/competitor-radar");
      const { storefrontsForLanguage } = await import("../engine/storefronts");
      const all: Record<string, Record<string, any[]>> = store.get("competitorSnapshots") || {};
      const byId: Record<string, any[]> = all[task.projectId] || {};
      for (const competitor of competitors) {
        // 快照按竞品关联关键词的语言商店采集；无关联时回退美国区。
        const countries: string[] = Array.from(
          new Set(
            (competitor.linkedKeywords || []).flatMap(
              (link: any) => storefrontsForLanguage(link.language) || [],
            ),
          ),
        );
        const effectiveCountries: string[] =
          countries.length > 0 ? countries : ["us"];
        const list = byId[competitor.id] || [];
        // 按平台分别采集快照，与排名对齐；未在该平台上架的竞品不采。
        for (const platform of competitorPlatforms(migrateCompetitor(competitor))) {
          for (const country of effectiveCountries) {
            const snap = await fetchCompetitorSnapshot(
              competitor,
              token,
              country,
              platform,
            );
            const key = `${snap.date}\u0000${country}\u0000${platform}`;
            if (
              !list.some(
                (item: any) =>
                  `${item.date}\u0000${item.country}\u0000${item.platform}` === key,
              )
            ) {
              list.push(snap);
            }
          }
        }
        list.sort(
          (a: any, b: any) =>
            new Date(b.date).getTime() - new Date(a.date).getTime() ||
            String(a.country || "").localeCompare(String(b.country || "")) ||
            String(a.platform || "").localeCompare(String(b.platform || "")),
        );
        byId[competitor.id] = list.slice(0, 90 * 8 * 2);
      }
      all[task.projectId] = byId;
      store.set("competitorSnapshots", all);
      notifyDataChanged("competitors");
    }

    const { fetchIssues, mergeFeedbackItems, normalizeIssue, reviewsToFeedbackItems } =
      await import("../engine/feedback-inbox");
    const issues = await fetchIssues(project.localPath, token, 30);
    const reviewItems: any[] = [];
    const reviewsStore: Record<string, any> = store.get("reviews") || {};
    for (const product of project.storeProducts || []) {
      const perProduct = reviewsStore[product.id] || {};
      for (const country of Object.keys(perProduct)) {
        for (const review of perProduct[country]?.items || []) {
          reviewItems.push(...reviewsToFeedbackItems([review], product.id));
        }
      }
    }
    const feedbackStore: Record<string, any> = store.get("feedback") || {};
    const entry = feedbackStore[task.projectId] || { items: [], lastSyncedAt: null };
    feedbackStore[task.projectId] = {
      items: mergeFeedbackItems(entry.items, [...issues.map(normalizeIssue), ...reviewItems]),
      lastSyncedAt: new Date().toISOString(),
    };
    store.set("feedback", feedbackStore);
    notifyDataChanged("feedback");

    task.consecutiveFailures = 0;
    task.lastStatus = "success";
  } catch (err: any) {
    status = "failed";
    durationMs = Date.now() - startedAt;
    log.warn(`Scheduled ops sync failed for ${task.projectId}: ${err.message}`);
    task.consecutiveFailures = (task.consecutiveFailures || 0) + 1;
    task.lastStatus = "failed";
    if (task.consecutiveFailures >= 5) task.enabled = false;
  } finally {
    nowRunningTask = null;
  }

  task.lastRunAt = new Date().toISOString();
  task.executionCount += 1;
  task.lastDurationMs = durationMs;
  await appendExecution(store, { ts: new Date().toISOString(), taskId: task.id, productId: task.projectId, kind: "ops-sync", status, durationMs });
  notifyDataChanged("tasks");
  task.firstRunAt = task.firstRunAt || task.lastRunAt;
  task.nextRunAt =
    task.lastStatus === "failed"
      ? nextRunWithinMinutes(task.id, 30)
      : nextRunAt(task.id, task.intervalMinutes);
}

async function runReviewsSyncTask(store: AppStore, task: ReviewsSyncTask): Promise<void> {
  const context = findProductContext(store.get("projects") || [], task.productId);
  const product = context?.product;
  const project = context?.project;
  if (!project || !product?.trackId) return;
  const { storefrontsForLanguage } = await import("../engine/storefronts");
  const countries: string[] = [];
  for (const loc of product.supportedLanguages || []) {
    for (const country of storefrontsForLanguage(loc.code)) {
      if (!countries.includes(country)) countries.push(country);
    }
  }
  const all: Record<string, any> = store.get("reviews") || {};
  const perProduct: Record<string, any> = all[task.productId] || {};
  const existingIds = new Set<string>();
  for (const country of Object.keys(perProduct)) {
    for (const review of perProduct[country]?.items || []) existingIds.add(review.id);
  }
  const { fetchAllStorefrontReviews } = await import("../engine/review-collector");
  const { reviews, fetchedAt } = await fetchAllStorefrontReviews(product.trackId, countries, [...existingIds]);
  for (const review of reviews) {
    const list = perProduct[review.country]?.items || [];
    perProduct[review.country] = { items: [...list, review].slice(-500), lastFetchedAt: fetchedAt };
  }
  all[task.productId] = perProduct;
  store.set("reviews", all);
  notifyDataChanged("reviews");
  task.lastRunAt = new Date().toISOString();
  task.executionCount += 1;
  task.lastStatus = "success";
  task.firstRunAt = task.firstRunAt || task.lastRunAt;
  task.nextRunAt = nextRunAt(task.id, task.intervalMinutes);
}

async function runBuildStatusTask(store: AppStore, task: BuildStatusTask): Promise<void> {
  const context = findProductContext(store.get("projects") || [], task.productId);
  const project = context?.project;
  const product = context?.product;
  if (!project || !product?.trackId) return;
  const creds = resolveEffectiveCredentials(store, project.id);
  if (!creds.ascIssuerId || !creds.ascKeyId || !creds.ascPrivateKeyPath) return;
  const fs = await import("fs");
  const { createAscClient } = await import("../engine/asc-api");
  const client = createAscClient({
    issuerId: creds.ascIssuerId,
    keyId: creds.ascKeyId,
    privateKeyPem: fs.readFileSync(creds.ascPrivateKeyPath, "utf8"),
  });
  const appId = await client.getAppIdByBundleId(product.bundleId);
  if (!appId) return;
  const versions = await client.listAppStoreVersions(appId);
  const sorted = [...versions].sort((a, b) =>
    (b.createdDate || "").localeCompare(a.createdDate || ""),
  );
  const latest = sorted[0] || null;
  const localizations: Record<string, any[]> = {};
  if (latest) {
    localizations[latest.id] = await client.listVersionLocalizations(latest.id);
  }
  const builds = await client.listBuilds(appId);
  const all: Record<string, any> = store.get("ascCache") || {};
  const prev = all[task.productId] || null;
  const prevStates = new Map(
    (prev?.versions || []).map((v: any) => [v.versionString, v.appStoreState]),
  );
  all[task.productId] = {
    appId,
    versions: sorted,
    localizations,
    builds,
    fetchedAt: new Date().toISOString(),
  };
  store.set("ascCache", all);
  notifyDataChanged("asc");

  // Freeze against the actual store copy once a version is live: the store is
  // the final truth. Applies to versions that just became READY_FOR_SALE and
  // to already-live versions whose local draft has not been frozen yet.
  const liveVersions = sorted.filter((v) => v.appStoreState === "READY_FOR_SALE");
  if (liveVersions.length > 0) {
    const { applyAscSnapshotToDraft } = await import("../engine/store-submission");
    const projects: any[] = store.get("projects") || [];
    let changed = false;
    for (const project of projects) {
      const drafts = getStoreSubmissionDrafts(project);
      for (const draft of drafts) {
        if (draft.productId !== task.productId) continue;
        const version = String(draft.appVersion || "").trim().replace(/^v/i, "");
        const live = liveVersions.find((v) => v.versionString === version);
        if (!live) continue;
        const wasLive = prevStates.get(live.versionString) === "READY_FOR_SALE";
        if (wasLive && draft.ascSyncedAt) continue;
        const ascLocalizations = await client.listVersionLocalizations(live.id);
        if (applyAscSnapshotToDraft(draft, ascLocalizations)) changed = true;
        // 自愈：版本级 name/subtitle 为空（商店显示回退到 App 级），用
        // appInfoLocalizations 回填名称/副标题——这才是商店实际显示的值。
        const appInfoLocalizations = await client.listAppInfoLocalizations(appId);
        if (applyAscSnapshotToDraft(draft, appInfoLocalizations)) changed = true;
      }
    }
    if (changed) store.set("projects", projects);
  }

  task.lastRunAt = new Date().toISOString();
  task.executionCount += 1;
  task.lastStatus = "success";
  task.firstRunAt = task.firstRunAt || task.lastRunAt;
  task.nextRunAt = nextRunAt(task.id, task.intervalMinutes);
}

export async function schedulerTick(): Promise<void> {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    const store = await getStore();
    await reconcileRankTasks(store);
    await reconcileGithubSyncTasks(store);
    await reconcileOpsTasks(store);
    // Migrate existing drafts to the appVersion identity (one copy per
    // target version) when legacy duplicates exist.
    const projectsForMigration = store.get("projects") || [];
    let draftsChanged = false;
    for (const project of projectsForMigration) {
      if (normalizeDraftIdentity(project)) draftsChanged = true;
    }
    if (draftsChanged) store.set("projects", projectsForMigration);

    const now = Date.now();
    const accel = store.get("schedulerAccel") === true;
    const tasks: ScheduledTask[] = store.get("scheduledTasks") || [];
    // 非加速状态下自愈“排期坍缩”：一次性重排/迁移可能把整批任务的下次
    // 执行时间设成同一分钟，这里按各自稳定相位重新散布，避免未来某一分钟
    // 同时爆发成积压。加速期间跳过（当轮拉取的任务共享同一分钟）。
    if (!accel) {
      const rebalanced = rebalanceCollapsedTasks(
        tasks,
        new Date(now),
        rankRunsPerDay(store),
      );
      if (rebalanced.changed) {
        tasks.splice(0, tasks.length, ...rebalanced.tasks);
        store.set("scheduledTasks", tasks);
      }
    }
    // 渐进提速：加速不是瞬间满负荷，而是每轮逐步提升到峰值（踩油门）。
    let accelRound = 0;
    if (accel) {
      accelRound = Number(store.get("schedulerAccelRound") || 0) + 1;
      store.set("schedulerAccelRound", accelRound);
    }
    const accelFactor = accel ? Math.min(1, accelRound / ACCEL_MAX_ROUNDS) : 0;
    const maxPerTick = accel
      ? Math.round(MAX_RANK_TASKS_PER_TICK + (ACCEL_MAX_TASKS_PER_TICK - MAX_RANK_TASKS_PER_TICK) * accelFactor)
      : MAX_RANK_TASKS_PER_TICK;
    const breakMs = accel
      ? Math.round(TASK_BREAK_MS - (TASK_BREAK_MS - TASK_BREAK_ACCEL_MS) * accelFactor)
      : TASK_BREAK_MS;
    // Oldest-overdue first: array order is per-project, so an early project can
    // otherwise starve every later project (GloWalk sat enabled but untouched
    // behind ai-pulse's larger task list).
    const due = tasks
      .filter(
        (task) =>
          task.enabled &&
          new Date(task.nextRunAt).getTime() <= now,
      )
      .sort((a, b) => new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime());
    // 添油战术：加速时不把所有任务一次性提前，而是每轮从未来拉取紧邻的
    // 未处理任务补足本轮额度——平滑推进，结束后无需把任务推回。
    if (accel) {
      const future = tasks
        .filter(
          (task) =>
            task.enabled &&
            !accelHandledTaskIds.has(task.id) &&
            new Date(task.nextRunAt).getTime() > now,
        )
        .sort(
          (a, b) =>
            new Date(a.nextRunAt).getTime() -
            new Date(b.nextRunAt).getTime(),
        );
      const need = maxPerTick - due.length;
      if (need > 0 && future.length > 0) {
        const pulled = future.slice(0, need);
        const nowIso = new Date(now).toISOString();
        for (const task of pulled) task.nextRunAt = nowIso;
        due.push(...pulled);
        store.set("scheduledTasks", tasks);
      }
      // 自动解除：超过时限，或所有启用任务都已被加速处理过。
      const until = store.get("schedulerAccelUntil");
      const expired = until && Date.now() >= new Date(until).getTime();
      const allHandled =
        tasks.filter(
          (task) => task.enabled && !accelHandledTaskIds.has(task.id),
        ).length === 0;
      if (expired || (allHandled && accelRound > 1)) {
        await disableAccel(store);
        overdueScattered = false;
        notifyDataChanged("tasks");
        due.length = 0;
      }
    }
    // Run whole keyword groups back-to-back so a group's round completes as
    // early as possible, then take the tick's throughput cap.
    const selected = prioritizeGroupCompletion(due).slice(
      0,
      maxPerTick,
    );

    for (const task of selected) {
      // 加速到期按任务粒度检查：到期即停，不再执行完整个 round。
      if (accel) {
        const until = store.get("schedulerAccelUntil");
        if (until && Date.now() >= new Date(until).getTime()) break;
      }
      if (task.kind === "github-sync") {
        await runGithubSyncTask(store, task);
      } else if (task.kind === "ops-sync") {
        await runOpsSyncTask(store, task);
      } else if (task.kind === "reviews-sync") {
        await runReviewsSyncTask(store, task);
      } else if (task.kind === "build-status") {
        await runBuildStatusTask(store, task);
      } else {
        await runRankTask(store, task);
      }
      // 执行完成才计入“已处理”：早退任务（暂停/删除关键词、产品缺失）不
      // 计为已处理，避免提前触发 allHandled 自动关闭。
      accelHandledTaskIds.add(task.id);
      await new Promise((resolve) =>
        setTimeout(resolve, breakMs),
      );
    }
    // Merge the tick's per-task updates into the latest task list instead of
    // overwriting it: concurrent handlers (e.g. projects:remove) may have
    // removed or replaced tasks while this tick was running.
    const latestTasks: ScheduledTask[] = store.get("scheduledTasks") || [];
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const merged = latestTasks.map((task) => byId.get(task.id) || task);
    for (const task of byId.values()) {
      if (!merged.some((item) => item.id === task.id)) merged.push(task);
    }
    store.set("scheduledTasks", merged);
  } catch (err: any) {
    log.error(`Task scheduler tick failed: ${err.message}`);
  } finally {
    schedulerRunning = false;
  }
}

async function scatterOverdueTasks(store: AppStore): Promise<void> {
  const now = Date.now();
  const tasks: ScheduledTask[] = store.get("scheduledTasks") || [];
  let changed = false;
  for (const task of tasks) {
    if (task.enabled && new Date(task.nextRunAt).getTime() <= now) {
      task.nextRunAt = nextRunWithinMinutes(task.id, 120);
      changed = true;
    }
  }
  if (changed) {
    store.set("scheduledTasks", tasks);
  }
}

async function schedulerLoopOnce(): Promise<void> {
  const store = await getStore();
  const accel = store.get("schedulerAccel") === true;
  // 加速模式跳过积压分散：让任务按序立即处理，而不是散到未来 120 分钟。
  if (!overdueScattered && !accel) {
    await scatterOverdueTasks(store);
    overdueScattered = true;
  }
  await schedulerTick();
  if (schedulerPaused) return;
  schedulerTimer = setTimeout(
    () => void schedulerLoopOnce(),
    accel ? TICK_INTERVAL_ACCEL_MS : TICK_INTERVAL_MS,
  );
}

function startSchedulerLoop(): void {
  if (schedulerTimer) return;
  schedulerPaused = false;
  void schedulerLoopOnce();
}

/** Stop the scheduler timer so sleep is not disturbed while the system suspends. */
export function pauseTaskScheduler(): void {
  schedulerPaused = true;
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
}

/** Restart the scheduler after the system resumes, scattering the backlog. */
export function resumeTaskScheduler(): void {
  overdueScattered = false;
  startSchedulerLoop();
}

/**
 * 加速模式：更快的调度节奏（10 秒一轮、每轮最多 40 个任务、任务间 200ms），
 * 用于快速清空积压（如重建某平台的全部排名数据）。
 */
export async function setSchedulerAccel(enabled: boolean): Promise<void> {
  const store = await getStore();
  if (enabled) {
    // 开启或延长：每次点击把截止时间延长 5 分钟（已开启时累加）。
    const alreadyOn = store.get("schedulerAccel") === true;
    // 只有从关闭切换到开启时才是全新会话：清空已处理集合、轮次从 0 重新
    // 爬坡。已开启时点击仅表示延长，必须保留已处理集合，否则已执行过的
    // 任务会重新进入“可拉取”池而被重复执行。
    if (!alreadyOn) {
      accelHandledTaskIds = new Set();
      store.set("schedulerAccelRound", 0);
    }
    const existingUntil = store.get("schedulerAccelUntil");
    const base =
      alreadyOn && existingUntil
        ? new Date(existingUntil).getTime()
        : Date.now();
    const until = Math.max(Date.now() + ACCEL_AUTO_OFF_MS, base + ACCEL_AUTO_OFF_MS);
    store.set("schedulerAccel", true);
    store.set("schedulerAccelUntil", new Date(until).toISOString());
  } else {
    await disableAccel(store);
  }
  // 立即应用新的调度节奏。
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
  startSchedulerLoop();
  return;
}

/**
 * 关闭加速：停止加速调度节奏。添油模式下每轮只从未来拉取本轮额度内的
 * 任务并当场执行，不存在“被提前但未执行”的残留；未处理任务仍保留在原
 * 排期，之后由正常调度按各自间隔继续执行。
 */
async function disableAccel(store: AppStore): Promise<void> {
  accelHandledTaskIds = new Set();
  store.set("schedulerAccel", false);
  store.set("schedulerAccelUntil", null);
}

export function startTaskScheduler(): void {
  startSchedulerLoop();
  if (!powerListenersRegistered) {
    powerListenersRegistered = true;
    powerMonitor.on("suspend", pauseTaskScheduler);
    powerMonitor.on("resume", resumeTaskScheduler);
  }
}

export async function runOpsSyncNow(projectId: string): Promise<boolean> {
  const store = await getStore();
  const tasks: ScheduledTask[] = store.get("scheduledTasks") || [];
  const task = tasks.find((item) => item.id === opsSyncTaskId(projectId)) as OpsSyncTask | undefined;
  if (!task) return false;
  await runOpsSyncTask(store, task);
  return true;
}

export async function runReviewsSyncNow(productId: string): Promise<boolean> {
  const store = await getStore();
  const tasks: ScheduledTask[] = store.get("scheduledTasks") || [];
  const task = tasks.find((item) => item.id === reviewsSyncTaskId(productId)) as ReviewsSyncTask | undefined;
  if (!task) return false;
  await runReviewsSyncTask(store, task);
  return true;
}

export async function runBuildStatusNow(productId: string): Promise<boolean> {
  const store = await getStore();
  const tasks: ScheduledTask[] = store.get("scheduledTasks") || [];
  const task = tasks.find((item) => item.id === buildStatusTaskId(productId)) as BuildStatusTask | undefined;
  if (!task) return false;
  await runBuildStatusTask(store, task);
  return true;
}
