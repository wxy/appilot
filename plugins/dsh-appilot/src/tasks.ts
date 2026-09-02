/**
 * Appilot 定时任务（Phase 3：headless 租约选主调度）。
 *
 * - 任务经 headless createLeaseScheduler 运行：多壳（DSH/Electron）共享同一 SQLite
 *   的 lease 表——仅租约主执行任务；主崩溃后其他壳自动接管；
 * - 任务直接运行 core 函数（确定性 API 调用，不经过模型、不花 token）；
 * - 状态持久化在共享 DB 的 tasks 表，经 appilot_tasks 工具读给 agent/前端。
 *
 * 说明：任务只在 dsh 服务运行期间生效（Electron 桌面应用同理）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { jsonify, openSharedHeadlessStore, type CredentialReader } from '@appilot-labs/appilot-common';
import { createLeaseScheduler, type ScheduledJob } from '@appilot-labs/appilot-headless';
import { listGitTags } from '@appilot-labs/appilot-core/release-watcher';
import { listGitHubReleases } from '@appilot-labs/appilot-core/github-api';
import { detectLocalizedLanguages } from '@appilot-labs/appilot-core/app-store-discovery';
import { runReadinessChecks } from '@appilot-labs/appilot-core/readiness-check';

/** 本壳的调度租约身份。 */
export const LEADER_ID = 'dsh';

/** 启动 DSH 侧定时任务（返回清理函数）。由元插件 apply 调用。 */
export function startAppilotTasks(reader: CredentialReader): () => void {
  const store = openSharedHeadlessStore();
  const jobs: ScheduledJob[] = [
    {
      id: 'release-sync',
      title: '发布同步（git tags + GitHub releases）',
      intervalMinutes: 60,
      async run({ store: s, log }) {
        const token = (await reader('GITHUB_TOKEN')) || null;
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
  const scheduler = createLeaseScheduler({ store, leaderId: LEADER_ID, jobs });
  scheduler.start();
  return () => scheduler.dispose();
}

/** appilot_tasks 状态工具：列出任务定义与运行状态（agent/前端读取）。 */
export function createTasksStatusTool() {
  return defineTool({
    name: 'appilot_tasks',
    description:
      'List Appilot scheduled tasks and their state: interval, last run, next run, last status and summary. Tasks run server-side under a lease-elected scheduler (only the leader shell executes them).',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [
        { type: 'text', text: JSON.stringify(value, null, 2) },
      ],
    },
    async execute() {
      return jsonify({ tasks: openSharedHeadlessStore().tasks.all() });
    },
  });
}
