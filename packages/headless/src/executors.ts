/**
 * 实例任务执行器注册表（v4）：核心任务类型 → 执行器。
 *
 * Electron / DSH 的实例任务（DB tasks 行，带 kind + instance）都由这里按 kind
 * 分发执行——任务执行实现唯一来源是 core 纯函数，不存在壳特有任务。
 * 执行器只依赖 store.tasks 中的实例参数（instance）与共享 DB，不读壳存储。
 */
import type { TaskExecutor, TaskExecutorContext } from './scheduler.js';
import {
  inspectProjectRelease,
  type ProjectReleaseInspection,
} from '@appilot-labs/appilot-core/project-sync';

export interface HeadlessExecutorsOptions {
  /** 凭据读取器：壳注入（GITHUB_TOKEN 等）。 */
  readToken(name: string): Promise<string | null> | string | null;
  /**
   * 是否注册 rank 执行器（默认 false）——注册后持主壳会执行 DB 中的 rank
   * 实例（Electron 源）。启用前提：rank 结果已能同步回 Electron UI（P2b 反向
   * 同步）；DSH 默认不启用，daemon（P3）未来启用。
   */
  includeRank?: boolean;
}

/**
 * 项目级 GitHub 发布同步实例（id 形如 github-sync:<projectName>）。
 * instance: { projectName, path }（Electron 实例可含 projectId）。
 */
export interface GithubSyncInstanceArgs {
  projectName: string;
  path: string;
  projectId?: string;
}

export const GITHUB_SYNC_KIND = 'github-sync';
export const GITHUB_SYNC_INTERVAL_MINUTES = 60;

/** rank 采集任务类型（P2：自身排名 headless 化；竞品可选）。 */
export const RANK_KIND = 'rank';
export const RANK_INTERVAL_MINUTES = 720;

/** rank 实例参数（product 上下文可来自 instance 或 DB product_records）。 */
export interface RankInstanceArgs {
  projectName: string;
  productId: string;
  keyword: string;
  queryLanguage: string;
  storefront: string;
  platform?: string | null;
  /** 竞品 trackId（可选增强：无则只采集自身排名）。 */
  competitorTrackIds?: string[];
}

/**
 * github-sync 执行产物 → githubSyncCache 同构条目（写共享 DB release_cache，
 * 与 Electron 发布页 UI 消费的结构一致；M4-A/P1 统一执行结果）。
 */
export function githubSyncCacheEntryFrom(
  inspection: ProjectReleaseInspection,
): Record<string, unknown> {
  return {
    tag: inspection.release?.tag ?? null,
    release: inspection.material?.githubRelease ?? null,
    pullRequests: inspection.material?.pullRequests ?? [],
    releases: inspection.releases,
    repoCapabilities: inspection.repoCapabilities,
    lastSeenSha: inspection.lastSeenSha,
    syncedAt: inspection.syncedAt,
  };
}

/** 构建核心执行器注册表（kind → 执行器）。 */
export function buildHeadlessExecutors(opts: HeadlessExecutorsOptions): Record<string, TaskExecutor> {
  const { readToken } = opts;
  const executors: Record<string, TaskExecutor> = {
    [GITHUB_SYNC_KIND]: {
      title: 'GitHub 发布同步',
      intervalMinutes: GITHUB_SYNC_INTERVAL_MINUTES,
      async run(ctx) {
        return runGithubSyncInstance(ctx, readToken);
      },
    },
  };
  if (opts.includeRank === true) {
    executors[RANK_KIND] = buildRankExecutor();
  }
  return executors;
}

/** rank 执行器（P2：自身排名采集，结果写共享 DB rank_snapshots；竞品可选）。 */
export function buildRankExecutor(): TaskExecutor {
  return {
    title: '排名采集',
    intervalMinutes: RANK_INTERVAL_MINUTES,
    run: runRankInstance,
  };
}

/** rank 实例执行体：查产品上下文（DB product_records）→ core 采集 → 写 DB 快照。 */
export async function runRankInstance(ctx: TaskExecutorContext): Promise<string> {
  const { task, store, log } = ctx;
  const args = (task.instance ?? {}) as Partial<RankInstanceArgs>;
  if (!args.keyword || !args.storefront || !args.productId || !args.projectName) {
    throw new Error('rank 实例参数不完整（keyword/storefront/productId/projectName）');
  }
  // 产品上下文优先从共享 DB product_records 取（daemon/壳一致）；缺失时回退 instance。
  let trackId: string | number | null = null;
  let platform: string | null = args.platform ?? null;
  const products = store.products.listByProject(args.projectName);
  const rec = products.find((p) => p.productId === args.productId);
  if (rec) {
    trackId = rec.trackId;
    platform = rec.platform ?? platform;
  }
  if (!trackId) throw new Error(`rank 实例缺少 trackId（product_records 无 ${args.projectName}/${args.productId}）`);
  const { searchAppStoreRank } = await import('@appilot-labs/appilot-core/rank-collector');
  const result = await searchAppStoreRank({
    term: args.keyword,
    country: args.storefront,
    trackId: String(trackId),
    entity: platform === 'macos' ? 'macSoftware' : 'software',
    candidateTrackIds:
      Array.isArray(args.competitorTrackIds) && args.competitorTrackIds.length > 0
        ? args.competitorTrackIds
        : undefined,
  });
  const snap = {
    projectName: args.projectName,
    productId: args.productId,
    keyword: args.keyword,
    language: args.queryLanguage ?? 'en',
    storefront: args.storefront,
    rank: result.rank,
    totalResults: result.totalResults,
    checkedAt: new Date().toISOString(),
  };
  try {
    store.snapshots.add([snap]);
  } catch (err: any) {
    log(`rank ${task.id}: 快照写入失败 ${err?.message || String(err)}`);
  }
  const competitorCount = result.candidateRanks ? Object.keys(result.candidateRanks).length : 0;
  const rankText = snap.rank == null ? '未上榜' : `第 ${snap.rank} 名`;
  return `${args.projectName}(${platform ?? '?'}): ${args.keyword} @ ${args.storefront} → ${rankText}（共 ${snap.totalResults} 结果${competitorCount > 0 ? `，竞品 ${competitorCount}` : ''}）`;
}

/** github-sync 实例执行体：深度检测（inspectProjectRelease）+ 写 DB 发布缓存。 */
export async function runGithubSyncInstance(
  ctx: TaskExecutorContext,
  readToken: HeadlessExecutorsOptions['readToken'],
): Promise<string> {
  const { task, store, log } = ctx;
  const args = (task.instance ?? {}) as Partial<GithubSyncInstanceArgs>;
  if (!args.path) throw new Error('实例缺少 path 参数（github-sync）');
  const token = (await readToken('GITHUB_TOKEN')) || null;
  // 深度检测链（M2：与 Electron github-sync 同一 core 实现）
  const inspection = await inspectProjectRelease(args.path, {
    token,
    fetchRemote: true,
    lastSeenSha: undefined,
  });
  // 结果写共享 DB release_cache（projectName 维度）——任何壳持主执行都产出
  // 同一缓存，Electron 发布页经 hydrate 反向同步保持新鲜。
  if (args.projectName) {
    try {
      store.releaseCache.save(
        args.projectName,
        githubSyncCacheEntryFrom(inspection),
      );
    } catch (err: any) {
      log(`github-sync ${task.id}: 缓存写入失败 ${err?.message || String(err)}`);
    }
  }
  log(`github-sync ${task.id}: ${inspection.summary}`);
  return `${args.projectName ?? args.path}: ${inspection.summary}`;
}
