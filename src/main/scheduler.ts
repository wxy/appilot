import { log } from "../engine/logger";
import { powerMonitor } from "electron";
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
} from "./project-state";
import {
  buildStatusTaskId,
  bootstrapRoundState,
  IN_FLIGHT_STORE_STATUSES,
  markRoundTaskDone,
  nextRunAt,
  nextRankRunAt,
  nextRunWithinMinutes,
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
/** What the scheduler is executing right now (for the timeline UI). */
let nowRunningTask: RunningTaskInfo | null = null;
const rankEntityCache = new Map<string, "software" | "macSoftware">();

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

/** Fresh pre-warmed GitHub data for a project, or null when stale/mismatched. */
export function githubSyncCacheEntry(
  s: any,
  project: any,
): { tag: string | null; release: any | null; pullRequests: any[] } | null {
  const all = s.get("githubSyncCache") || {};
  const entry = all?.[project?.id];
  if (!entry) return null;
  if (new Date(entry.syncedAt).getTime() < Date.now() - 60 * 60_000) return null;
  if ((entry.lastSeenSha || null) !== (project?.lastReleaseSha || null)) return null;
  return {
    tag: entry.tag ?? null,
    release: entry.release ?? null,
    pullRequests: entry.pullRequests || [],
  };
}

async function resolveRankEntity(product: any): Promise<"software" | "macSoftware"> {
  const cached = rankEntityCache.get(product.trackId);
  if (cached) return cached;
  const { lookupApp } = await import("../engine/app-store-discovery");
  const metadata = await lookupApp(product.trackId);
  const entity: "software" | "macSoftware" = metadata?.kind === "mac-software" ? "macSoftware" : "software";
  rankEntityCache.set(product.trackId, entity);
  return entity;
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

      // The shared pool is queried per platform; auto-pause is evaluated per
      // platform (stored in pausedPlatforms) while a manual pause is global.
      for (const localization of product.supportedLanguages || []) {
        const localizationCode = localization.code;
        const queryLanguages = localizationCode === "en" ? ["en"] : [localizationCode, "en"];
        for (const keyword of pool) {
          if (keyword.status === "paused") continue;
          const evaluated = evaluatePause(
            enrichKeywordFromSnapshots(keyword, snapshots),
            snapshots,
          );
          const platforms = Array.isArray(keyword.pausedPlatforms)
            ? keyword.pausedPlatforms
            : [];
          if (evaluated.status === "paused" && !platforms.includes(platformKey)) {
            keyword.pausedPlatforms = [...platforms, platformKey];
            keyword.pausedReason = evaluated.pausedReason || null;
          } else if (evaluated.status !== "paused" && platforms.includes(platformKey)) {
            keyword.pausedPlatforms = platforms.filter((item: string) => item !== platformKey);
          }
          if ((keyword.pausedPlatforms || []).includes(platformKey)) continue;
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
      const hasInFlightDraft = getStoreSubmissionDrafts(project).some(
        (draft: any) =>
          draft.productId === product.id &&
          IN_FLIGHT_STORE_STATUSES.includes(draft.storeStatus),
      );
      if (hasInFlightDraft) {
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
    const result = await searchAppStoreRank({
      term: task.keyword,
      country: task.storefront,
      trackId: product.trackId,
      entity,
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
  const executions: any[] = Array.isArray(store.get("rankExecutions"))
    ? store.get("rankExecutions")
    : [];
  executions.push({
    ts: new Date().toISOString(),
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
  store.set("rankExecutions", executions.slice(-5000));
  task.firstRunAt = task.firstRunAt || task.lastRunAt;
  task.nextRunAt =
    task.lastStatus === "failed"
      ? nextRunWithinMinutes(taskSeed(task), 30)
      : nextRankRunAt(taskSeed(task), rankRunsPerDay(store));

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
    // Background sync must never touch the worktree or local branches: fetch
    // only updates remote-tracking refs and tags.
    await fetchRemoteTags(project.localPath);
    const token = resolveEffectiveCredentials(store, task.projectId).githubToken;
    const result = await checkForRelease(
      project.localPath,
      project.lastReleaseSha || null,
      token,
      {
        sync: false,
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
      lastSeenSha: project.lastReleaseSha || null,
      syncedAt: new Date().toISOString(),
    };
    store.set("githubSyncCache", all);
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
  const executions: any[] = Array.isArray(store.get("rankExecutions"))
    ? store.get("rankExecutions")
    : [];
  executions.push({
    ts: new Date().toISOString(),
    productId: task.projectId,
    kind: "github-sync",
    status,
    durationMs,
    requestBytes,
    responseBytes,
  });
  store.set("rankExecutions", executions.slice(-5000));
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
      const { fetchCompetitorSnapshot } = await import("../engine/competitor-radar");
      const all: Record<string, Record<string, any[]>> = store.get("competitorSnapshots") || {};
      const byId: Record<string, any[]> = all[task.projectId] || {};
      for (const competitor of competitors) {
        const snap = await fetchCompetitorSnapshot(competitor, token);
        const list = byId[competitor.id] || [];
        if (list[list.length - 1]?.date !== snap.date) {
          byId[competitor.id] = [...list, snap].slice(-90);
        }
      }
      all[task.projectId] = byId;
      store.set("competitorSnapshots", all);
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
  const executions: any[] = Array.isArray(store.get("rankExecutions")) ? store.get("rankExecutions") : [];
  executions.push({ ts: new Date().toISOString(), productId: task.projectId, kind: "ops-sync", status, durationMs });
  store.set("rankExecutions", executions.slice(-5000));
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
  all[task.productId] = {
    appId,
    versions: sorted,
    localizations,
    builds,
    fetchedAt: new Date().toISOString(),
  };
  store.set("ascCache", all);
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

    const now = Date.now();
    const tasks: ScheduledTask[] = store.get("scheduledTasks") || [];
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
    // Run whole keyword groups back-to-back so a group's round completes as
    // early as possible, then take the tick's throughput cap.
    const selected = prioritizeGroupCompletion(due).slice(0, MAX_RANK_TASKS_PER_TICK);

    for (const task of selected) {
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
      await new Promise((resolve) => setTimeout(resolve, 1500));
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

function startSchedulerLoop(): void {
  if (schedulerTimer) return;
  void (async () => {
    const store = await getStore();
    if (!overdueScattered) {
      await scatterOverdueTasks(store);
      overdueScattered = true;
    }
    schedulerTimer = setInterval(() => {
      void schedulerTick();
    }, 60_000);
    await schedulerTick();
  })();
}

/** Stop the scheduler timer so sleep is not disturbed while the system suspends. */
export function pauseTaskScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

/** Restart the scheduler after the system resumes, scattering the backlog. */
export function resumeTaskScheduler(): void {
  overdueScattered = false;
  startSchedulerLoop();
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
