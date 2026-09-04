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
  type ScheduledTask,
} from "../scheduler";
import { computeRankSchedulerStatus } from "../scheduler-status";
import { getStore } from "../store";
import { sharedStore } from "../registry-sync";
import { taskCenterTasksFromDb, taskCenterOverviewFromDb } from "../task-center-db";
import { clearElectronFailures, mirrorTasksToDb } from "../task-db-sync";
import { buildRankCoverageMatrix } from "../rank-matrix";

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
  ipcMain.handle("scheduler:overview", async () => {
    const s = await getStore();
    const tasks: ScheduledTask[] = s.get("scheduledTasks") || [];
    const now = Date.now();
    const executions: any[] = s.get("rankExecutions") || [];
    const dayMs = 24 * 60 * 60 * 1000;
    const recent = executions.filter(
      (entry) => new Date(entry.ts).getTime() >= now - dayMs,
    );
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
    const executedToday = executions.filter(
      (entry) => new Date(entry.ts).getTime() >= todayStart.getTime(),
    ).length;
    const pending = enabled.filter(
      (task) => !todayExecutedTaskIds.has(task.id),
    ).length;
    const totalExecuted = tasks.reduce(
      (sum, task) => sum + (task.executionCount || 0),
      0,
    );
    const avgDurationMs = recent.length
      ? Math.round(
          recent.reduce((sum, entry) => sum + (entry.durationMs || 0), 0) /
            recent.length,
        )
      : 0;
    const successRate = recent.length
      ? Math.round(
          (recent.filter((entry) => entry.status === "success").length /
            recent.length) *
            100,
        )
      : null;
    const nextDue = enabled
      .map((task) => new Date(task.nextRunAt).getTime())
      .sort((a, b) => a - b)[0];
    return {
      overview: {
        total: tasks.length,
        pending,
        overdue,
        executedToday,
        totalExecuted,
        avgDurationMs,
        densityPerHour: Math.round((recent.length / 24) * 10) / 10,
        successRate,
        nextDueAt: nextDue ? new Date(nextDue).toISOString() : null,
      },
      nowRunning: schedulerStatusSnapshot().nowRunning || null,
    };
  });

  // 执行时间线独立接口：柱形图单独刷新，不拖慢任务列表。
  ipcMain.handle("scheduler:timeline", async () => {
    const s = await getStore();
    const tasks: ScheduledTask[] = s.get("scheduledTasks") || [];
    const executions: any[] = s.get("rankExecutions") || [];
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
    const executions: any[] = s.get("rankExecutions") || [];
    const dayMs = 24 * 60 * 60 * 1000;
    const recent = executions.filter(
      (entry) => new Date(entry.ts).getTime() >= now - dayMs,
    );
    const success = recent.filter((entry) => entry.status === "success");
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
    const executedToday = executions.filter(
      (entry) => new Date(entry.ts).getTime() >= todayStart.getTime(),
    ).length;
    const pending = dbTasks.filter(
      (task) => !todayExecutedTaskIds.has(task.id),
    ).length;
    const totalExecuted = dbTasks.reduce(
      (sum, task) => sum + (task.executionCount || 0),
      0,
    );
    const avgDurationMs = recent.length
      ? Math.round(
          recent.reduce((sum, entry) => sum + (entry.durationMs || 0), 0) /
            recent.length,
        )
      : 0;
    const successRate = recent.length
      ? Math.round((success.length / recent.length) * 100)
      : null;
    const hitRate = success.length
      ? Math.round(
          (success.filter((entry) => entry.rank != null).length / success.length) *
            100,
        )
      : null;

    return {
      ...schedulerStatusSnapshot(),
      overview: {
        total: dbOverview.total,
        pending,
        overdue: dbOverview.overdue,
        executedToday,
        totalExecuted,
        avgDurationMs,
        densityPerHour: Math.round((recent.length / 24) * 10) / 10,
        successRate,
        hitRate,
        requestBytes: recent.reduce((sum, entry) => sum + (entry.requestBytes || 0), 0),
        responseBytes: recent.reduce((sum, entry) => sum + (entry.responseBytes || 0), 0),
        nextDueAt: dbOverview.nextDueAt,
      },
      tasks: dbTasks,
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
      const { runTaskNow } = await import("../scheduler");
      return runTaskNow(taskId);
    }
    if (leader === "scheduler") {
      const res = await sendToDaemon("runNow", { taskId });
      return res === true;
    }
    return false;
  });

  // 排名覆盖热力图（全局监督视图）：产品×商店 × 5词/桶 点阵。
  ipcMain.handle("scheduler:matrix", async () => buildRankCoverageMatrix(sharedStore()));

  // ── 任务中心控制（架构收敛 C2）：daemon（常驻）启停 + 本壳 fallback 同步 ──
  ipcMain.handle("scheduler:daemonStart", async () => {
    // 1) 恢复本壳 fallback（先清除停止标记——若 daemon 拉起失败仍有壳兜底）
    enableTaskScheduler();
    // 2) 确保 daemon 在跑（在跑则复用；未跑 spawn detached；单例仲裁自动处理）
    try {
      const { ensureScheduler, defaultSocketPath, resolveSchedulerCli } = require("@appilot-labs/appilot-scheduler") as typeof import("@appilot-labs/appilot-scheduler");
      const { defaultDbPath } = require("@appilot-labs/appilot-headless") as typeof import("@appilot-labs/appilot-headless");
      const cli = resolveSchedulerCli();
      const ok = await ensureScheduler({
        socketPath: defaultSocketPath(process.env.APPILOT_DB_FILE || defaultDbPath()),
        spawnCommand: cli ? [process.execPath, cli] : undefined,
        timeoutMs: 5000,
        log: (m) => log.info(`appilot: ${m}`),
      });
      return { ok, stopped: false };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle("scheduler:daemonStop", async () => {
    const leader = currentLeader();
    let daemonStopped = false;
    if (leader === "scheduler") {
      // daemon 主：发 shutdown → daemon 优雅让位退出
      daemonStopped = await sendToDaemon("shutdown", {});
    }
    // 本壳 fallback 一并暂停——避免 daemon 让位后壳循环在下一 tick 接管（等于没停）
    stopTaskScheduler();
    return {
      ok: daemonStopped || leader !== "scheduler",
      stoppedDaemon: daemonStopped,
      stoppedShell: true,
      leader,
    };
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
