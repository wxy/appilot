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
  return {
    [GITHUB_SYNC_KIND]: {
      title: 'GitHub 发布同步',
      intervalMinutes: GITHUB_SYNC_INTERVAL_MINUTES,
      async run(ctx) {
        const summary = await runGithubSyncInstance(ctx, readToken);
        return summary;
      },
    },
  };
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
