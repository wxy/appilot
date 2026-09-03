/**
 * 实例任务引擎测试（v4）：reconcile 推导 + scheduler executor 执行闭环。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { openStore, buildHeadlessExecutors, githubSyncInstancesFor, reconcileTaskInstances, createLeaseScheduler } from '../src/index.js';

const dir = mkdtempSync(join(tmpdir(), 'headless-inst-'));

function makeGitRepo(name: string, tag?: string): string {
  const d = join(dir, name);
  execSync('mkdir -p ' + d, { shell: true });
  execSync('git init -q', { cwd: d });
  execSync('git config user.email "t@t.dev" && git config user.name "t"', { cwd: d });
  execSync('echo hi > a.txt && git add -A && git commit -qm init', { cwd: d });
  if (tag) execSync(`git tag ${tag}`, { cwd: d });
  return d;
}

async function main(): Promise<void> {
  const failures: string[] = [];
  const pass = (n: string) => console.log(`✅ PASS: ${n}`);
  const run = async (n: string, fn: () => Promise<void>) => {
    try {
      await fn();
      pass(n);
    } catch (e) {
      failures.push(n);
      console.error(`❌ FAIL: ${n} — ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /* ── 1. schema v3→v4 迁移：旧库（无 kind/instance）重开加列 ── */
  await run('schema v3→v4 migration adds kind/instance', async () => {
    const dbPath = join(dir, 'migrate-v4.db');
    const v3 = new DatabaseSync(dbPath);
    v3.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, intervalMinutes INTEGER NOT NULL,
        lastRunAt TEXT, nextRunAt TEXT, lastStatus TEXT NOT NULL DEFAULT 'never',
        lastSummary TEXT, runCount INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'dsh');
      INSERT INTO meta (key, value) VALUES ('schemaVersion', '3');`);
    v3.close();
    const store = openStore(dbPath);
    store.tasks.upsert({ id: 'x', title: '旧行', intervalMinutes: 60, lastRunAt: null, nextRunAt: null, lastStatus: 'never', lastSummary: null, runCount: 0 });
    assert.equal(store.tasks.get('x')?.kind, null, '旧行 kind 应为 null');
    store.tasks.upsert({ id: 'inst', title: '实例', intervalMinutes: 60, lastRunAt: null, nextRunAt: null, lastStatus: 'never', lastSummary: null, runCount: 0, source: 'dsh', kind: 'github-sync', instance: { path: '/x' } });
    assert.deepEqual(store.tasks.get('inst')?.instance, { path: '/x' }, 'instance JSON 往返');
    store.close();
  });

  /* ── 2. reconcile：seed + 幂等 + prune ── */
  await run('reconcile seed/幂等/清理', async () => {
    const dbPath = join(dir, 'reconcile.db');
    const store = openStore(dbPath);
    const p1 = makeGitRepo('proj-a', 'v1.0.0');
    const p2 = makeGitRepo('proj-b');
    const projA = { name: 'proj-a', path: p1 };
    const projB = { name: 'proj-b', path: p2 };

    const r1 = reconcileTaskInstances(store, githubSyncInstancesFor([projA, projB]), 'dsh');
    assert.deepEqual(r1, { seeded: 2, pruned: 0 });
    const a = store.tasks.get('github-sync:proj-a');
    assert.equal(a?.kind, 'github-sync');
    assert.deepEqual(a?.instance, { projectName: 'proj-a', path: p1 });
    assert.ok(a?.nextRunAt, 'seed 后应可立即到期');

    const r2 = reconcileTaskInstances(store, githubSyncInstancesFor([projA, projB]), 'dsh');
    assert.equal(r2.seeded, 0, '重复 reconcile 不应重复 seed');

    const r3 = reconcileTaskInstances(store, githubSyncInstancesFor([projA]), 'dsh');
    assert.deepEqual(r3, { seeded: 0, pruned: 1 });
    assert.equal(store.tasks.get('github-sync:proj-b'), undefined, '消失项目实例应被清');

    // 其他来源同 id 不受影响
    store.tasks.upsert({ id: 'github-sync:proj-b', title: 'X', intervalMinutes: 60, lastRunAt: null, nextRunAt: null, lastStatus: 'never', lastSummary: null, runCount: 0, source: 'electron', kind: 'github-sync', instance: { path: '/e' } });
    const r4 = reconcileTaskInstances(store, githubSyncInstancesFor([projA]), 'dsh');
    assert.equal(r4.pruned, 0, '不应清 electron 来源行');
    assert.equal(store.tasks.get('github-sync:proj-b')?.source, 'electron');

    // 镜像先建的行（kind=null 无 instance）→ reconcile 刷新应升级身份（setIdentity）
    const ghost = makeGitRepo('ghost-proj', 'v1.1.0');
    store.tasks.upsert({ id: 'github-sync:ghost-proj', title: '排名采集镜像', intervalMinutes: 55, lastRunAt: '2026-09-01T00:00:00Z', nextRunAt: null, lastStatus: 'ok', lastSummary: '旧', runCount: 3, source: 'electron' });
    const pre = store.tasks.get('github-sync:ghost-proj');
    assert.equal(pre?.kind, null, '镜像先行 kind=null（INSERT 新行）');
    reconcileTaskInstances(store, githubSyncInstancesFor([{ name: 'ghost-proj', path: ghost }]), 'dsh');
    const upgraded = store.tasks.get('github-sync:ghost-proj');
    assert.equal(upgraded?.kind, 'github-sync', '镜像 null 行应被升级 kind');
    assert.deepEqual(upgraded?.instance, { projectName: 'ghost-proj', path: ghost }, 'instance 应被写入');
    // 状态与排程保留（refresh 不改状态）；来源保留原值（不夺 source）
    assert.equal(upgraded?.lastStatus, 'ok');
    assert.equal(upgraded?.runCount, 3);
    assert.equal(upgraded?.source, 'electron', '刷新不应夺走原来源');
    store.close();
  });

  /* ── 3. scheduler executor：实例执行 + runNow + 失败 ── */
  await run('scheduler executor 执行 github-sync 实例', async () => {
    const dbPath = join(dir, 'sched-inst.db');
    const store = openStore(dbPath);
    const repo = makeGitRepo('proj-x', 'v2.0.0');
    reconcileTaskInstances(store, githubSyncInstancesFor([{ name: 'proj-x', path: repo }]), 'dsh');

    const executors = buildHeadlessExecutors({ readToken: () => null });
    const sched = createLeaseScheduler({
      store,
      leaderId: 'test-inst',
      jobs: [],
      executors,
      heartbeatMs: 50,
    });
    sched.start();

    const deadline = Date.now() + 8000;
    let row: any = null;
    while (Date.now() < deadline) {
      row = store.tasks.get('github-sync:proj-x');
      if (row && row.lastStatus === 'ok') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(row?.lastStatus, 'ok', `实例应执行成功，实际 ${row?.lastStatus}`);
    assert.ok((row?.lastSummary ?? '').includes('tag=v2.0.0'), `摘要应含 tag: ${row?.lastSummary}`);
    assert.ok(row?.runCount >= 1);

    // P1a：深度执行应把发布缓存写进共享 DB（projectName 维度，tag 可读）
    const cache = store.releaseCache.get('proj-x');
    assert.ok(cache, '执行后应有发布缓存行');
    assert.equal((cache?.cache as any)?.tag, 'v2.0.0', `缓存应含 tag: ${JSON.stringify(cache?.cache).slice(0, 120)}`);
    assert.ok((cache?.cache as any)?.syncedAt, '缓存应含 syncedAt');

    // runNow：显式触发（nextRunAt 已推未来，runNow 仍执行）
    const before = store.tasks.get('github-sync:proj-x')?.runCount ?? 0;
    const res = await sched.runNow('github-sync:proj-x');
    assert.ok(res, 'runNow 实例应返回行');
    assert.ok((store.tasks.get('github-sync:proj-x')?.runCount ?? 0) > before, 'runNow 应再跑一次');

    // 未知 id → undefined
    const miss = await sched.runNow('nope');
    assert.equal(miss, undefined);

    sched.dispose();
    store.close();
  });

  /* ── 4. 失败实例记 error ── */
  await run('实例失败记 error', async () => {
    const dbPath = join(dir, 'fail-inst.db');
    const store = openStore(dbPath);
    const executors = buildHeadlessExecutors({ readToken: () => null });
    const sched = createLeaseScheduler({ store, leaderId: 'test-fail', jobs: [], executors });
    store.tasks.upsert({ id: 'github-sync:bad', title: 'GitHub 发布同步', intervalMinutes: 60, lastRunAt: null, nextRunAt: new Date().toISOString(), lastStatus: 'never', lastSummary: null, runCount: 0, source: 'dsh', kind: 'github-sync', instance: {} as Record<string, unknown> });
    const badRes = await sched.runNow('github-sync:bad');
    assert.equal(badRes?.lastStatus, 'error', '失败实例应记 error');
    assert.ok((badRes?.lastSummary ?? '').length > 0);
    sched.dispose();
    store.close();
  });


  /* ── 5. 加速模式：tick 间隔缩短 + 上限放大 ── */
  await run('加速模式', async () => {
    const dbPath = join(dir, 'accel.db');
    const store = openStore(dbPath);
    const repo = makeGitRepo('accel-proj', 'v3.0.0');
    reconcileTaskInstances(store, githubSyncInstancesFor([{ name: 'accel-proj', path: repo }]), 'dsh');
    const executors = buildHeadlessExecutors({ readToken: () => null });
    const sched = createLeaseScheduler({
      store,
      leaderId: 'accel-test',
      jobs: [],
      executors,
      heartbeatMs: 200,
      accel: { tickMs: 50, tickLimit: 100 },
    });
    sched.start();
    assert.equal(sched.isAccel(), false);
    sched.setAccel(true);
    assert.equal(sched.isAccel(), true, 'setAccel(true) 后应处于加速');
    // 加速立刻触发一轮 tick —— 到期实例应被执行
    const deadline = Date.now() + 6000;
    let row: any = null;
    while (Date.now() < deadline) {
      row = store.tasks.get('github-sync:accel-proj');
      if (row && row.lastStatus === 'ok') break;
      await new Promise((r) => setTimeout(r, 80));
    }
    assert.equal(row?.lastStatus, 'ok', '加速轮应执行实例');
    sched.setAccel(false);
    assert.equal(sched.isAccel(), false);
    sched.dispose();
    store.close();
  });

  if (failures.length > 0) {
    console.error(`\n${failures.length} test(s) FAILED`);
    process.exit(1);
  }
  console.log('🎉 All instance-task engine tests passed!');
}

main().catch((err) => {
  console.error('instances 测试失败:', err);
  process.exit(1);
});
