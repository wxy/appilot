/**
 * Appilot 定时任务（Phase 3：headless 租约选主调度；Phase 5：定义下沉 headless 包）。
 *
 * - 任务经 headless createLeaseScheduler 运行：多壳（DSH/Electron/CLI/MCP）共享
 *   同一 SQLite 的 lease 表——仅租约主执行任务；主崩溃后其他壳自动接管；
 * - 任务定义唯一来源 = headless buildHeadlessJobs（DSH / CLI / MCP 复用同一份）；
 * - 状态持久化在共享 DB 的 tasks 表，经 appilot_tasks 工具读给 agent/前端。
 *
 * 说明：任务只在 dsh 服务运行期间生效（Electron 桌面应用同理）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { jsonify, openSharedHeadlessStore, type CredentialReader } from '@appilot-labs/appilot-common';
import { buildHeadlessJobs, createLeaseScheduler } from '@appilot-labs/appilot-headless';

/** 本壳的调度租约身份。 */
export const LEADER_ID = 'dsh';

/** 启动 DSH 侧定时任务（返回清理函数）。由元插件 apply 调用。 */
export function startAppilotTasks(reader: CredentialReader): () => void {
  const store = openSharedHeadlessStore();
  const scheduler = createLeaseScheduler({
    store,
    leaderId: LEADER_ID,
    jobs: buildHeadlessJobs({ readToken: (name) => reader(name) }),
  });
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
