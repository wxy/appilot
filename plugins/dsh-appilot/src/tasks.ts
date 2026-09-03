/**
 * Appilot 定时任务（Phase 3 headless 租约选主调度；v4 实例任务统一：M1.5 DSH 接入）。
 *
 * - 任务 = 共享 DB 的实例行（kind + instance 参数）+ headless 核心执行器
 *   （buildHeadlessExecutors），由 lease 主 tick 执行；不存在壳特有任务；
 * - DSH 侧 reconcile：注册项目 → 每项目 github-sync 实例（source='dsh'），
 *   启动 + 每 60s 差异同步（注册/移除项目自动增删实例）；
 * - 状态统一在共享 DB tasks 表（appilot_tasks 读、appilot_task_run 显式触发）。
 *
 * 说明：任务只在 dsh 服务运行期间生效（Electron 桌面应用同理）；legacy
 * 汇总模板 buildHeadlessJobs（release-sync/readiness）不再由 DSH 调度装载。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { jsonify, openSharedHeadlessStore, type CredentialReader } from '@appilot-labs/appilot-common';
import {
  buildHeadlessExecutors,
  createLeaseScheduler,
  defaultDbPath,
  githubSyncInstancesFor,
  reconcileTaskInstances,
  type LeaseScheduler,
} from '@appilot-labs/appilot-headless';
import {
  controlRunNow,
  defaultSocketPath,
  ensureScheduler,
  resolveSchedulerCli,
} from '@appilot-labs/appilot-scheduler';
import { createRequire } from 'node:module';

/** 本壳的调度租约身份。 */
export const LEADER_ID = 'dsh';

/** 实例差异同步间隔（ms）：注册/移除项目后 ≤60s 自动增删任务实例。 */
const RECONCILE_INTERVAL_MS = 60_000;

/** 当前进程内活跃的调度器（appilot_task_run 的 runNow 入口）；未启动为 null。 */
let activeScheduler: LeaseScheduler | null = null;

/**
 * P4：best-effort 确保调度守护进程在跑（daemon 优先成为调度主；本壳调度
 * 保留为 lease 仲裁下的 fallback——daemon acquire 失败（无主时被本壳抢到）或
 * 未安装时本壳继续调度）。fire-and-forget，不阻塞插件启动。
 */
async function ensureDaemon(): Promise<boolean> {
  try {
    const requirer = createRequire(import.meta.url);
    const cli = resolveSchedulerCli(requirer);
    const ok = await ensureScheduler({
      socketPath: defaultSocketPath(process.env.APPILOT_DB_FILE || defaultDbPath()),
      spawnCommand: cli ? [process.execPath, cli] : undefined,
      timeoutMs: 3000,
      log: (m) => console.log(`[appilot-dsh] ${m}`),
    });
    return ok;
  } catch {
    return false; // 依赖缺失/解析失败：回退壳内调度
  }
}

/** 启动 DSH 侧定时任务（返回清理函数）。由元插件 apply 调用。 */
export function startAppilotTasks(reader: CredentialReader): () => void {
  const store = openSharedHeadlessStore();
  const scheduler = createLeaseScheduler({
    store,
    leaderId: LEADER_ID,
    jobs: [], // v4：任务全部实例化（汇总模板退役）
    executors: buildHeadlessExecutors({ readToken: (name) => reader(name) }),
  });
  activeScheduler = scheduler;

  // reconcile：注册项目 → github-sync 实例（seed/参数刷新/清理）。多壳可并发跑，
  // 幂等（seed 前检查存在）；写失败不阻断调度。
  const reconcile = () => {
    try {
      const projects = store.projects
        .list()
        .map((p) => ({ name: p.name, path: p.path }));
      reconcileTaskInstances(store, githubSyncInstancesFor(projects), LEADER_ID);
    } catch {
      /* 下轮再试 */
    }
  };
  reconcile();
  const reconcileTimer = setInterval(reconcile, RECONCILE_INTERVAL_MS);

  // P4：确保调度守护进程（阻塞一次，≤3s）。daemon 就绪（socket up 或已在跑）
  // → 本壳不再启动调度 tick（daemon 主；runNow 不经主仍可用）；daemon 不可用
  // （cli 缺失/未拉起）→ 壳内调度 fallback（lease 仲裁防双跑）。
  void ensureDaemon().then((daemonUp) => {
    if (daemonUp) {
      console.log('[appilot-dsh] scheduler daemon active — shell scheduler disabled');
    } else {
      scheduler.start();
    }
  });
  return () => {
    clearInterval(reconcileTimer);
    activeScheduler = null;
    scheduler.dispose();
  };
}

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
      const dshInstances = all.filter(
        (t) => t.source === LEADER_ID && t.kind != null,
      );
      const electronTasks = all.filter((t) => t.source === 'electron');
      return jsonify({
        tasks: all,
        dshInstances,
        summary: {
          dsh: dshInstances.length,
          electron: electronTasks.length,
          cli: all.filter((t) => t.source === 'cli').length,
          error: all.filter((t) => t.lastStatus === 'error').length,
        },
      });
    },
  });
}

/** appilot_task_run 工具：显式立即运行一个任务实例（同步等待结果）。 */
export function createTaskRunTool(scheduler?: LeaseScheduler | null) {
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
      const sched = scheduler ?? activeScheduler;
      const id = String(args?.taskId ?? '');
      // 统一控制路由：daemon 主 → daemon 执行（可跑 github-sync/rank 等）；
      // daemon 不可达 → 本壳 scheduler（github-sync）或报错。
      if (sched) {
        const daemonRes = await controlRunNow(id, {
          dbPath: process.env.APPILOT_DB_FILE || defaultDbPath(),
        });
        if (daemonRes.routed === 'daemon' && daemonRes.ok) {
          return jsonify({ task: daemonRes.result, via: 'daemon' });
        }
        const result = await sched.runNow(id);
        if (result) return jsonify({ task: result, via: 'local' });
        return jsonify({
          error: `未知任务实例或本端不可执行: ${id}${daemonRes.routed === 'none' ? '（daemon 未运行）' : ''}`,
        });
      }
      return jsonify({ error: '调度器未运行（dsh 服务未启动）' });
    },
  });
}
