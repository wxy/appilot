import type { TaskRow } from './schema.js';

const MINUTE = 60_000;
export const BALANCE_INTERVAL_MS = 15 * MINUTE;

/** Forward-only correction of excessive future density. Never changes the cycle anchor. */
export function planScheduleBalance(tasks: TaskRow[], now: number) {
  const width = 15 * MINUTE;
  const horizon = now + 24 * 60 * MINUTE;
  const future = tasks.filter(t => t.enabled !== false && Number.isFinite(Date.parse(t.nextRunAt ?? '')) && Date.parse(t.nextRunAt!) > now);
  const cap = Math.max(1, Math.ceil(future.filter(t => Date.parse(t.nextRunAt!) <= horizon).length / 96 * 1.5));
  const loads = new Map<number, number>();
  for (const t of future) {
    const slot = Math.floor(Date.parse(t.nextRunAt!) / width);
    loads.set(slot, (loads.get(slot) ?? 0) + 1);
  }
  const peakBefore = Math.max(0, ...loads.values());
  const changes: { task: TaskRow; target: string }[] = [];
  for (const task of [...future].sort((a, b) => Date.parse(a.nextRunAt!) - Date.parse(b.nextRunAt!) || a.id.localeCompare(b.id))) {
    const due = Date.parse(task.nextRunAt!);
    const slot = Math.floor(due / width);
    const schedule = task.schedule;
    if ((loads.get(slot) ?? 0) <= cap || task.kind !== 'rank' || task.lastStatus === 'error' ||
        schedule?.origin !== 'automatic' || schedule.balancedAt !== null || schedule.originalDueAt !== task.nextRunAt ||
        due <= now + 30 * MINUTE || due > horizon || !(task.intervalMinutes > 0)) continue;
    const interval = task.intervalMinutes * MINUTE;
    const last = task.lastRunAt === null ? null : Date.parse(task.lastRunAt);
    if (last !== null && !Number.isFinite(last)) continue;
    const earliest = Math.max(now + 30 * MINUTE, due - Math.min(4 * 60 * MINUTE, interval * .2), last === null ? 0 : last + interval * .8);
    let best: { slot: number; target: number; load: number } | null = null;
    for (let candidate = Math.floor(earliest / width); candidate < slot; candidate++) {
      const target = candidate * width + due % width;
      const load = loads.get(candidate) ?? 0;
      if (target < earliest || load >= cap) continue;
      // Prefer the lowest load; ties take the closest earlier slot.
      if (!best || load <= best.load) best = { slot: candidate, target, load };
    }
    if (!best) continue;
    loads.set(slot, loads.get(slot)! - 1);
    loads.set(best.slot, best.load + 1);
    changes.push({ task, target: new Date(best.target).toISOString() });
  }
  return { changes, cap, peakBefore, peakAfter: Math.max(0, ...loads.values()) };
}

/** Only an advanced cycle uses its original anchor. Ordinary/overdue jobs retain existing cadence. */
export function nextAutomaticDue(task: TaskRow, now: number, manual = false): string {
  const interval = task.intervalMinutes * MINUTE;
  const anchor = !manual && task.schedule?.balancedAt ? Date.parse(task.schedule.originalDueAt) : now;
  let due = (Number.isFinite(anchor) ? anchor : now) + interval;
  if (due <= now && interval > 0) due += (Math.floor((now - due) / interval) + 1) * interval;
  return new Date(due).toISOString();
}
