export const ELECTRON_ONLY_TASK_KINDS = new Set([
  'ops-sync',
  'reviews-sync',
  'build-status',
]);

export interface ElectronOnlyTaskCandidate {
  kind?: unknown;
  enabled?: unknown;
  nextRunAt?: unknown;
}

/** 只选择 daemon 因 safeStorage/富对象边界不能执行、且确实到期的任务。 */
export function shouldRunElectronOnlyTask(
  task: ElectronOnlyTaskCandidate,
  nowMs = Date.now(),
  taskCenterStopped = false,
): boolean {
  if (taskCenterStopped || task?.enabled === false) return false;
  if (typeof task?.kind !== 'string' || !ELECTRON_ONLY_TASK_KINDS.has(task.kind)) return false;
  if (typeof task.nextRunAt !== 'string') return false;
  const dueAt = Date.parse(task.nextRunAt);
  return Number.isFinite(dueAt) && dueAt <= nowMs;
}
