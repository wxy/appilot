/**
 * 实例任务执行器注册表（v4）：核心任务类型 → 执行器。
 *
 * Electron / DSH 的实例任务（DB tasks 行，带 kind + instance）都由这里按 kind
 * 分发执行——任务执行实现唯一来源是 core 纯函数，不存在壳特有任务。
 * 执行器只依赖 store.tasks 中的实例参数（instance）与共享 DB，不读壳存储。
 */
import type { TaskExecutor } from './scheduler.js';
import { syncProjectReleaseState } from '@appilot-labs/appilot-core/project-sync';

export interface HeadlessExecutorsOptions {
  /** 凭据读取器：壳注入（GITHUB_TOKEN 等）。 */
  readToken(name: string): Promise<string | null> | string | null;
}

/**
 * 项目级 GitHub 发布同步实例（id 形如 github-sync:<projectName>）。
 * instance: { projectName, path }
 */
export interface GithubSyncInstanceArgs {
  projectName: string;
  path: string;
}

export const GITHUB_SYNC_KIND = 'github-sync';
export const GITHUB_SYNC_INTERVAL_MINUTES = 60;

/** 构建核心执行器注册表（kind → 执行器）。 */
export function buildHeadlessExecutors(opts: HeadlessExecutorsOptions): Record<string, TaskExecutor> {
  const { readToken } = opts;
  return {
    [GITHUB_SYNC_KIND]: {
      title: 'GitHub 发布同步',
      intervalMinutes: GITHUB_SYNC_INTERVAL_MINUTES,
      async run({ task, log }) {
        const args = (task.instance ?? {}) as Partial<GithubSyncInstanceArgs>;
        if (!args.path) throw new Error('实例缺少 path 参数（github-sync）');
        const token = (await readToken('GITHUB_TOKEN')) || null;
        const state = await syncProjectReleaseState(args.path, { token });
        log(`github-sync ${task.id}: ${state.summary}`);
        return `${args.projectName ?? args.path}: ${state.summary}`;
      },
    },
  };
}
