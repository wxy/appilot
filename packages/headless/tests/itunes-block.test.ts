/**
 * iTunes Search 403 熔断（headless 侧）最小单测：
 * - itunes-breaker 纯逻辑：读/写共享 store.kv 的同键判定、45 分钟窗口、幂等；
 * - scheduler 门控：熔断期内 hitsItunesSearch 执行器（rank）自动/显式跳过，
 *   非 iTunes 执行器照常；执行中命中 403 → 写熔断键并停止后续派发。
 * 不 mock 网络：只测判定与写键逻辑位（store 用临时 SQLite 文件）。
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store';
import type { AppilotStore } from '../src/store';
import {
  armItunesSearchBlockStore,
  isItunesSearchBlockedStore,
  itunesSearchBlockedUntilStore,
} from '../src/itunes-breaker';
import { createLeaseScheduler, type TaskExecutor } from '../src/scheduler';

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function seedTask(store: AppilotStore, id: string, kind: string): void {
  store.tasks.upsert({
    id,
    title: `${kind} ${id}`,
    intervalMinutes: 60,
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

function forbiddenError(): Error & { status: number } {
  return Object.assign(new Error('iTunes Search API 403'), { status: 403 });
}

async function main() {
  // ── itunes-breaker：读写同一 app_kv 键（含 electron JSON 引号存法兼容） ──
  await runCase('itunes-breaker: 同键读写/45 分钟窗口/幂等/引号兼容', () => {
    const dir = mkdtempSync(join(tmpdir(), 'headless-block-'));
    const store = openStore(join(dir, 'appilot.db'));

    assert.equal(isItunesSearchBlockedStore(store), false, '空 kv → 未熔断');
    assert.equal(itunesSearchBlockedUntilStore(store), null, '空 kv → until null');

    const newly = armItunesSearchBlockStore(store);
    assert.equal(newly, true, '首次触发返回新触发');
    const untilIso = itunesSearchBlockedUntilStore(store);
    assert.ok(untilIso, '触发后键已写入');
    const untilMs = new Date(untilIso as string).getTime();
    assert.ok(
      untilMs > Date.now() + 44 * 60_000 && untilMs <= Date.now() + 45 * 60_000,
      '冷却窗口 = 45 分钟',
    );
    assert.equal(isItunesSearchBlockedStore(store), true, '写入后处于熔断');
    assert.equal(armItunesSearchBlockStore(store), false, '重复触发幂等（不顺延窗口）');

    // electron 主进程写入格式为 JSON.stringify(ISO)（带引号）——headless 读应兼容。
    store.kv.set(
      'itunesSearchBlockedUntil',
      JSON.stringify(new Date(Date.now() + 10 * 60_000).toISOString()),
    );
    assert.ok(
      isItunesSearchBlockedStore(store),
      '兼容 electron JSON 引号存法（主进程写入 → daemon 读出熔断）',
    );

    // 过期值 → 解除。
    store.kv.set(
      'itunesSearchBlockedUntil',
      JSON.stringify(new Date(Date.now() - 1000).toISOString()),
    );
    assert.equal(isItunesSearchBlockedStore(store), false, '过期值 → 熔断解除（到期自然恢复）');
    assert.equal(armItunesSearchBlockStore(store), true, '解除后可再次触发');
    store.close();
  });

  // ── scheduler 门控 A：熔断期内 rank 自动/显式跳过、github-sync 照常 ──
  await runCase('scheduler: rank 熔断门控（自动/显式跳过，github-sync 不受影响）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'headless-block-sched-'));
    const store = openStore(join(dir, 'appilot.db'));
    let rankCalls = 0;
    let githubCalls = 0;

    const executors: Record<string, TaskExecutor> = {
      rank: {
        title: '排名采集',
        intervalMinutes: 720,
        hitsItunesSearch: true,
        run: async () => {
          rankCalls += 1;
          return 'rank-ran';
        },
      },
      'github-sync': {
        title: 'GitHub 发布同步',
        intervalMinutes: 60,
        run: async () => {
          githubCalls += 1;
          return 'gh-ran';
        },
      },
    };

    seedTask(store, 'rank:blocked', 'rank');
    seedTask(store, 'gh:ok', 'github-sync');

    const scheduler = createLeaseScheduler({
      store,
      leaderId: 'block-test',
      jobs: [],
      executors,
      heartbeatMs: 100_000,
    });

    armItunesSearchBlockStore(store);
    scheduler.start(); // start 同步 tick 一次
    await sleep(50);
    assert.equal(rankCalls, 0, '熔断期自动 tick 不派发 rank');
    assert.ok(githubCalls >= 1, '熔断期 github-sync 照常执行');

    // 显式 runNow rank → 跳过（不执行、不计数、保留状态，仅写摘要）。
    const skipped = await scheduler.runNow('rank:blocked');
    assert.ok(skipped, 'runNow 返回行');
    assert.equal(rankCalls, 0, '熔断期显式 runNow 也不执行 rank');
    assert.equal(skipped?.runCount ?? -1, 0, '跳过不累计 runCount');
    assert.equal(skipped?.lastStatus, 'never', '跳过不改 lastStatus');
    assert.ok(String(skipped?.lastSummary ?? '').includes('熔断'), '跳过写说明性 lastSummary');

    scheduler.dispose();
    store.close();
  });

  // ── scheduler 门控 B：执行中命中 403 → 写熔断键 + 停掉同批后续 rank ──
  await runCase('scheduler: 403 命中写键并停止同批后续 rank', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'headless-block-arm-'));
    const store = openStore(join(dir, 'appilot.db'));
    let rankCalls = 0;
    const throwingRank: TaskExecutor = {
      title: '排名采集',
      intervalMinutes: 720,
      hitsItunesSearch: true,
      run: async () => {
        rankCalls += 1;
        throw forbiddenError();
      },
    };
    const sched = createLeaseScheduler({
      store,
      leaderId: 'arm-test',
      jobs: [],
      executors: { rank: throwingRank },
      heartbeatMs: 100_000,
    });
    seedTask(store, 'rank:first', 'rank');
    seedTask(store, 'rank:second', 'rank');

    const failedRow = await sched.runNow('rank:first');
    assert.equal(rankCalls, 1, '403 实例被执行过一次');
    assert.equal(failedRow?.lastStatus, 'error', '403 实例记 error');
    assert.ok(isItunesSearchBlockedStore(store), '403 命中后熔断键已写入（45 分钟）');
    const armUntil = itunesSearchBlockedUntilStore(store);
    assert.ok(
      armUntil && new Date(armUntil).getTime() > Date.now() + 44 * 60_000,
      '写入的是未来 45 分钟的解除时刻',
    );

    const second = await sched.runNow('rank:second');
    assert.equal(rankCalls, 1, '同批后续 rank 被门控跳过（不重复打 API）');
    assert.equal(second?.lastStatus, 'never', '被跳过的后续实例状态未改（解除后补跑）');

    sched.dispose();
    store.close();
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) FAILED`);
    process.exit(1);
  }
  console.log('\n🎉 All headless itunes-block tests passed!');
}

void main();
