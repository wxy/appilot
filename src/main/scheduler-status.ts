/**
 * Pure scheduler-status logic (no Electron dependency) so it is unit-testable.
 * The keyword page's "自动任务" line reflects the keyword-collection pool, so
 * due/nextDueAt only consider `rank` tasks — project-level GitHub sync tasks
 * must not make keyword collection look stuck.
 */

export interface ScheduledTaskLike {
  kind: string;
  enabled: boolean;
  nextRunAt: string;
  lastStatus?: string;
}

export function computeRankSchedulerStatus(
  tasks: ScheduledTaskLike[],
  now: number,
): {
  total: number;
  due: number;
  failed: number;
  nextDueAt: string | null;
} {
  const rankTasks = tasks.filter((task) => task.kind === "rank");
  const enabled = rankTasks.filter((task) => task.enabled);
  const nextTask = [...enabled]
    .sort(
      (a, b) =>
        new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime(),
    )[0];
  return {
    total: tasks.length,
    due: enabled.filter(
      (task) => new Date(task.nextRunAt).getTime() <= now,
    ).length,
    failed: tasks.filter((task) => task.lastStatus === "failed").length,
    nextDueAt: nextTask?.nextRunAt || null,
  };
}
