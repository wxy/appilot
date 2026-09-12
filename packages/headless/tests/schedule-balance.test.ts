import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../src/store';
import { planScheduleBalance, nextAutomaticDue } from '../src/schedule-balance';
import { createLeaseScheduler } from '../src/scheduler';
import type { TaskRow } from '../src/schema';
const now = Date.parse('2026-09-12T12:00:00Z');
const hour = 3600000;
const iso = (n: number) => new Date(n).toISOString();
function task(id: string): TaskRow {
  return { id, title: id, kind: 'rank', intervalMinutes: 1440, lastRunAt: iso(now-16*hour), nextRunAt: iso(now+8*hour), lastStatus: 'ok', lastSummary: null, runCount: 1, enabled: true,
    schedule: { origin: 'automatic', originalDueAt: iso(now+8*hour), balancedAt: null } };
}
async function main() {
  const pool = Array.from({ length: 300 }, (_, i) => task(String(i)));
  const plan = planScheduleBalance(pool, now);
  assert(plan.changes.length > 0);
  for (const c of plan.changes) {
    assert(Date.parse(c.target) < Date.parse(c.task.nextRunAt!));
    assert(Date.parse(c.target) >= now+4*hour);
    assert(Date.parse(c.target) >= Date.parse(c.task.lastRunAt!)+.8*24*hour);
  }
  const map = new Map(plan.changes.map(c => [c.task.id, c.target]));
  const balanced = pool.map(t => map.has(t.id) ? { ...t, nextRunAt: map.get(t.id)!, schedule: { ...t.schedule!, balancedAt: iso(now) } } : t);
  assert.equal(planScheduleBalance(balanced, now).changes.length, 0);
  const previouslyMoved = new Set(map.keys());
  assert(planScheduleBalance(balanced, now+hour).changes.every(c => !previouslyMoved.has(c.task.id)));
  for (const protectedTask of [
    { ...task('unknown'), schedule: null },
    { ...task('manual'), schedule: { ...task('x').schedule!, origin: 'manual' as const } },
    { ...task('retry'), schedule: { ...task('x').schedule!, origin: 'retry' as const } },
    { ...task('disabled'), enabled: false },
    { ...task('failed'), lastStatus: 'error' as const },
    { ...task('other'), kind: 'github-sync' },
    { ...task('soon'), nextRunAt: iso(now+60000) },
    { ...task('changed'), nextRunAt: iso(now+7*hour) },
  ]) assert(!planScheduleBalance([...pool, protectedTask], now).changes.some(c => c.task.id === protectedTask.id));
  const moved = balanced.find(t => t.schedule?.balancedAt)!;
  assert.equal(nextAutomaticDue(moved, Date.parse(moved.nextRunAt!)), iso(now+32*hour));

  const dir = mkdtempSync(join(tmpdir(), 'balance-'));
  const path = join(dir, 'test.db');
  let store = openStore(path);
  try {
    const t = task('persist');
    store.tasks.upsert(t, { schedule: t.schedule });
    const target = iso(now+6*hour);
    assert(store.tasks.advance(store.tasks.get(t.id)!, target, iso(now)));
    assert(!store.tasks.advance(t, target, iso(now)), 'stale/repeated plan rejected');
    store.close(); store = openStore(path);
    assert.equal(store.tasks.get(t.id)?.schedule?.balancedAt, iso(now));
    const snapshot = store.tasks.get(t.id)!;
    store.tasks.upsert({ ...snapshot, nextRunAt: iso(now+5*hour) });
    assert.equal(store.tasks.get(t.id)?.schedule, null, 'generic manual edit invalidates provenance');
    assert(!store.tasks.advance(snapshot, iso(now+4*hour), iso(now)), 'manual edit wins CAS');

    const auto = task('execute');
    auto.nextRunAt = iso(now-1);
    auto.schedule = { origin: 'automatic', originalDueAt: iso(now+hour), balancedAt: iso(now-hour) };
    store.tasks.upsert(auto, { schedule: auto.schedule });
    const sched = createLeaseScheduler({ store, leaderId: 'test', jobs: [], now: () => now, executors: { rank: { title: 'rank', intervalMinutes: 1440, run: async () => 'ok' } } });
    sched.start();
    await new Promise(r => setTimeout(r, 30));
    sched.dispose();
    assert.equal(store.tasks.get(auto.id)?.nextRunAt, iso(now+25*hour));
    assert.equal(store.tasks.get(auto.id)?.schedule?.origin, 'automatic');
    assert.equal(store.tasks.get(auto.id)?.schedule?.balancedAt, null);
    await sched.runNow(auto.id);
    assert.equal(store.tasks.get(auto.id)?.schedule?.origin, 'manual');
    store.close();
    const db = new DatabaseSync(path);
    db.exec('ALTER TABLE tasks DROP COLUMN scheduleJson');
    db.exec("UPDATE meta SET value='14' WHERE key='schemaVersion'");
    db.close();
    store = openStore(path);
    assert.equal(store.tasks.get(auto.id)?.schedule, null, 'v14 migration protects unknown schedules');
    console.log('balance: forward bounds, idempotency, protection, persistence, CAS, automatic/manual execution and v14 migration passed');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
}
void main().catch(e => { console.error(e); process.exitCode = 1; });
