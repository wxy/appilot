/**
 * headless 调度循环执行统计（架构收敛 B：daemon 自维护状态的数据源）：
 * - LeaseScheduler.stats()：processed / succeeded / failed / uniqueTasks /
 *   processedToday / lastRunAt 计数口径；
 * - localDayKey：本地日期键（processedToday 日滚动）；
 * - kick()：立即跑一轮 tick（daemon socket runDue 语义）。
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store';
import {
  createLeaseScheduler,
  localDayKey,
  type ScheduledJob,
  type SchedulerStats,
} from '../src/scheduler';

function main(): void {
  let failures = 0;
  const pass = (name: string) => console.log(`✅ PASS: ${name}`);
  const fail = (name: string, err: unknown) => {
    failures += 1;
    console.error(`❌ FAIL: ${name} — ${err instanceof Error ? err.message : String(err)}`);
  };

  // ── localDayKey 纯函数 ──
  try {
    assert.equal(localDayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05', '本地日键 yyyy-MM-dd');
    assert.equal(localDayKey(new Date(2026, 11, 31)), '2026-12-31', '年末日键');
    pass('localDayKey 本地日期键');
  } catch (err) {
    fail('localDayKey 本地日期键', err);
  }

  const dir = mkdtempSync(join(tmpdir(), 'sched-stats-'));
  const dbPath = join(dir, 'appilot.db');

  (async () => {
    try {
      const store = openStore(dbPath);
      const okJob: ScheduledJob = {
        id: 'job-ok',
        title: 'job-ok',
        intervalMinutes: 1,
        run: async () => 'done',
      };
      const failJob: ScheduledJob = {
        id: 'job-fail',
        title: 'job-fail',
        intervalMinutes: 1,
        run: async () => {
          throw new Error('boom');
        },
      };
      const sched = createLeaseScheduler({
        store,
        leaderId: 'sched',
        jobs: [okJob, failJob],
        heartbeatMs: 60_000,
        ttlMs: 240_000,
        log: () => {},
      });

      // runNow 直接执行（不依赖 leader），两次同一任务 + 一次失败任务。
      await sched.runNow('job-ok');
      await sched.runNow('job-ok');
      await sched.runNow('job-fail');

      const st: SchedulerStats = sched.stats();
      assert.equal(st.processed, 3, 'processed = 执行尝试次数');
      assert.equal(st.succeeded, 2, '成功 2 次');
      assert.equal(st.failed, 1, '失败 1 次');
      assert.equal(st.uniqueTasks, 2, '不同任务数 2');
      assert.equal(st.processedToday, 3, '今日已执行 3');
      assert.ok(st.lastRunAt != null, 'lastRunAt 非空');
      assert.ok(Date.parse(st.startedAt) > 0, 'startedAt 可解析');
      assert.ok(st.startedAt <= st.lastRunAt, 'startedAt 不晚于 lastRunAt');

      // 任务行状态落库（计数与 DB 一致性的旁证）
      assert.equal(store.tasks.get('job-ok')?.lastStatus, 'ok');
      assert.equal(store.tasks.get('job-fail')?.lastStatus, 'error');

      sched.dispose();
      store.close();
      pass('stats(): processed/succeeded/failed/uniqueTasks/processedToday 口径');

      // kick：立即跑一轮 tick（无 job 到期也不抛错）
      const store2 = openStore(join(dir, 'kick.db'));
      const sched2 = createLeaseScheduler({
        store: store2,
        leaderId: 'kick',
        jobs: [],
        heartbeatMs: 100,
        ttlMs: 1000,
        log: () => {},
      });
      sched2.start();
      sched2.kick(); // 不抛错即可
      assert.equal(sched2.isLeader(), true, 'kick 前 start 已成为主');
      sched2.dispose();
      store2.close();
      pass('kick(): 立即跑一轮 tick');
    } catch (err) {
      fail('stats/kick 集成', err);
    }
    if (failures > 0) {
      console.error(`\n${failures} test(s) FAILED`);
      process.exit(1);
    }
    console.log('🎉 All headless scheduler-stats tests passed!');
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

main();
