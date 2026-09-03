/**
 * 调度守护进程生命周期（P3 蓝图 §3/§6）：
 * - 单例仲裁：openStore → lease.acquire('scheduler')，失败（已有调度者）自我退出；
 * - reconcile 周期：共享 DB 注册项目 → github-sync 实例（与 DSH 同一推导）；
 * - createLeaseScheduler({ executors }) 唯一执行 tick（headless 引擎）；
 * - socket 服务（hello/ping/runNow + 任务事件广播）；
 * - 常驻：不因无客户端退出；SIGTERM/SIGINT 优雅退出（升级/关机让位）。
 */
import { openStore, createLeaseScheduler, buildHeadlessExecutors, githubSyncInstancesFor, reconcileTaskInstances, type AppilotStore } from '@appilot-labs/appilot-headless';
import { dirname, join } from 'node:path';
import { rmSync } from 'node:fs';
import { createSchedulerServer, type SchedulerServer } from './server.js';
import { SCHEDULER_PROTOCOL_VERSION } from './protocol.js';
import type { LeaseScheduler } from '@appilot-labs/appilot-headless';

export const SCHEDULER_LEADER_ID = 'scheduler';
export const RECONCILE_INTERVAL_MS = 60_000;
export const DEFAULT_HEARTBEAT_MS = 15_000;
export const DEFAULT_TTL_MS = 60_000;

/** 默认 socket 路径（与共享 DB 同目录：scheduler.sock）。 */
export function defaultSocketPath(dbPath?: string): string {
  return join(dirname(dbPath ?? process.env.APPILOT_DB_FILE ?? ''), 'scheduler.sock');
}

export interface DaemonOptions {
  dbPath?: string;
  socketPath?: string;
  reconcileIntervalMs?: number;
  heartbeatMs?: number;
  ttlMs?: number;
  log?(msg: string): void;
}

export interface DaemonHandle {
  store: AppilotStore;
  scheduler: LeaseScheduler;
  server: SchedulerServer;
  stop(): Promise<void>;
}

/**
 * 启动守护进程。返回 handle（测试/嵌入用）或抛出「已有调度者」类错误。
 * bin 入口捕获该错误后安静退出（不视为失败）。
 */
export async function runDaemon(opts: DaemonOptions = {}): Promise<DaemonHandle> {
  const log = opts.log ?? ((m: string) => console.log(`[appilot-scheduler] ${m}`));
  const dbPath = opts.dbPath ?? process.env.APPILOT_DB_FILE ?? '';
  if (!dbPath) throw new Error('缺少数据库路径（APPILOT_DB_FILE 或 opts.dbPath）');
  const socketPath = opts.socketPath ?? defaultSocketPath(dbPath);

  const store = openStore(dbPath);
  // 单例仲裁：已有调度者（其他 daemon / 过渡期壳内调度）→ 自我退出。
  if (!store.lease.acquire(SCHEDULER_LEADER_ID, opts.ttlMs ?? DEFAULT_TTL_MS)) {
    store.close();
    throw new Error('已有调度者持有租约（single-instance 仲裁退出）');
  }
  log(`became schedule leader (${SCHEDULER_LEADER_ID}) @ ${dbPath}`);

  const executors = buildHeadlessExecutors({
    readToken: (name) => Promise.resolve(process.env[name] ?? null),
    // rank 执行待 P2b 反向同步就绪后启用；当前只执行 github-sync 类实例。
    includeRank: false,
  });
  const scheduler = createLeaseScheduler({
    store,
    leaderId: SCHEDULER_LEADER_ID,
    jobs: [],
    executors,
    ttlMs: opts.ttlMs ?? DEFAULT_TTL_MS,
    heartbeatMs: opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS,
    log,
  });

  // reconcile：共享 DB 注册项目 → github-sync 实例（DSH 同一推导）。
  const reconcile = () => {
    try {
      const projects = store.projects.list().map((p) => ({ name: p.name, path: p.path }));
      reconcileTaskInstances(store, githubSyncInstancesFor(projects), SCHEDULER_LEADER_ID);
    } catch (err: any) {
      log(`reconcile failed: ${err?.message || String(err)}`);
    }
  };
  reconcile();
  const reconcileTimer = setInterval(reconcile, opts.reconcileIntervalMs ?? RECONCILE_INTERVAL_MS);

  let selfShutdown: (() => void) | null = null;
  const server = createSchedulerServer(socketPath, {
    onHello: ({ client, pid }) => {
      log(`client hello: ${client} (pid ${pid})`);
      return { protocolVersion: SCHEDULER_PROTOCOL_VERSION, daemonPid: process.pid };
    },
    onRunNow: async (taskId) => {
      const result = await scheduler.runNow(taskId);
      if (!result) throw new Error(`未知任务实例: ${taskId}`);
      return result;
    },
    onShutdown: () => selfShutdown?.(),
    log,
  });
  try {
    await server.start();
  } catch (err: any) {
    // socket 占用（已有 daemon 在服务）→ 仲裁退出。
    clearInterval(reconcileTimer);
    scheduler.dispose();
    store.close();
    throw new Error(`socket 启动失败（已有 daemon？）: ${err?.message || String(err)}`);
  }

  // 任务事件 → socket 广播（活动中心实时性；无客户端时无开销）。
  scheduler.start();

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    clearInterval(reconcileTimer);
    scheduler.dispose();
    await server.close().catch(() => {});
    try {
      rmSync(socketPath, { force: true });
    } catch {
      /* 清理失败无碍 */
    }
    store.close();
    log('daemon exited cleanly');
  };
  // shutdown（socket 命令）：优雅退出进程。
  selfShutdown = () => {
    void stop().then(() => process.exit(0));
  };

  return { store, scheduler, server, stop };
}
