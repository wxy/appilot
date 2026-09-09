import { ipcMain } from "electron";
import { log } from "@appilot-labs/appilot-core/logger";
import {
  isSchedulerTimerActive,
  isTaskCenterStopped,
  enableTaskScheduler,
  stopTaskScheduler,
  schedulerStatusSnapshot,
  schedulerTick,
  setSchedulerAccel,
  itunesSearchBlockState,
  type ScheduledTask,
} from "../scheduler";
import { computeRankSchedulerStatus } from "../scheduler-status";
import { getStore } from "../store";
import { sharedStore } from "../registry-sync";
import { runTaskNow } from "../scheduler";
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
  ensureSchedulerTracked,
  waitSchedulerDown,
  clearSpawnRecord,
  getSpawnRecord,
  currentDaemonPid,
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

/** daemon socket 路径（与共享 DB 同目录，包内约定一致）。 */
function schedulerSocketPath(): string {
  try {
    const { defaultSocketPath } = require("@appilot-labs/appilot-scheduler") as typeof import("@appilot-labs/appilot-scheduler");
    const { defaultDbPath } = require("@appilot-labs/appilot-headless") as typeof import("@appilot-labs/appilot-headless");
    return defaultSocketPath(process.env.APPILOT_DB_FILE || defaultDbPath());
  } catch {
    return "";
  }
}

/**
 * schedulerManager（每次 status 实时计算）：
 * - 磁盘指纹：resolveSchedulerCli() 入口文件内容 SHA-1（文件极小，代价可忽略）；
 * - 运行指纹：仅当「本壳拉起并确认存活」的 daemon 记录 pid 与当前 live hello pid
 *   吻合时取记录值——否则 null（历史/非本壳拉起/自重启过 → unknown）。
 */
async function computeSchedulerManager(): Promise<SchedulerManagerStatus> {
  const leader = currentLeader();
  const daemon = daemonStatus();
  let runningFingerprint: string | null = null;
  if (daemon.running) {
    const record = getSpawnRecord();
    if (record && record.pid > 0) {
      const socketPath = schedulerSocketPath();
      const livePid = socketPath ? await currentDaemonPid(socketPath) : null;
      if (livePid != null && livePid === record.pid) {
        runningFingerprint = record.fingerprint;
      }
    }
  }
  return deriveSchedulerManager({
    daemonRunning: daemon.running,
    shellRunning: leader === "electron",
    userStopped: isTaskCenterStopped(),
    runningFingerprint,
    diskFingerprint: diskSchedulerFingerprint(),
  });
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
    const accel = s.get("schedulerAccel") === true;
    const until = s.get("schedulerAccelUntil");
    const accelRemainingMs =
      accel && until
        ? Math.max(0, new Date(until).getTime() - now)
        : null;
    return {
      enabled: isSchedulerTimerActive(),
      userStopped: isTaskCenterStopped(),
      accel,
      accelRemainingMs,
      leader: currentLeader(),
      daemon: daemonStatus(),
      // 调度器指纹监测：运行 vs 磁盘 版本比对（mismatch → 提示重启；unknown →
      // 历史 daemon 或磁盘不可得 → 建议重启一次纳入监测）。
      schedulerManager: await computeSchedulerManager(),
      // iTunes Search 403 熔断状态（自动采集暂停提示用）。
      itunesSearchBlock: itunesSearchBlockState(s),
      ...computeRankSchedulerStatus(tasks, now),
    };
  });

  ipcMain.handle("scheduler:setAccel", async (_event, enabled: boolean) => {
    // P5-2a：本进程是调度主 → 壳内加速；daemon 主 → 发 daemon accelerate；
    // 其他主（dsh 壳）→ 暂无干预通道（过渡期，返回 false）。
    const leader = currentLeader();
    if (leader === "electron") {
      await setSchedulerAccel(Boolean(enabled));
      return true;
    }
    if (leader === "scheduler") {
      return sendToDaemon("accelerate", { on: Boolean(enabled), seconds: enabled ? 300 : undefined });
    }
    return false;
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
    // 含 daemon 执行状态）。执行统计（executions）仍取 electron-store。
    const s = await getStore();
    const dbStore = sharedStore();
    const dbTasks = taskCenterTasksFromDb(dbStore);
    const dbOverview = taskCenterOverviewFromDb(dbStore);
    const now = Date.now();
    const executions: any[] = (() => {
      try {
        return sharedStore().executions.latest(20000);
      } catch {
        return s.get("rankExecutions") || [];
      }
    })();
    // 执行统计与 scheduler:overview 同一口径（computeExecutionStats）：
    // 保证事件路径的 overview 整块合并不会让入榜率/流量字段缺失闪 0。
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

  ipcMain.handle("scheduler:runDue", async () => {
    await schedulerTick();
    return true;
  });

  ipcMain.handle("scheduler:runTaskNow", async (_event, taskId: string) => {
    // P5-2a：本进程主 → 壳内立即运行；daemon 主 → daemon runNow；其他主 → false。
    const leader = currentLeader();
    if (leader === "electron") {
      return runTaskNow(taskId);
    }
    if (leader === "scheduler") {
      const res = await sendToDaemon("runNow", { taskId });
      return res === true;
    }
    return false;
  });

  // 排名覆盖热力图（全局监督视图）：产品×商店 × 5词/桶 点阵。
  ipcMain.handle("scheduler:matrix", async (_e, opts?: { windowHours?: number }) => {
    const h = Number(opts?.windowHours ?? 24);
    const windowMs = (Number.isFinite(h) && h > 0 ? h : 24) * 3600 * 1000;
    return buildRankCoverageMatrix(sharedStore(), { windowMs });
  });

  // ── 任务中心控制（架构收敛 C2）：daemon（常驻）启停 + 本壳 fallback 同步 ──
  ipcMain.handle("scheduler:daemonStart", async () => {
    // 1) 恢复本壳 fallback（先清除停止标记——若 daemon 拉起失败仍有壳兜底）
    enableTaskScheduler();
    // 2) 确保 daemon 在跑（在跑则复用；未跑 spawn detached；单例仲裁自动处理）。
    //    由我们拉起并确认存活时记录 { pid, 磁盘指纹 }（scheduler:status 用它
    //    推导 schedulerManager.runningFingerprint）。
    try {
      const { defaultSocketPath, resolveSchedulerCli } = require("@appilot-labs/appilot-scheduler") as typeof import("@appilot-labs/appilot-scheduler");
      const { defaultDbPath } = require("@appilot-labs/appilot-headless") as typeof import("@appilot-labs/appilot-headless");
      const cli = resolveSchedulerCli();
      const socketPath = defaultSocketPath(process.env.APPILOT_DB_FILE || defaultDbPath());
      // spawn 时刻的磁盘指纹：同时写入 daemon env（预留自报）并作为运行指纹候选。
      const fingerprint = diskSchedulerFingerprint(cli ? () => cli : null);
      const res = await ensureSchedulerTracked({
        socketPath,
        spawnCommand: cli ? [process.execPath, cli] : undefined,
        fingerprint,
        timeoutMs: 5000,
        log: (m) => log.info(`appilot: ${m}`),
      });
      return {
        ok: res.ok,
        stopped: false,
        spawned: res.spawned,
        pid: res.pid,
        // daemon 已在本调用确认存活（复用旧 daemon 时为 null → unknown）。
        fingerprint: res.ok && res.spawned ? fingerprint : null,
        error: res.error,
      };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle("scheduler:daemonStop", async () => {
    const leader = currentLeader();
    // 无条件尝试关闭 daemon 进程：即使 daemon 当前非主（leader=electron）也可能
    // 挂在后台，启动时会复用来接管（表现为“原来的调度器没退出”）。
    let daemonStopped = false;
    try {
      daemonStopped = (await sendToDaemon("shutdown", {})) === true;
    } catch (err: any) {
      log.warn(`daemon shutdown 发送失败: ${err.message}`);
    }
    // 本壳 fallback 一并暂停——避免 daemon 让位后壳循环在下一 tick 接管（等于没停）
    stopTaskScheduler();
    // 等 daemon 进程退出（socket 移除）再返回——「重启」按钮的 stop→start 顺序
    // 依赖此保证：立即 start 不会复用到正在退出的旧 daemon。
    if (daemonStopped) {
      await waitSchedulerDown(schedulerSocketPath(), 3000).catch(() => undefined);
    }
    // 运行中指纹记录随 daemon 停止失效（下次拉起会重记）。
    clearSpawnRecord();
    log.info(`appilot: 任务中心停止完成（daemonStopped=${daemonStopped} leader=${leader}）`);
    return {
      ok: daemonStopped || leader !== "scheduler",
      stoppedDaemon: daemonStopped,
      stoppedShell: true,
      leader,
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
    // 2) 非 Electron 源失败实例行（daemon/CLI 等）直清 DB
    const store = sharedStore();
    const rows = store.tasks
      .all()
      .filter(
        (t) =>
          t.kind != null &&
          t.lastStatus === "error" &&
          (t.source ?? "electron") !== "electron",
      );
    const byKind: Record<string, number> = {};
    const now = Date.now();
    for (const r of rows) {
      const spreadMin = reschedule ? 30 + (hashOf(r.id) % 180) : 0;
      store.tasks.upsert({
        id: r.id,
        title: r.title,
        intervalMinutes: r.intervalMinutes,
        lastRunAt: r.lastRunAt,
        nextRunAt: reschedule
          ? new Date(now + spreadMin * 60_000).toISOString()
          : r.nextRunAt,
        lastStatus: "never",
        lastSummary: null,
        runCount: r.runCount,
        source: r.source,
        kind: r.kind,
        instance: r.instance,
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
 * P5-2a/C2 辅助：当前调度主 + daemon 命令发送。
 * （currentLeader/daemonStatus 定义见文件头——daemon 启停用 lease 状态判断。）
 */

async function sendToDaemon(
  method: "accelerate" | "runNow" | "shutdown",
  params: Record<string, unknown>,
): Promise<boolean> {
  try {
    const {
      sendSchedulerCommand,
      defaultSocketPath,
    } = require("@appilot-labs/appilot-scheduler") as typeof import("@appilot-labs/appilot-scheduler");
    const { defaultDbPath } = require("@appilot-labs/appilot-headless") as typeof import("@appilot-labs/appilot-headless");
    const socketPath = defaultSocketPath(process.env.APPILOT_DB_FILE || defaultDbPath());
    const res = await sendSchedulerCommand(socketPath, method, params);
    return res.ok === true;
  } catch {
    return false;
  }
}

/**
 * 应用退出时（设置「退出同时退出后台调度器」开启）调用：关 daemon + 停本壳调度。
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
  } catch {
    /* 退出路径静默 */
  }
  try {
    await waitSchedulerDown(schedulerSocketPath(), 2500).catch(() => undefined);
  } catch {
    /* 忽略等待超时 */
  }
  clearSpawnRecord();
}
