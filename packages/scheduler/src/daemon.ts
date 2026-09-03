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
import {
  fingerprintDirs,
  isChanged,
  resolveCodeDirs,
  restartSpec,
  spawnRestartProcess,
  hasFiles,
  RESTART_COOLDOWN_MS,
  type CodeFingerprint,
  type RestartSpec,
} from './self-update.js';

export const SCHEDULER_LEADER_ID = 'scheduler';
export const RECONCILE_INTERVAL_MS = 60_000;
export const DEFAULT_HEARTBEAT_MS = 15_000;
export const DEFAULT_TTL_MS = 60_000;
/** 代码自检周期：部署新 dist 后至多这么久即自重启加载新代码。 */
export const DEFAULT_UPDATE_CHECK_INTERVAL_MS = 60_000;

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
  /**
   * 代码自检周期（默认 60s；0 = 关闭）。daemon 对比启动时磁盘代码指纹，
   * 发现更新即自重启加载新代码（见 self-update.ts）。
   */
  updateCheckIntervalMs?: number;
  /** 覆盖自检监控目录（默认自动解析：本包 + headless + core 的 dist）。测试用。 */
  monitorDirs?: string[];
  /** 覆盖重启 spawn（库级测试注入用）。 */
  spawnRestartImpl?(spec: RestartSpec): unknown;
  /** 覆盖退出动作（库级测试注入用；默认 process.exit）。 */
  exitProcess?(code: number): void;
  log?(msg: string): void;
}

export interface DaemonHandle {
  store: AppilotStore;
  scheduler: LeaseScheduler;
  server: SchedulerServer;
  stop(): Promise<void>;
  /** 自检当前代码是否已变化（自更新用）。 */
  codeChanged(): boolean;
  /** 立即发起自重启（释放租约 + spawn 新进程 + 退出）。 */
  requestRestart(): void;
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
    // P2b 后启用 rank：Electron hydrate 的反向同步会把 daemon 采集的排名
    // 合并回 electron-store（Electron 排名页新鲜），daemon 可执行 rank 实例。
    includeRank: process.env.APPILOT_SCHEDULER_INCLUDE_RANK !== '0',
  });
  const scheduler = createLeaseScheduler({
    store,
    leaderId: SCHEDULER_LEADER_ID,
    jobs: [],
    executors,
    ttlMs: opts.ttlMs ?? DEFAULT_TTL_MS,
    heartbeatMs: opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS,
    accel: { tickMs: 2000, tickLimit: 100 },
    log,
  });
  let accelOffTimer: ReturnType<typeof setTimeout> | null = null;

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

  // ── 代码自检（自更新）：启动快照基线 + 变化判定 + 自重启（见 self-update.ts）──
  let updateTimer: ReturnType<typeof setInterval> | null = null;
  let selfUpdate: { codeChanged(): boolean; requestRestart(): void } | null = null;

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
    onAccelerate: (on, seconds) => {
      if (accelOffTimer) clearTimeout(accelOffTimer);
      accelOffTimer = null;
      if (on) {
        scheduler.setAccel(true);
        log(`accelerate on${seconds ? ` for ${seconds}s` : ''}`);
        const ms = Math.min(seconds && seconds > 0 ? seconds * 1000 : 5 * 60_000, 30 * 60_000);
        accelOffTimer = setTimeout(() => {
          scheduler.setAccel(false);
          accelOffTimer = null;
          log('accelerate auto-off');
        }, ms);
      } else {
        scheduler.setAccel(false);
        log('accelerate off');
      }
    },
    onShutdown: () => selfShutdown?.(),
    // 壳启动通知（ensure hello 后 fire-and-forget）：立即检查代码是否已更新。
    onCheckUpdate: () => {
      const changed = selfUpdate?.codeChanged() ?? false;
      if (changed) {
        // 延迟一拍：先让响应写回客户端，再执行自重启（释放 socket/退出）。
        setTimeout(() => selfUpdate?.requestRestart(), 120);
      }
      return { changed };
    },
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
    if (updateTimer) clearInterval(updateTimer);
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

  // ── 自更新装配（须在 stop 之后，requestRestart 依赖 stop）──
  const monitorDirs = opts.monitorDirs ?? resolveCodeDirs(__dirname) ?? [];
  const baseline: CodeFingerprint = monitorDirs.length > 0 ? fingerprintDirs(monitorDirs) : {};
  const updateCheckMs = opts.updateCheckIntervalMs ?? DEFAULT_UPDATE_CHECK_INTERVAL_MS;
  // 判定/重启可用性（与周期无关：socket checkUpdate / CLI 手动触发仍有效）；
  // 周期 timer 仅在 updateCheckMs > 0 且目录有效时启动。
  const monitorReady = monitorDirs.length > 0 && hasFiles(baseline);
  if (updateCheckMs > 0 && !monitorReady) {
    log('代码自检不可用（监控目录为空/解析失败）——部署新代码后不会自动重启');
  } else if (monitorReady) {
    log(
      `代码自检${updateCheckMs > 0 ? `开启（周期 ${updateCheckMs}ms）` : '可用（周期关闭，等待外部触发）'}：监控 ${monitorDirs.length} 目录 / ${Object.keys(baseline).length} 文件`,
    );
  }
  let lastRestartAt = 0;
  let restarting = false;
  const codeChanged = (): boolean => {
    if (!monitorReady || restarting) return false;
    return isChanged(baseline, fingerprintDirs(monitorDirs));
  };
  const requestRestart = (): void => {
    if (restarting) return;
    if (Date.now() - lastRestartAt < RESTART_COOLDOWN_MS) {
      log('检测到代码变更，但处于自重启防抖窗口——跳过（下周期再试）');
      return;
    }
    restarting = true;
    log('检测到代码更新——自重启以加载新代码…');
    // 先摘除 socket 文件：子进程 bind 同路径时不受旧文件阻碍（旧 server 在已
    // unlink 的 inode 上继续服务至 stop()，短暂空窗内客户端重连即可）。
    try {
      rmSync(socketPath, { force: true });
    } catch {
      /* 清理失败无碍 */
    }
    try {
      spawnRestartProcess(restartSpec(), log, opts.spawnRestartImpl);
    } catch {
      // spawnRestartProcess 已记录日志
      restarting = false;
      return;
    }
    lastRestartAt = Date.now();
    // 让位租约（继任者免等 TTL 立即接管）→ 清理 → 退出；新进程随后持主运行新代码。
    try {
      store.lease.release(SCHEDULER_LEADER_ID);
      log('租约已让位（release）');
    } catch (err: any) {
      log(`让位失败（将由 TTL 过期兜底）: ${err?.message || String(err)}`);
    }
    const exitProcess = opts.exitProcess ?? ((code: number) => process.exit(code));
    void stop().then(() => exitProcess(0));
  };
  selfUpdate = { codeChanged, requestRestart };
  if (monitorReady && updateCheckMs > 0) {
    updateTimer = setInterval(() => {
      if (codeChanged()) requestRestart();
    }, updateCheckMs);
    if (typeof updateTimer.unref === 'function') updateTimer.unref();
  }
  // shutdown（socket 命令）：优雅退出进程。
  selfShutdown = () => {
    void stop().then(() => process.exit(0));
  };

  return { store, scheduler, server, stop, codeChanged, requestRestart };
}
