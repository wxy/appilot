/**
 * Appilot 任务工具（架构收敛后 DSH = 纯查询/命令端）。
 *
 * - 任务执行统一由**常驻调度 daemon / Electron** 承担（租约主 tick 执行共享
 *   DB 实例行）；DSH **不再拉起调度器、不参与租约仲裁**（2026-09-04 收敛）。
 * - appilot_tasks：只读共享 DB 任务状态（byKind/summary）；appilot_task_run：
 *   显式触发经 daemon（controlRunNow）——daemon 未运行给出指引而非自行拉起。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { jsonify, openSharedHeadlessStore } from '@appilot-labs/appilot-common';
import { defaultDbPath } from '@appilot-labs/appilot-headless';
import { controlRunNow } from '@appilot-labs/appilot-scheduler';

/** appilot_tasks 状态工具：任务实例与状态（agent/前端读取）。 */
export function createTasksStatusTool() {
  return defineTool({
    name: 'appilot_tasks',
    description:
      'List Appilot task instances and their state (per-project github-sync etc): interval, last run, next run, last status, summary. Instances live in the shared DB and are executed by the lease-elected scheduler with core executors.',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [
        { type: 'text', text: JSON.stringify(value, null, 2) },
      ],
    },
    async execute() {
      const store = openSharedHeadlessStore();
      const all = store.tasks.all();
      // 架构收敛：DSH 不再产生/调度实例（daemon 源 = 'scheduler'）——
      // dshInstances 恒空，保留字段仅为兼容旧消费者。
      const dshInstances: typeof all = [];
      const electronTasks = all.filter((t) => t.source === 'electron');
      // 全局聚合（按 kind × lastStatus）：主面板任务页据此展示共享 DB 真实状态。
      const byKind: Record<
        string,
        { total: number; ok: number; error: number; never: number }
      > = {};
      let error = 0;
      let ok = 0;
      let never = 0;
      for (const t of all) {
        const k = t.kind ?? '(legacy)';
        const agg = (byKind[k] ??= { total: 0, ok: 0, error: 0, never: 0 });
        agg.total += 1;
        if (t.lastStatus === 'ok') {
          ok += 1;
          agg.ok += 1;
        } else if (t.lastStatus === 'error') {
          error += 1;
          agg.error += 1;
        } else {
          never += 1;
          agg.never += 1;
        }
      }
      return jsonify({
        tasks: all,
        dshInstances,
        byKind,
        summary: {
          total: all.length,
          dsh: dshInstances.length,
          electron: electronTasks.length,
          cli: all.filter((t) => t.source === 'cli').length,
          ok,
          error,
          never,
        },
        checkedAt: new Date().toISOString(),
      });
    },
  });
}

/** appilot_task_run 工具：显式立即运行一个任务实例（同步等待结果，经常驻 daemon）。 */
export function createTaskRunTool() {
  return defineTool({
    name: 'appilot_task_run',
    description:
      'Immediately run one Appilot task instance (e.g. github-sync:<project>) and wait for the result. ' +
      'Requires the dsh server scheduler to be running.',
    parameters: {
      taskId: {
        type: 'string',
        required: true,
        description: 'Task instance id, e.g. github-sync:<projectName>.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [
        { type: 'text', text: JSON.stringify(value, null, 2) },
      ],
    },
    async execute(args: any) {
      const id = String(args?.taskId ?? '');
      // 架构收敛：DSH 仅是查询/命令端，不自行拉起调度器——执行统一由常驻
      // daemon（Electron 任务中心启动/启动任务中心）承担。
      const daemonRes = await controlRunNow(id, {
        dbPath: process.env.APPILOT_DB_FILE || defaultDbPath(),
      });
      if (daemonRes.routed === 'daemon' && daemonRes.ok) {
        return jsonify({ task: daemonRes.result, via: 'daemon' });
      }
      return jsonify({
        error:
          daemonRes.routed === 'none'
            ? `调度守护进程未运行——请先在 Electron「任务中心」启动任务中心，或运行 appilot-scheduler`
            : `未知任务实例或无法执行: ${id}`,
      });
    },
  });
}
