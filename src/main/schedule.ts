/**
 * Pure scheduling math for the task scheduler (no Electron dependencies) so it
 * is unit-testable.
 *
 * A task's phase comes from a stable hash of its seed, which spreads many
 * tasks evenly across the period instead of firing them all at once.
 */

export function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Next run for a periodic task. The task keeps a stable phase inside the
 * interval (anchored to the start of the day), so it runs exactly once per
 * `intervalMinutes` — e.g. once per day at a fixed minute-of-day for the
 * default 24h rank interval, once per hour for the 60min GitHub sync.
 *
 * This is intentionally NOT `now + hash % interval`: the old formula made the
 * effective period equal to `hash % interval + 1` minutes, so tasks with a
 * small hash ran every few minutes while others waited almost 24h.
 */
export function nextRunAt(
  seed: string,
  intervalMinutes: number,
  now = new Date(),
): string {
  const slotMinutes = hashString(seed) % intervalMinutes;
  const candidate = new Date(now);
  candidate.setHours(0, 0, 0, 0);
  candidate.setMinutes(candidate.getMinutes() + slotMinutes);
  while (candidate.getTime() <= now.getTime()) {
    candidate.setTime(candidate.getTime() + intervalMinutes * 60_000);
  }
  return candidate.toISOString();
}

/**
 * Next run for a rank task, given a runs-per-day setting (default 1).
 *
 * Phases are derived from the seed and repeat every `1440 / runsPerDay`
 * minutes anchored to midnight. With `runsPerDay: 1` this means exactly one
 * run per calendar day at a stable minute-of-day — never twice on the same
 * day, even when the task was scattered early by an overdue catch-up or a
 * failure retry. Raising the setting later (e.g. 2) yields evenly spaced
 * phases per day without further changes.
 */
export function nextRankRunAt(
  seed: string,
  runsPerDay = 1,
  after = new Date(),
): string {
  const runs = Math.max(1, Math.min(48, Math.floor(runsPerDay || 1)));
  const intervalMinutes = Math.floor((24 * 60) / runs);
  const slot = hashString(seed) % intervalMinutes;
  const candidate = new Date(after);
  candidate.setHours(0, 0, 0, 0);
  candidate.setMinutes(candidate.getMinutes() + slot);
  while (candidate.getTime() <= after.getTime()) {
    candidate.setTime(candidate.getTime() + intervalMinutes * 60_000);
  }
  if (runs === 1) {
    // Strict once-per-day: if the phase still lands on the same calendar day
    // as `after` (the previous run), move it to tomorrow's phase instead.
    const afterDayStart = new Date(after);
    afterDayStart.setHours(0, 0, 0, 0);
    if (candidate.getTime() < afterDayStart.getTime() + 24 * 60 * 60_000) {
      candidate.setTime(afterDayStart.getTime() + 24 * 60 * 60_000 + slot * 60_000);
    }
  }
  return candidate.toISOString();
}

/**
 * Scatter a batch of tasks (e.g. an overdue backlog on startup, or a failure
 * retry) across the next `windowMinutes` from now, so they do not all fire in
 * the same tick.
 */
export function nextRunWithinMinutes(
  seed: string,
  windowMinutes: number,
  now = new Date(),
): string {
  const slotMinutes = hashString(seed) % windowMinutes;
  const candidate = new Date(now);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + slotMinutes + 1);
  return candidate.toISOString();
}

/**
 * 修复“排期坍缩”：当大量启用任务的下次执行时间落在同一分钟（通常是一次
 * 性重排/迁移把整批任务设成 now + 间隔 导致），按各自稳定的相位槽重新
 * 散布到未来，避免某一分钟同时爆发成积压。
 *
 * 仅在非加速状态下调用：加速期间当轮拉取的任务会共享同一分钟，不能误伤。
 * 阈值 100 远高于正常调度产生的同分钟任务量（积压散布 120 分钟窗口下约
 * 每槽 10 个、失败重试 30 分钟窗口下约每槽 45 个），能精准命中坍缩批次。
 */
export function rebalanceCollapsedTasks<
  T extends {
    id: string;
    kind?: string;
    enabled?: boolean;
    nextRunAt?: string | null;
    intervalMinutes?: number;
  },
>(
  tasks: T[],
  now = new Date(),
  runsPerDay = 1,
  minCluster = 100,
): { tasks: T[]; changed: boolean } {
  const nowMs = now.getTime();
  const minuteKey = (ts: string | null | undefined): number | null => {
    if (!ts) return null;
    const ms = Date.parse(ts);
    if (Number.isNaN(ms)) return null;
    return Math.floor(ms / 60_000);
  };
  const byMinute = new Map<number, T[]>();
  for (const task of tasks) {
    if (!task.enabled || !task.nextRunAt) continue;
    const ts = Date.parse(task.nextRunAt);
    if (Number.isNaN(ts) || ts <= nowMs) continue;
    const key = minuteKey(task.nextRunAt)!;
    const list = byMinute.get(key) || [];
    list.push(task);
    byMinute.set(key, list);
  }
  const collapsedKeys = new Set(
    [...byMinute.values()]
      .filter((list) => list.length >= minCluster)
      .map((list) => minuteKey(list[0].nextRunAt)),
  );
  if (collapsedKeys.size === 0) return { tasks, changed: false };
  const next = tasks.map((task) => {
    const key = minuteKey(task.nextRunAt);
    if (key == null || !collapsedKeys.has(key)) return task;
    // 命中坍缩批次：按任务自身的稳定相位重新排到未来。
    const interval =
      task.intervalMinutes && task.intervalMinutes > 0
        ? task.intervalMinutes
        : 24 * 60;
    const nextRun =
      task.kind === "rank"
        ? nextRankRunAt(task.id, runsPerDay, now)
        : nextRunAt(task.id, interval, now);
    return { ...task, nextRunAt: nextRun };
  });
  return { tasks: next, changed: true };
}

/** Stable group key for the rank tasks of one product × platform × language × storefront. */
export function rankGroupKey(
  productId: string,
  platform: string | null | undefined,
  queryLanguage: string,
  storefront: string,
): string {
  return `rank:${productId}:${platform || "unknown"}:${queryLanguage}:${storefront}`;
}

/**
 * Reorder due tasks so the members of one rank group (product × platform ×
 * language × storefront) run back-to-back, letting a whole keyword group
 * finish as early as possible. Order stays by due time (oldest first) both
 * within a group and across groups.
 */
export function prioritizeGroupCompletion<
  T extends { kind?: string; groupKey?: string },
>(tasks: T[]): T[] {
  const ordered: T[] = [];
  const remaining = [...tasks];
  while (remaining.length > 0) {
    const first = remaining.shift()!;
    ordered.push(first);
    if (first.kind === "rank" && first.groupKey) {
      const group: T[] = [];
      const rest: T[] = [];
      for (const task of remaining) {
        if (task.kind === "rank" && task.groupKey === first.groupKey) group.push(task);
        else rest.push(task);
      }
      ordered.push(...group);
      remaining.length = 0;
      remaining.push(...rest);
    }
  }
  return ordered;
}

/**
 * Per-group round state. A "round" is one full sweep of every keyword task in
 * the group; `done` holds the task ids that have completed the current round
 * successfully. When every member is done, the round is considered complete.
 */
export interface SchedulerRoundState {
  members: string[];
  done: string[];
  roundStartedAt: string | null;
  lastCompletedAt: string | null;
}

export function emptySchedulerRoundState(): SchedulerRoundState {
  return {
    members: [],
    done: [],
    roundStartedAt: null,
    lastCompletedAt: null,
  };
}

/**
 * Bootstrap the first round after an upgrade: keywords that already have a
 * lastRunAt count as done, so the task center shows real progress immediately
 * instead of waiting for a fresh round to fill up.
 */
export function bootstrapRoundState<
  T extends { id: string; lastRunAt?: string | null },
>(tasks: T[]): SchedulerRoundState {
  return {
    members: tasks.map((task) => task.id).sort(),
    done: tasks.filter((task) => task.lastRunAt).map((task) => task.id),
    roundStartedAt: null,
    lastCompletedAt: null,
  };
}

/** Sync a group's round state with its current task membership. */
export function pruneRoundMembers(
  state: SchedulerRoundState | undefined,
  members: string[],
  now = new Date().toISOString(),
): SchedulerRoundState {
  const previous = state || emptySchedulerRoundState();
  const sortedMembers = [...members].sort();
  const sameMembers =
    previous.members.length === sortedMembers.length &&
    previous.members.every((id, index) => id === sortedMembers[index]);
  return {
    members: sortedMembers,
    done: sameMembers ? previous.done.filter((id) => sortedMembers.includes(id)) : [],
    roundStartedAt: sameMembers ? previous.roundStartedAt : now,
    lastCompletedAt: previous.lastCompletedAt,
  };
}

/**
 * Mark one task as completed for the current round. When every member has
 * completed, the round finishes: `lastCompletedAt` is set, a fresh round
 * starts, and `done` is reset. Returns `completed: true` for that transition.
 */
export function markRoundTaskDone(
  state: SchedulerRoundState | undefined,
  taskId: string,
  completedAt = new Date().toISOString(),
): { state: SchedulerRoundState; completed: boolean } {
  const base = state || emptySchedulerRoundState();
  const done = base.done.includes(taskId) ? base.done : [...base.done, taskId];
  const completed =
    base.members.length > 0 && base.members.every((id) => done.includes(id));
  if (completed) {
    return {
      state: {
        ...base,
        done: [],
        roundStartedAt: completedAt,
        lastCompletedAt: completedAt,
      },
      completed: true,
    };
  }
  return { state: { ...base, done }, completed: false };
}

/** In-flight App Store statuses that keep the build-status poll alive. */
export const IN_FLIGHT_STORE_STATUSES = ["prepared", "copied", "submitted", "in_review"] as const;

export function opsSyncTaskId(projectId: string): string {
  return `ops-sync:${projectId}`;
}

export function reviewsSyncTaskId(productId: string): string {
  return `reviews-sync:${productId}`;
}

export function buildStatusTaskId(productId: string): string {
  return `build-status:${productId}`;
}

/**
 * Re-seed a periodic task from the previous persisted entry: new kinds keep
 * their run history across app restarts, while a first-run task gets a stable
 * phase inside its interval (anchored to midnight, see nextRunAt).
 */
export function seedScheduledTask(
  existing: any[],
  base: { id: string; intervalMinutes: number } & Record<string, any>,
): any {
  const previous = existing.find((task) => task.id === base.id) as any;
  return {
    ...base,
    nextRunAt: previous?.nextRunAt || nextRunAt(base.id, base.intervalMinutes),
    lastRunAt: previous?.lastRunAt ?? null,
    firstRunAt: previous?.firstRunAt ?? null,
    executionCount: previous?.executionCount || 0,
    lastStatus: previous?.lastStatus,
    enabled: previous?.enabled ?? true,
    consecutiveFailures: previous?.consecutiveFailures || 0,
    lastDurationMs: previous?.lastDurationMs,
  };
}
