/**
 * Appilot 定时任务（Phase 3：headless 租约选主调度；Phase 5：定义下沉 headless 包）。
 *
 * - 任务经 headless createLeaseScheduler 运行：多壳（DSH/Electron/CLI/MCP）共享
 *   同一 SQLite 的 lease 表——仅租约主执行任务；主崩溃后其他壳自动接管；
 * - 任务定义唯一来源 = headless buildHeadlessJobs（DSH / CLI / MCP 复用同一份）；
 * - 状态持久化在共享 DB 的 tasks 表，经 appilot_tasks 工具读给 agent/前端；
 * - appilot_task_run 显式触发单个任务（runNow，非主也可用的强制运行）。
 *
 * 说明：任务只在 dsh 服务运行期间生效（Electron 桌面应用同理）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { jsonify, openSharedHeadlessStore, type CredentialReader } from '@appilot-labs/appilot-common';
import { buildHeadlessJobs, createLeaseScheduler, type LeaseScheduler } from '@appilot-labs/appilot-headless';

/** 本壳的调度租约身份。 */
export const LEADER_ID = 'dsh';

/** 当前进程内活跃的调度器（appilot_task_run 的 runNow 入口）；未启动为 null。 */
let activeScheduler: LeaseScheduler | null = null;

/** 启动 DSH 侧定时任务（返回清理函数）。由元插件 apply 调用。 */
export function startAppilotTasks(reader: CredentialReader): () => void {
  const store = openSharedHeadlessStore();
  const scheduler = createLeaseScheduler({
    store,
    leaderId: LEADER_ID,
    jobs: buildHeadlessJobs({ readToken: (name) => reader(name) }),
  });
  activeScheduler = scheduler;
  scheduler.start();
  return () => {
    activeScheduler = null;
    scheduler.dispose();
  };
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

/** appilot_task_run 工具：显式立即运行一个共享任务（同步等待结果）。 */
export function createTaskRunTool(scheduler?: LeaseScheduler | null) {
  return defineTool({
    name: 'appilot_task_run',
    description:
      'Immediately run one shared scheduled task (release-sync or readiness) and wait for the result. ' +
      'Requires the dsh server scheduler to be running; only headless-defined tasks can be run from DSH ' +
      '(Electron dynamic tasks are executed by the Electron shell itself).',
    parameters: {
      taskId: {
        type: 'string',
        required: true,
        description: 'Task id: release-sync (git tags + GitHub releases) or readiness (release-readiness checks).',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [
        { type: 'text', text: JSON.stringify(value, null, 2) },
      ],
    },
    async execute(args: any) {
      const sched = scheduler ?? activeScheduler;
      const id = String(args?.taskId ?? '');
      if (!sched) return jsonify({ error: '调度器未运行（dsh 服务未启动）' });
      const result = await sched.runNow(id);
      if (!result) return jsonify({ error: `未知任务: ${id}（可用: release-sync / readiness）` });
      return jsonify({ task: result });
    },
  });
}
