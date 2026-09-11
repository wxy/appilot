import { ipcMain } from "electron";
import { log } from "@appilot-labs/appilot-core/logger";
import {
  isTaskCenterStopped,
  enableTaskScheduler,
  stopTaskScheduler,
  schedulerStatusSnapshot,
  schedulerTick,
  itunesSearchBlockState,
  runTaskNow,
  type ScheduledTask,
} from "../scheduler";
import { computeRankSchedulerStatus } from "../scheduler-status";
import { getStore } from "../store";
import { sharedStore } from "../registry-sync";
import { taskCenterTasksFromDb, taskCenterOverviewFromDb } from "../task-center-db";
import { clearElectronFailures, mirrorTasksToDb } from "../task-db-sync";
import { buildRankCoverageMatrix } from "../rank-matrix";
import { computeExecutionStats, EXEC_STATS_WINDOW_MS } from "../execution-stats";
import {
  diskSchedulerFingerprint,
  deriveSchedulerManager,
  type SchedulerManagerStatus,
} from "../scheduler-fingerprint";
import {
  ensureSchedulerDaemon,
  waitSchedulerDown,
  getSpawnRecord,
  currentDaemonPid,
  readDaemonSelfState,
  getDaemonEnsureState,
  markDaemonStopped,
  markDaemonResumed,
  resolveDaemonSpawnConfig,
  deriveSchedulerEngine,
  type DaemonSelfState,
} from "../daemon-manager";

// 租约心跳新鲜度窗口（与各壳 acquire TTL 一致 60s；daemon 心跳 15s）。
const DAEMON_HEARTBEAT_TTL_MS = 60_000;

/** 当前调度主（lease 直读；DB 不可读返回 null）。 */
function currentLeader(): string | null {
  try {
    return sharedStore().lease.leader();
  } catch {
    return null;
  }
}

/** daemon 状态：租约主为 scheduler 且心跳新鲜 = 常驻 daemon 在调度。 */
function daemonStatus(): { running: boolean; leaderId: string | null; heartbeatAt: string | null } {
  try {
    const info = sharedStore().lease.info();
    const running =
      info?.leaderId === "scheduler" &&
      new Date(info.heartbeatAt).getTime() >= Date.now() - DAEMON_HEARTBEAT_TTL_MS;
    return { running, leaderId: info?.leaderId ?? null, heartbeatAt: info?.heartbeatAt ?? null };
  } catch {
    return { running: false, leaderId: null, heartbeatAt: null };
  }
}

/**
 * schedulerManager（每次 status 实时计算）：
 * - 磁盘指纹：resolveSchedulerCli() 入口文件内容 SHA-1；
 * - 运行指纹：优先 daemon 自报（socket status.fingerprint，壳 spawn 时注入）；
 *   旧 daemon 不自报时退回「本壳拉起记录 pid 与 live hello pid 吻合」的记录值，
 *   否则 null（unknown → UI 提示重启一次纳入监测）。
 */
async function computeSchedulerManager(facts: {
  daemonRunning: boolean;
  runningFingerprint: string | null;
  userStopped: boolean;
}): Promise<SchedulerManagerStatus> {
  let runningFingerprint = facts.runningFingerprint;
  if (facts.daemonRunning && runningFingerprint == null) {
    const record = getSpawnRecord();
    if (record && record.pid > 0) {
      const livePid = await currentDaemonPid(resolveDaemonSpawnConfig().socketPath);
      if (livePid != null && livePid === record.pid) {
        runningFingerprint = record.fingerprint;
      }
    }
  }
  return deriveSchedulerManager({
    daemonRunning: facts.daemonRunning,
    shellRunning: false, // 壳内调度已移除（架构收敛 A）——绝不出现 inapp 模式
    userStopped: facts.userStopped,
    runningFingerprint,
    diskFingerprint: diskSchedulerFingerprint(),
  });
}

/** daemon socket 路径（resolveDaemonSpawnConfig 同源，读取/发送统一）。 */
function daemonSocketPath(): string {
  return resolveDaemonSpawnConfig().socketPath;
}

/** 向 daemon socket 发一条命令（成功返回 true；不可达/异常 false）。 */
async function sendToDaemon(
  method: "accelerate" | "runNow" | "shutdown" | "suspend" | "resume",
  params: Record<string, unknown>,
): Promise<boolean> {
  try {
    const { sendSchedulerCommand } = require("@appilot-labs/appilot-scheduler") as typeof import("@appilot-labs/appilot-scheduler");
    const res = await sendSchedulerCommand(daemonSocketPath(), method, params, method === "runNow" ? 15_000 : 5000);
    return res.ok === true;
  } catch {
    return false;
  }
}

/**
 * 通知 daemon 系统即将休眠 / 已唤醒（powerMonitor 'suspend'/'resume'）。
 * 休眠期 daemon 不派发新任务；唤醒后按休眠窗口节拍恢复调度。daemon 不可达时
 * 静默失败——daemon 侧有 tick 间隔自检兜底（见 headless sleep-window.ts）。
 */
export async function notifyDaemonPowerState(suspended: boolean): Promise<boolean> {
  return sendToDaemon(suspended ? "suspend" : "resume", {});
}

function computeTimeline(
  tasks: ScheduledTask[],
  executions: any[],
  now: number,
): {
  recent: { hour: number; success: number; failed: number }[];
  upcoming: { hour: number; count: number }[];
} {
  const dayMs = 24 * 60 * 60 * 1000;
  const recent = executions.filter(
    (entry) => new Date(entry.ts).getTime() >= now - dayMs,
  );
  const enabled = tasks.filter((task) => task.enabled);
  const hourStart = (ts: number) => {
    const d = new Date(ts);
    d.setMinutes(0, 0, 0);
    return d.getTime();
  };
  const recentTimeline: { hour: number; success: number; failed: number }[] = [];
  for (let i = 23; i >= 0; i--) {
    const start = hourStart(now) - i * 60 * 60 * 1000;
    const end = start + 60 * 60 * 1000;
    const inHour = recent.filter((entry) => {
      const ts = new Date(entry.ts).getTime();
      return ts >= start && ts < end;
    });
    recentTimeline.push({
      hour: start,
      success: inHour.filter((entry) => entry.status === "success").length,
      failed: inHour.filter((entry) => entry.status === "failed").length,
    });
  }
  const upcomingTimeline: { hour: number; count: number }[] = [];
  for (let i = 0; i < 24; i++) {
    const start = hourStart(now) + i * 60 * 60 * 1000;
    const end = start + 60 * 60 * 1000;
    upcomingTimeline.push({
      hour: start,
      count: enabled.filter((task) => {
        const ts = new Date(task.nextRunAt).getTime();
        return ts >= start && ts < end;
      }).length,
    });
  }
  return { recent: recentTimeline, upcoming: upcomingTimeline };
}

/** 任务中心统计用任务集：优先共享 DB tasks（taskCenter 视图），DB 为空回退 kv。 */
async function statsTasksFromDb(s: {
  get<T = any>(key: string): T;
}): Promise<ScheduledTask[]> {
  try {
    const dbTasks = taskCenterTasksFromDb(sharedStore());
    if (dbTasks.length > 0) {
      return dbTasks.map((t) => ({
        id: t.id,
        kind: t.kind,
        title: t.title ?? null,
        intervalMinutes: t.intervalMinutes,
        nextRunAt: t.nextRunAt,
        lastRunAt: t.lastRunAt,
        lastStatus: t.lastStatus,
        executionCount: t.executionCount || 0,
        enabled: !String(t.title ?? "").includes("已停用") && Boolean(t.nextRunAt),
      })) as unknown as ScheduledTask[];
    }
  } catch {
    // 回退 kv
  }
  return (s.get("scheduledTasks") || []) as ScheduledTask[];
}

export function registerSchedulerHandlers(): void {
  ipcMain.handle("scheduler:status", async () => {
    const s = await getStore();
    const tasks: ScheduledTask[] = s.get("scheduledTasks") || [];
    const now = Date.now();
    const userStopped = isTaskCenterStopped();
    const socketPath = daemonSocketPath();
    // daemon 自状态（socket status）：旧 daemon 未实现 → null（graceful）。
    const daemonSelf: DaemonSelfState | null = await readDaemonSelfState(socketPath);
    // 在服务判定：socket 自状态可得 OR 租约主=scheduler 且心跳新鲜。
    const leaseUp = daemonStatus();
    const running = daemonSelf != null || leaseUp.running;
    const livePid = daemonSelf?.daemonPid ?? (socketPath ? await currentDaemonPid(socketPath) : null);
    const accel = daemonSelf?.accel === true;
    const accelUntil = daemonSelf?.accelUntil ?? null;
    const accelRemainingMs =
      accel && accelUntil
        ? Math.max(0, new Date(accelUntil).getTime() - now)
        : null;
    const ensure = getDaemonEnsureState();
    const engine = deriveSchedulerEngine({
      userStopped,
      daemonRunning: running,
      ensureStatus: ensure.status,
      ensureError: ensure.error,
      ensureLastAttemptAt: ensure.lastAttemptAt,
    });
    const schedulerManager = await computeSchedulerManager({
      daemonRunning: running,
      runningFingerprint: daemonSelf?.fingerprint ?? null,
      userStopped,
    });
    return {
      // KeywordsPage 等旧消费者：enabled = 自动调度在跑（daemon 且未暂停）。
      enabled: running && !userStopped,
      userStopped,
      accel,
      accelRemainingMs,
      leader: livePid != null ? "scheduler" : currentLeader(),
      daemon: leaseUp,
      // daemon 自维护状态（启动于/运行时长/已处理等；不可得为 null）。
      daemonSelf,
      // 调度器指纹监测（运行 vs 磁盘；运行指纹优先 daemon 上报）。
      schedulerManager,
      // 统一调度器状态机（运行中(daemon)/已停止/异常/启动中）。
      engine,
      // iTunes Search 403 熔断状态（自动采集暂停提示用）。
      itunesSearchBlock: itunesSearchBlockState(s),
      ...computeRankSchedulerStatus(tasks, now),
    };
  });

  ipcMain.handle("scheduler:setAccel", async (_event, enabled: boolean) => {
    // 加速只作用于常驻 daemon（壳内加速已移除——壳不再执行调度）。
    return sendToDaemon("accelerate", { on: Boolean(enabled), seconds: enabled ? 300 : undefined });
  });

  // 轻量统计：单独刷新顶部面板，避免被 1000+ 任务的完整列表计算拖慢。
  // 注意：overview 与 list 必须输出同一组统计字段（hitRate/traffic 也在此
  // 计算），否则事件路径用 overview 整块覆盖 list 结果时，缺失的字段会让
  // 入榜率/流量在每次更新瞬间闪成 —/0。
  ipcMain.handle("scheduler:overview", async () => {
    const s = await getStore();
    const tasks: ScheduledTask[] = await statsTasksFromDb(s);
    const now = Date.now();
    const executions: any[] = (() => {
      try {
        return sharedStore().executions.latest(20000);
      } catch {
        return s.get("rankExecutions") || [];
      }
    })();
    const stats = computeExecutionStats(executions, now, EXEC_STATS_WINDOW_MS);
    const enabled = tasks.filter((task) => task.enabled);
    const overdue = enabled.filter(
      (task) => new Date(task.nextRunAt).getTime() <= now,
    ).length;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayExecutedTaskIds = new Set(
      executions
        .filter(
          (entry: any) =>
            entry.taskId &&
            new Date(entry.ts).getTime() >= todayStart.getTime(),
        )
        .map((entry: any) => entry.taskId),
    );
    const pending = enabled.filter(
      (task) => !todayExecutedTaskIds.has(task.id),
    ).length;
    const totalExecuted = tasks.reduce(
      (sum, task) => sum + (task.executionCount || 0),
      0,
    );
    const nextDue = enabled
      .map((task) => new Date(task.nextRunAt).getTime())
      .sort((a, b) => a - b)[0];
    return {
      overview: {
        total: tasks.length,
        pending,
        overdue,
        executedToday: stats.executedToday,
        totalExecuted,
        avgDurationMs: stats.avgDurationMs,
        densityPerHour: stats.densityPerHour,
        successRate: stats.successRate,
        hitRate: stats.hitRate,
        requestBytes: stats.requestBytes,
        responseBytes: stats.responseBytes,
        nextDueAt: nextDue ? new Date(nextDue).toISOString() : null,
      },
      nowRunning: schedulerStatusSnapshot().nowRunning || null,
      // iTunes Search 403 熔断状态（自动采集暂停提示用；与 list 同字段，
      // 保证事件路径 overview 整块合并时提示不会闪失）。
      itunesSearchBlock: itunesSearchBlockState(s),
    };
  });

  // 执行时间线独立接口：柱形图单独刷新，不拖慢任务列表。
  ipcMain.handle("scheduler:timeline", async () => {
    const s = await getStore();
    const tasks: ScheduledTask[] = await statsTasksFromDb(s);
    const executions: any[] = (() => {
      try {
        return sharedStore().executions.latest(20000);
      } catch {
        return s.get("rankExecutions") || [];
      }
    })();
    return computeTimeline(tasks, executions, Date.now());
  });

  ipcMain.handle("scheduler:list", async () => {
    // 最终要求：任务中心读共享 DB（与 DSH/CLI/MCP 同一份活动任务，
    // 含 daemon 执行状态）。执行统计（executions）取共享 DB。
    const s = await getStore();
    const dbStore = sharedStore();
    const dbTasks = taskCenterTasksFromDb(dbStore);
    const dbOverview = taskCenterOverviewFromDb(dbStore, dbTasks);
    const now = Date.now();
    const executions: any[] = (() => {
      try {
        return sharedStore().executions.latest(20000);
      } catch {
        return s.get("rankExecutions") || [];
      }
    })();
    // 执行统计与 scheduler:overview 同一口径（computeExecutionStats）。
    const stats = computeExecutionStats(executions, now, EXEC_STATS_WINDOW_MS);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayExecutedTaskIds = new Set(
      executions
        .filter(
          (entry: any) =>
            entry.taskId &&
            new Date(entry.ts).getTime() >= todayStart.getTime(),
        )
        .map((entry: any) => entry.taskId),
    );
    const pending = dbTasks.filter(
      (task) => !todayExecutedTaskIds.has(task.id),
    ).length;
    const totalExecuted = dbTasks.reduce(
      (sum, task) => sum + (task.executionCount || 0),
      0,
    );

    return {
      ...schedulerStatusSnapshot(),
      overview: {
        total: dbOverview.total,
        pending,
        overdue: dbOverview.overdue,
        executedToday: stats.executedToday,
        totalExecuted,
        avgDurationMs: stats.avgDurationMs,
        densityPerHour: stats.densityPerHour,
        successRate: stats.successRate,
        hitRate: stats.hitRate,
        requestBytes: stats.requestBytes,
        responseBytes: stats.responseBytes,
        nextDueAt: dbOverview.nextDueAt,
      },
      tasks: dbTasks,
      // iTunes Search 403 熔断状态（任务中心顶部提示用）。
      itunesSearchBlock: itunesSearchBlockState(s),
    };
  });

  // 「立即执行到期」：壳先 reconcile（任务池/DB 实例同步）→ 通知 daemon
  // 立即 tick 处理到期（架构收敛 A：daemon-only，壳不再执行）。
  ipcMain.handle("scheduler:runDue", async () => {
    await schedulerTick();
    return true;
  });

  ipcMain.handle("scheduler:runTaskNow", async (_event, taskId: string) => {
    // daemon 优先：常驻 daemon 在服务时发 runNow（DB 实例：rank/github-sync）。
    // 失败/不在服务 → 回退壳内手动执行（用户显式「立即执行」；daemon 无法执行
    // 的 electron 域任务 ops-sync/reviews-sync/build-status 只能壳内直跑——
    // 属于显式手动操作，不构成壳作为自动调度执行体）。
    if (await sendToDaemon("runNow", { taskId })) return true;
    return runTaskNow(taskId);
  });

  // 排名覆盖热力图（全局监督视图）：产品×商店 × 5词/桶 点阵。
  ipcMain.handle("scheduler:matrix", async (_e, opts?: { windowHours?: number }) => {
    const h = Number(opts?.windowHours ?? 24);
    const windowMs = (Number.isFinite(h) && h > 0 ? h : 24) * 3600 * 1000;
    return buildRankCoverageMatrix(sharedStore(), { windowMs });
  });

  // ── 任务中心控制（架构收敛 C）：唯一启停入口（壳内调度已移除）──
  ipcMain.handle("scheduler:daemonStart", async () => {
    // 1) 清除用户暂停标记（壳内已无调度循环可恢复，标记仅控制状态/watchdog）。
    enableTaskScheduler();
    markDaemonResumed();
    // 2) 确保常驻 daemon 在跑（在跑则复用；未跑 spawn detached；失败记录
    //    ensure 状态 → UI「调度器异常」，由 watchdog 周期重试）。
    try {
      const cfg = resolveDaemonSpawnConfig();
      const res = await ensureSchedulerDaemon({
        socketPath: cfg.socketPath,
        spawnCommand: cfg.spawnCommand,
        fingerprint: cfg.fingerprint,
        timeoutMs: 6000,
        log: (m) => log.info(`appilot: ${m}`),
      });
      return {
        ok: res.ok,
        stopped: false,
        spawned: res.spawned,
        pid: res.pid,
        fingerprint: res.ok && res.spawned ? cfg.fingerprint : null,
        error: res.error,
      };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle("scheduler:daemonStop", async () => {
    // 无条件尝试关闭 daemon 进程（即使当前不在服务也可能挂在后台）。
    const socketPath = daemonSocketPath();
    let wasUp = false;
    let daemonStopped = false;
    try {
      const { sendSchedulerCommand } = require("@appilot-labs/appilot-scheduler") as typeof import("@appilot-labs/appilot-scheduler");
      wasUp = (await sendSchedulerCommand(socketPath, "ping", {}, 1200)).ok === true;
      if (wasUp) {
        daemonStopped = (await sendSchedulerCommand(socketPath, "shutdown", {}, 5000)).ok === true;
      }
    } catch (err: any) {
      log.warn(`daemon shutdown 发送失败: ${err.message}`);
    }
    // 用户暂停标记（watchdog 停、UI 显示已停止）；壳内已无调度循环可暂停。
    stopTaskScheduler();
    markDaemonStopped();
    // 等 daemon 进程退出（socket 移除）再返回——「重启」按钮的 stop→start 顺序
    // 依赖此保证：立即 start 不会复用到正在退出的旧 daemon。
    if (daemonStopped) {
      await waitSchedulerDown(socketPath, 3000).catch(() => undefined);
    }
    log.info(`appilot: 任务中心停止完成（daemonStopped=${daemonStopped} wasUp=${wasUp}）`);
    return {
      ok: !wasUp || daemonStopped,
      stoppedDaemon: daemonStopped,
      stoppedShell: true,
      leader: currentLeader(),
    };
  });

  // 偏好：应用退出时是否同时退出后台 daemon（默认否 = 常驻继续采集）。
  ipcMain.handle("scheduler:preferences", async () => {
    const s = await getStore();
    return { exitWithDaemon: s.get("schedulerExitWithDaemon") === true };
  });
  ipcMain.handle("scheduler:setPreferences", async (_event, prefs: { exitWithDaemon?: boolean }) => {
    const s = await getStore();
    const exitWithDaemon = Boolean(prefs?.exitWithDaemon);
    s.set("schedulerExitWithDaemon", exitWithDaemon);
    return { exitWithDaemon };
  });

  // ── 失败任务批量处理（backlog #2）：clear = 清错误态按原排期；
  //    reschedule = 清错误态 + nextRunAt 限速摊铺（教训 B：同刻到期会触发
  //    上游限流，如 iTunes Search 403/429）──
  ipcMain.handle("scheduler:clearFailures", async (_e, mode: string) => {
    const reschedule = mode === "reschedule";
    // 双源清除（backlog #2 修复）：失败状态可能来自 electron-store（Electron
    // 池任务，mirror 每 10s 写回 DB → 只清 DB 会被 mirror 复活）或 daemon 域。
    // 1) Electron 源：清 failed 状态（原排期/摊铺重排）→ 立即 mirror 刷新 DB
    const s = await getStore();
    const tasks: any[] = s.get("scheduledTasks") || [];
    const clearedElectron = clearElectronFailures(tasks, reschedule ? "reschedule" : "clear");
    if (clearedElectron.cleared > 0) {
      s.set("scheduledTasks", clearedElectron.tasks);
      try {
        mirrorTasksToDb(sharedStore(), clearedElectron.tasks);
      } catch {
        /* 下轮 hydrate 会再镜像 */
      }
    }
    // 2) 直清 DB 里所有失败实例行（不区分源——electron 行的行级 error 与
    //    electronJson 可能不同步，只清 electron 源会被漏掉）：置 never 并清理
    //    electronJson 里的 failed/lastRunAt，engine 下次加载即为干净状态。
    const store = sharedStore();
    const rows = store.tasks
      .all()
      .filter((t) => t.kind != null && t.lastStatus === "error");
    const byKind: Record<string, number> = {};
    const now = Date.now();
    for (const r of rows) {
      const spreadMin = reschedule ? 30 + (hashOf(r.id) % 180) : 0;
      let electronJson: string | null = r.electronJson ?? null;
      if (electronJson) {
        try {
          const ej = JSON.parse(electronJson);
          if (ej && typeof ej === "object") {
            delete ej.lastStatus;
            delete ej.lastRunAt;
            ej.consecutiveFailures = 0;
            electronJson = JSON.stringify(ej);
          }
        } catch {
          // 解析失败保留原串
        }
      }
      store.tasks.upsert({
        id: r.id,
        title: r.title,
        intervalMinutes: r.intervalMinutes,
        lastRunAt: null,
        nextRunAt: reschedule
          ? new Date(now + spreadMin * 60_000).toISOString()
          : r.nextRunAt,
        lastStatus: "never",
        lastSummary: null,
        runCount: r.runCount,
        source: r.source,
        kind: r.kind,
        instance: r.instance,
        enabled: r.enabled !== false,
        electronJson,
      });
      const k = r.kind ?? "?";
      byKind[k] = (byKind[k] ?? 0) + 1;
    }
    return {
      mode: reschedule ? "reschedule" : "clear",
      cleared: clearedElectron.cleared + rows.length,
      electronCleared: clearedElectron.cleared,
      dbCleared: rows.length,
      byKind,
    };
  });
}

/** 稳定字符串哈希（id → 摊铺偏移用，无需加密强度）。 */
function hashOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * 应用退出时（设置「退出同时退出后台调度器」开启）调用：关 daemon + 置暂停标记。
 * 独立于 IPC，供 index 退出钩子复用，避免重复注册 handler。
 */
export async function stopSchedulerForAppExit(): Promise<void> {
  try {
    await sendToDaemon("shutdown", {});
  } catch (err: any) {
    log.warn(`daemon shutdown(exit) 发送失败: ${err.message}`);
  }
  try {
    stopTaskScheduler();
    markDaemonStopped();
  } catch {
    /* 退出路径静默 */
  }
  try {
    await waitSchedulerDown(daemonSocketPath(), 2500).catch(() => undefined);
  } catch {
    /* 忽略等待超时 */
  }
}
