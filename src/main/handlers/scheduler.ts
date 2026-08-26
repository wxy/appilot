import { ipcMain } from "electron";
import { migrateLegacyStoreProducts, findProductContext } from "../project-state";
import {
  isSchedulerTimerActive,
  schedulerStatusSnapshot,
  schedulerTick,
  setSchedulerAccel,
  type ScheduledTask,
} from "../scheduler";
import { computeRankSchedulerStatus } from "../scheduler-status";
import { getStore } from "../store";

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
      accel,
      accelRemainingMs,
      ...computeRankSchedulerStatus(tasks, now),
    };
  });

  ipcMain.handle("scheduler:setAccel", async (_event, enabled: boolean) => {
    await setSchedulerAccel(Boolean(enabled));
    return true;
  });

  ipcMain.handle("scheduler:list", async () => {
    const s = await getStore();
    const projects: any[] = (s.get("projects") || []).map(migrateLegacyStoreProducts);
    const tasks: ScheduledTask[] = s.get("scheduledTasks") || [];
    const rounds: Record<string, any> = s.get("schedulerRounds") || {};
    // Fallback round info for task lists that have not been reconciled yet
    // (e.g. right after an upgrade): members = group tasks, done = tasks that
    // have a lastRunAt, so the progress column is never empty.
    const roundByGroup: Record<string, { members: string[]; done: string[] }> = {};
    for (const task of tasks) {
      if (task.kind !== "rank" || !task.groupKey) continue;
      const entry = roundByGroup[task.groupKey] || { members: [], done: [] };
      entry.members.push(task.id);
      if (task.lastRunAt) entry.done.push(task.id);
      roundByGroup[task.groupKey] = entry;
    }
    const now = Date.now();
    const executions: any[] = s.get("rankExecutions") || [];
    const dayMs = 24 * 60 * 60 * 1000;
    const recent = executions.filter(
      (entry) => new Date(entry.ts).getTime() >= now - dayMs,
    );
    const success = recent.filter((entry) => entry.status === "success");
    const enabled = tasks.filter((task) => task.enabled);
    const overdue = enabled.filter(
      (task) => new Date(task.nextRunAt).getTime() <= now,
    ).length;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const executedToday = executions.filter(
      (entry) => new Date(entry.ts).getTime() >= todayStart.getTime(),
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
      ? Math.round((success.length / recent.length) * 100)
      : null;
    const hitRate = success.length
      ? Math.round(
          (success.filter((entry) => entry.rank != null).length / success.length) *
            100,
        )
      : null;
    const nextDue = enabled
      .map((task) => new Date(task.nextRunAt).getTime())
      .sort((a, b) => a - b)[0];

    // 24 hourly buckets of past executions + 24 hourly buckets of scheduled runs.
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

    return {
      ...schedulerStatusSnapshot(),
      overview: {
        total: tasks.length,
        pending: enabled.length,
        overdue,
        executedToday,
        totalExecuted,
        avgDurationMs,
        densityPerHour: Math.round((recent.length / 24) * 10) / 10,
        successRate,
        hitRate,
        requestBytes: recent.reduce((sum, entry) => sum + (entry.requestBytes || 0), 0),
        responseBytes: recent.reduce((sum, entry) => sum + (entry.responseBytes || 0), 0),
        nextDueAt: nextDue ? new Date(nextDue).toISOString() : null,
      },
      timeline: { recent: recentTimeline, upcoming: upcomingTimeline },
      tasks: tasks.map((task) => {
        const isProjectTask = task.kind === "github-sync" || task.kind === "ops-sync";
        const context: { project: any; product?: any } | null = isProjectTask
          ? { project: projects.find((item: any) => item.id === task.projectId) || null }
          : findProductContext(projects, task.productId);
        const project = context?.project || null;
        const round =
          task.kind === "rank" && task.groupKey
            ? rounds[task.groupKey] || roundByGroup[task.groupKey] || null
            : null;
        return {
          ...task,
          projectName: project?.name || "已删除项目",
          productName: isProjectTask
            ? project?.name || ""
            : context?.product.trackName || context?.project.name || "未知产品",
          platform: isProjectTask ? null : context?.product.platform || "unknown",
          round: round
            ? {
                done: Array.isArray(round.done) ? round.done.length : 0,
                total: Array.isArray(round.members) ? round.members.length : 0,
                roundStartedAt: round.roundStartedAt || null,
                lastCompletedAt: round.lastCompletedAt || null,
              }
            : null,
        };
      }),
    };
  });

  ipcMain.handle("scheduler:runDue", async () => {
    await schedulerTick();
    return true;
  });
}
