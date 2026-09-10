/**
 * daemon 侧执行记录（rank_executions）——任务中心时间线的数据源：
 * - 架构收敛后调度只在 daemon，而执行记录曾只有壳内调度写 → 时间线在
 *   2026-09-09 12:59 本地之后全空（用户「看不到失败的执行记录」）。本测试锁定
 *   daemon 调度循环三种结论都落记录：success / failed / retry；
 * - rank 执行器的结构化返回（rank/totalResults）要带进记录（入榜率口径依赖）。
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store';
import type { AppilotStore } from '../src/store';
import { createLeaseScheduler, TRANSIENT_RED_STREAK, type TaskExecutor } from '../src/scheduler';

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

function seedTask(store: AppilotStore, id: string, kind: string, instance: Record<string, unknown>): void {
  store.tasks.upsert({
    id,
    title: `${kind} ${id}`,
    intervalMinutes: 1440,
    lastRunAt: null,
    nextRunAt: new Date(Date.now() - 60_000).toISOString(),
    lastStatus: 'never',
    lastSummary: null,
    runCount: 0,
    source: 'electron',
    kind,
    instance,
  });
}

function execs(store: AppilotStore): any[] {
  return store.executions.latest(500) as any[];
}

async function main(): Promise<void> {
  await runCase('成功后落 success 执行记录（含 rank 结构化字段与耗时）', async () => {
    const store = openStore(join(mkdtempSync(join(tmpdir(), 'exec-rec-')), 'appilot.db'));
    const rankExecutor: TaskExecutor = {
      title: '排名采集',
      intervalMinutes: 1440,
      hitsItunesSearch: true,
      run: async () => ({
        summary: 'GloWalk(ios): glo walk @ cn → 第 1 名（共 10 结果）',
        execution: { kind: 'rank', keyword: 'glo walk', language: 'en', storefront: 'cn', rank: 1, totalResults: 10 },
      }),
    };
    const sched = createLeaseScheduler({
      store, leaderId: 'exec-rec', jobs: [], executors: { rank: rankExecutor }, heartbeatMs: 100_000,
    });
    seedTask(store, 'rank:a', 'rank', { productId: 'p:ios', keyword: 'glo walk', queryLanguage: 'en', storefront: 'cn' });

    await sched.runNow('rank:a');
    const rows = execs(store);
    assert.equal(rows.length, 1, `应落 1 条执行记录，实际 ${rows.length}`);
    const [e] = rows;
    assert.equal(e.status, 'success', 'status=success');
    assert.equal(e.taskId, 'rank:a', 'taskId 回填');
    assert.equal(e.kind, 'rank', 'kind 回填（入榜率判定用）');
    assert.equal(e.rank, 1, 'rank 结构化字段带出');
    assert.equal(e.totalResults, 10, 'totalResults 带出');
    assert.equal(e.keyword, 'glo walk', 'keyword 回填');
    assert.equal(e.storefront, 'cn', 'storefront 回填');
    assert.ok(typeof e.durationMs === 'number' && e.durationMs >= 0, '耗时已记录');
    assert.ok(typeof e.ts === 'string' && Date.parse(e.ts) > 0, 'ts 可解析（时间线按 ts 分桶）');
    sched.dispose();
    store.close();
  });

  await runCase('业务错误落 failed；瞬时抖动落 retry，连续 3 次才 failed', async () => {
    const store = openStore(join(mkdtempSync(join(tmpdir(), 'exec-rec2-')), 'appilot.db'));
    const script = ['This operation was aborted', 'This operation was aborted', 'This operation was aborted', 'rank 实例缺少 trackId'];
    let i = 0;
    const executor: TaskExecutor = {
      title: '网络任务',
      intervalMinutes: 1440,
      run: async () => {
        const msg = script[Math.min(i, script.length - 1)];
        i += 1;
        throw new Error(msg);
      },
    };
    const sched = createLeaseScheduler({
      store, leaderId: 'exec-rec2', jobs: [], executors: { net: executor }, heartbeatMs: 100_000,
    });
    seedTask(store, 'net:a', 'net', { keyword: 'k', storefront: 'us' });

    // 前两次抖动 → retry（任务行不标红，时间线留痕为「重试」）
    // 记录表 (ts, taskId) 唯一（INSERT OR IGNORE，kv→DB 导入幂等用）——真实重试
    // 间隔 5min 不会撞，这里拉 5ms 保证两次尝试落到不同 ts。
    const gap = () => new Promise((r) => setTimeout(r, 5));
    await sched.runNow('net:a');
    await gap();
    await sched.runNow('net:a');
    let rows = execs(store);
    assert.deepEqual(rows.map((r) => r.status), ['retry', 'retry'], `抖动应记 retry：${rows.map((r) => r.status)}`);
    assert.ok(rows[0].reason === 'transient', 'reason=transient');
    assert.equal(rows[1].streak, 2, '连续次数带出');

    // 第三次 → 任务行标红，记录同步 failed
    await gap();
    await sched.runNow('net:a');
    rows = execs(store);
    assert.equal(rows[2].status, 'failed', `第 ${TRANSIENT_RED_STREAK} 次应记 failed`);

    // 业务错误 → failed
    await gap();
    await sched.runNow('net:a');
    rows = execs(store);
    assert.equal(rows[3].status, 'failed', '业务错误记 failed');
    assert.equal(rows[3].reason, 'error', '业务错误 reason=error');
    assert.equal(store.tasks.get('net:a')?.lastStatus, 'error', '任务行同样标红（口径一致）');
    sched.dispose();
    store.close();
  });

  await runCase('熔断跳过（派发前）不落记录；执行中命中 403 落 retry', async () => {
    const store = openStore(join(mkdtempSync(join(tmpdir(), 'exec-rec3-')), 'appilot.db'));
    const { armItunesSearchBlockStore } = await import('../src/itunes-breaker');
    let calls = 0;
    const executor: TaskExecutor = {
      title: '排名采集',
      intervalMinutes: 1440,
      hitsItunesSearch: true,
      run: async () => {
        calls += 1;
        throw Object.assign(new Error('iTunes Search API 403'), { status: 403 });
      },
    };
    const sched = createLeaseScheduler({
      store, leaderId: 'exec-rec3', jobs: [], executors: { rank: executor }, heartbeatMs: 100_000,
    });
    seedTask(store, 'rank:blocked', 'rank', { keyword: 'k', storefront: 'us' });
    armItunesSearchBlockStore(store);

    await sched.runNow('rank:blocked');
    assert.equal(calls, 0, '熔断期内不派发');
    assert.equal(execs(store).length, 0, '跳过不算一次执行（不落记录）');

    // 解除熔断 → 执行命中 403 → 熔断重排 + 记录为 retry（非 failure）
    store.kv.set('itunesSearchBlockedUntil', JSON.stringify(new Date(Date.now() - 1000).toISOString()));
    await sched.runNow('rank:blocked');
    assert.equal(calls, 1, '解除后执行一次');
    const rows = execs(store);
    assert.equal(rows.length, 1, '403 尝试落 1 条记录');
    assert.equal(rows[0].status, 'retry', '403 记 retry（上游封禁，非任务失败）');
    assert.equal(rows[0].reason, 'itunes-403', 'reason=itunes-403');
    sched.dispose();
    store.close();
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) FAILED`);
    process.exit(1);
  }
  console.log('\n🎉 All headless execution-record tests passed!');
}

void main();
