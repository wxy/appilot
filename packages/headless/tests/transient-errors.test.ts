/**
 * 瞬时上游/网络抖动 与 限流 的失败语义（headless 调度循环）：
 * - isTransientUpstreamError：超时 abort / terminated / fetch failed 等判定；
 * - 单次瞬时抖动**不标红**：保留原状态，仅短退避重试 + 写说明性 lastSummary；
 * - 连续 ≥ TRANSIENT_RED_STREAK 次才落 error（真实故障可见）；
 * - 限流（429 等）同口径；业务错误（参数缺失等）仍立即标红。
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store';
import type { AppilotStore } from '../src/store';
import {
  createLeaseScheduler,
  isTransientUpstreamError,
  TRANSIENT_RED_STREAK,
  type TaskExecutor,
} from '../src/scheduler';

let failures = 0;
const pass = (name: string) => console.log(`✅ PASS: ${name}`);
const fail = (name: string, err: unknown) => {
  failures += 1;
  console.error(`❌ FAIL: ${name} — ${err instanceof Error ? err.message : String(err)}`);
};
const runCase = async (name: string, fn: () => Promise<void> | void): Promise<void> => {
  try {
    await fn();
    pass(name);
  } catch (err) {
    fail(name, err);
  }
};

function seedTask(store: AppilotStore, id: string, kind: string, intervalMinutes = 1440): void {
  store.tasks.upsert({
    id,
    title: `${kind} ${id}`,
    intervalMinutes,
    lastRunAt: null,
    nextRunAt: new Date(Date.now() - 60_000).toISOString(),
    lastStatus: 'never',
    lastSummary: null,
    runCount: 0,
    source: 'test',
    kind,
    instance: { seed: id },
  });
}

/** 可切换行为的执行器：按脚本依次抛出/成功。 */
function scriptedExecutor(script: (string | null)[]): TaskExecutor & { calls: number } {
  const exec = {
    title: '网络任务',
    intervalMinutes: 1440,
    calls: 0,
    run: async () => {
      const idx = exec.calls;
      exec.calls += 1;
      const outcome = script[Math.min(idx, script.length - 1)];
      if (outcome === null) return 'ok-摘要';
      throw new Error(outcome);
    },
  };
  return exec;
}

function minutesFromNow(iso: string | null): number {
  return Math.round((new Date(iso as string).getTime() - Date.now()) / 60_000);
}

async function main(): Promise<void> {
  await runCase('isTransientUpstreamError：抖动判定与业务错误区分', () => {
    for (const msg of [
      'This operation was aborted',
      'terminated',
      'socket hang up',
      'fetch failed',
      'connect ECONNRESET',
      'read ETIMEDOUT',
    ]) {
      assert.equal(isTransientUpstreamError(msg), true, `应判为瞬时：${msg}`);
    }
    for (const msg of [
      'rank 实例参数不完整（keyword/storefront/productId）',
      'rank 实例缺少 trackId',
      'iTunes Search API 403',
      'iTunes Search API 429',
    ]) {
      assert.equal(isTransientUpstreamError(msg), false, `不应判为瞬时：${msg}`);
    }
  });

  await runCase('瞬时抖动：单次不标红 + 短退避；连续 3 次才 error；成功即清零', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'transient-'));
    const store = openStore(join(dir, 'appilot.db'));
    const exec = scriptedExecutor([
      'This operation was aborted',
      'This operation was aborted',
      'This operation was aborted',
      null,
    ]);
    const sched = createLeaseScheduler({
      store,
      leaderId: 'transient-test',
      jobs: [],
      executors: { net: exec },
      heartbeatMs: 100_000,
    });
    seedTask(store, 'net:a', 'net');

    const r1 = await sched.runNow('net:a');
    assert.equal(r1?.lastStatus, 'never', '第 1 次抖动不标红（保留原状态）');
    assert.ok(String(r1?.lastSummary).startsWith('TRANSIENT:1'), `第 1 次写 TRANSIENT:1，实际 ${r1?.lastSummary}`);
    const b1 = minutesFromNow(r1?.nextRunAt ?? null);
    assert.ok(b1 <= 10, `短退避而非整个 interval(1440min)，实际 ${b1}min`);
    assert.equal(r1?.lastRunAt, null, '抖动重试不覆盖 lastRunAt');

    const r2 = await sched.runNow('net:a');
    assert.equal(r2?.lastStatus, 'never', '第 2 次抖动仍不标红');
    assert.ok(String(r2?.lastSummary).startsWith('TRANSIENT:2'), `实际 ${r2?.lastSummary}`);

    const r3 = await sched.runNow('net:a');
    assert.equal(r3?.lastStatus, 'error', `连续 ${TRANSIENT_RED_STREAK} 次才标红`);
    assert.ok(String(r3?.lastSummary).startsWith('TRANSIENT:3'), `实际 ${r3?.lastSummary}`);
    assert.ok(r3?.lastRunAt, '标红时记录 lastRunAt');

    const r4 = await sched.runNow('net:a');
    assert.equal(r4?.lastStatus, 'ok', '恢复成功后回 ok');
    assert.equal(r4?.lastSummary, 'ok-摘要', '成功摘要覆盖 streak（自然清零）');
    sched.dispose();
    store.close();
  });

  await runCase('限流（429）：同口径不立即标红，连续 3 次才 error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ratelimit-'));
    const store = openStore(join(dir, 'appilot.db'));
    const exec = scriptedExecutor([
      'iTunes Search API 429',
      'iTunes Search API 429',
      'iTunes Search API 429',
    ]);
    const sched = createLeaseScheduler({
      store,
      leaderId: 'ratelimit-test',
      jobs: [],
      executors: { net: exec },
      heartbeatMs: 100_000,
    });
    seedTask(store, 'net:rl', 'net');

    const r1 = await sched.runNow('net:rl');
    assert.equal(r1?.lastStatus, 'never', '单次 429 不标红');
    assert.ok(String(r1?.lastSummary).startsWith('RATELIMIT:1'), `实际 ${r1?.lastSummary}`);
    await sched.runNow('net:rl');
    const r3 = await sched.runNow('net:rl');
    assert.equal(r3?.lastStatus, 'error', '连续 3 次限流标红');
    assert.ok(String(r3?.lastSummary).startsWith('RATELIMIT:3'), `实际 ${r3?.lastSummary}`);
    sched.dispose();
    store.close();
  });

  await runCase('业务错误：立即标红（原样摘要，不加退化重试）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'business-err-'));
    const store = openStore(join(dir, 'appilot.db'));
    const exec = scriptedExecutor(['rank 实例缺少 trackId（product_records 无 x）']);
    const sched = createLeaseScheduler({
      store,
      leaderId: 'business-test',
      jobs: [],
      executors: { net: exec },
      heartbeatMs: 100_000,
    });
    seedTask(store, 'net:biz', 'net');

    const r1 = await sched.runNow('net:biz');
    assert.equal(r1?.lastStatus, 'error', '业务错误立即标红');
    assert.equal(r1?.lastSummary, 'rank 实例缺少 trackId（product_records 无 x）', '摘要原样');
    assert.equal(minutesFromNow(r1?.nextRunAt ?? null), 1440, '业务错误按原周期排期');
    sched.dispose();
    store.close();
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) FAILED`);
    process.exit(1);
  }
  console.log('\n🎉 All headless transient-error tests passed!');
}

void main();
