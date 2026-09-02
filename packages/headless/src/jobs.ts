/**
 * Headless 共享定时任务（Phase 5）：所有壳（DSH / CLI / MCP / Electron）运行的
 * 任务定义唯一来源。
 *
 * 任务只调用 core 的确定性函数（不经过模型、不花 token），状态持久化在共享 DB
 * 的 tasks 表；由壳各自 createLeaseScheduler 挂载（仅租约主执行）。
 *
 * readToken：从壳的凭据源读取 token（DSH 传 ctx 凭据读取器；CLI/MCP 传 env 读取）。
 */
import type { ScheduledJob } from './scheduler.js';
import { listGitTags } from '@appilot-labs/appilot-core/release-watcher';
import { listGitHubReleases } from '@appilot-labs/appilot-core/github-api';
import { detectLocalizedLanguages } from '@appilot-labs/appilot-core/app-store-discovery';
import { runReadinessChecks } from '@appilot-labs/appilot-core/readiness-check';

export interface HeadlessJobsOptions {
  /** 凭据读取器：壳注入（如 GITHUB_TOKEN）。返回 null 表示无凭据（降级公开数据）。 */
  readToken(name: string): Promise<string | null> | string | null;
}

/** 构建共享任务集：发布同步（release-sync）+ 发布准备度（readiness）。 */
export function buildHeadlessJobs(opts: HeadlessJobsOptions): ScheduledJob[] {
  const { readToken } = opts;
  return [
    {
      id: 'release-sync',
      title: '发布同步（git tags + GitHub releases）',
      intervalMinutes: 60,
      async run({ store: s, log }) {
        const token = (await readToken('GITHUB_TOKEN')) || null;
        const projects = s.projects.list();
        if (projects.length === 0) return '无已注册项目';
        const parts: string[] = [];
        for (const p of projects) {
          try {
            const tags = await listGitTags(p.path);
            const releases = await listGitHubReleases(p.path, token);
            const drafts = releases.filter((r) => r.draft).length;
            parts.push(
              `${p.name}: tag=${tags[0]?.name ?? '无'} · GitHub 发布 ${releases.length}（草稿 ${drafts}）`,
            );
          } catch (err: any) {
            parts.push(`${p.name}: 失败 ${err.message}`);
          }
        }
        return parts.join('；');
      },
    },
    {
      id: 'readiness',
      title: '发布准备度检查',
      intervalMinutes: 24 * 60,
      async run({ store: s }) {
        const projects = s.projects.list();
        if (projects.length === 0) return '无已注册项目';
        const parts: string[] = [];
        for (const p of projects) {
          try {
            const languages = detectLocalizedLanguages(p.path);
            const checks = runReadinessChecks({
              localizations: [],
              supportedLanguages: languages,
              versionTag: '',
              ascVersion: null,
              buildAttached: false,
            });
            const pass = checks.filter((c) => c.status === 'pass').length;
            const warn = checks.filter((c) => c.status === 'warning').length;
            const fail = checks.filter((c) => c.status === 'fail').length;
            parts.push(`${p.name}: 通过 ${pass} / 警告 ${warn} / 失败 ${fail}`);
          } catch (err: any) {
            parts.push(`${p.name}: 失败 ${err.message}`);
          }
        }
        return parts.join('；');
      },
    },
  ];
}
