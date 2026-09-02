/**
 * headless CLI 端到端测试：spawn bin 进程 + 隔离 DB（APPILOT_DB_FILE），
 * 覆盖 db / register / list / get / tasks list / run / remove 全链路。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import assert from 'node:assert';

const BIN = join(__dirname, '..', 'dist', 'cli.js');

function run(args: string[], dbPath: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      env: { ...process.env, APPILOT_DB_FILE: dbPath },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += String(d)));
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('exit', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

async function main(): Promise<void> {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'appilot-cli-test-')), 'appilot.db');
  const repo = dirname(dirname(__dirname)); // packages 上级 = 仓库根（真实 git 仓库）

  const db = await run(['db'], dbPath);
  assert.equal(db.code, 0, `db 应成功: ${db.stderr}`);
  assert.ok(JSON.parse(db.stdout).dbPath === dbPath, 'db 路径输出');
  console.log('✓ db');

  const reg = await run(['projects', 'register', repo, '--name', 'cli-test-proj'], dbPath);
  assert.equal(reg.code, 0, `register 应成功: ${reg.stderr}`);
  assert.ok(JSON.parse(reg.stdout).registered.name === 'cli-test-proj');
  console.log('✓ projects register');

  const lst = await run(['projects', 'list'], dbPath);
  assert.ok(JSON.parse(lst.stdout).projects.some((p: any) => p.name === 'cli-test-proj'));
  console.log('✓ projects list');

  const get = await run(['projects', 'get', 'cli-test-proj'], dbPath);
  assert.equal(JSON.parse(get.stdout).path, repo);
  console.log('✓ projects get');

  const tasks = await run(['tasks', 'list'], dbPath);
  const defs = JSON.parse(tasks.stdout).definitions;
  assert.ok(defs.some((d: any) => d.id === 'release-sync') && defs.some((d: any) => d.id === 'readiness'));
  console.log('✓ tasks list');

  // run readiness：DB 有真实 git 仓库 → 返回 summary 且任务状态落库
  const runRes = await run(['run', 'readiness'], dbPath);
  assert.equal(runRes.code, 0, `run readiness 应成功: ${runRes.stderr}`);
  const runJson = JSON.parse(runRes.stdout);
  assert.ok(runJson.lastStatus === 'ok' || runJson.lastStatus === 'error', 'run 落库状态');
  assert.ok(runJson.runCount >= 1);
  console.log(`✓ run readiness (status=${runJson.lastStatus})`);

  // run 实例任务：github-sync:<project>（现场 seed + 核心执行器跑真实仓库）
  const inst = await run(['run', 'github-sync:cli-test-proj'], dbPath);
  assert.equal(inst.code, 0, `run github-sync 实例应成功: ${inst.stderr}`);
  const instJson = JSON.parse(inst.stdout);
  assert.equal(instJson.kind, 'github-sync', '实例应带 kind');
  assert.equal(instJson.source, 'cli');
  assert.ok(instJson.lastStatus === 'ok' || instJson.lastStatus === 'error', '实例落库状态');
  assert.ok((instJson.lastSummary ?? '').length > 0, '实例应有摘要');
  assert.ok(instJson.runCount >= 1);
  console.log(`✓ run github-sync:cli-test-proj 实例 (status=${instJson.lastStatus})`);

  // run 未知任务 → 非零退出 + stderr
  const bad = await run(['run', 'nope'], dbPath);
  assert.notEqual(bad.code, 0);
  assert.ok(bad.stderr.includes('未知任务'));
  console.log('✓ run 未知任务报错');

  const rem = await run(['projects', 'remove', 'cli-test-proj'], dbPath);
  assert.equal(JSON.parse(rem.stdout).removed, true);
  const lst2 = await run(['projects', 'list'], dbPath);
  assert.ok(!JSON.parse(lst2.stdout).projects.some((p: any) => p.name === 'cli-test-proj'));
  console.log('✓ projects remove');

  // lease status：无主 → null；模拟有主 → 显示 leader + 心跳年龄
  const leaseEmpty = await run(['lease', 'status'], dbPath);
  assert.equal(JSON.parse(leaseEmpty.stdout).leader, null, '新 DB 应无租约主');
  console.log('✓ lease status（无主）');

  const { openStore } = require('@appilot-labs/appilot-headless');
  const holder = openStore(dbPath);
  assert.equal(holder.lease.acquire('test-leader', 60_000), true);
  holder.close();
  const leaseTaken = await run(['lease', 'status'], dbPath);
  const leaseJson = JSON.parse(leaseTaken.stdout);
  assert.equal(leaseJson.leader, 'test-leader');
  assert.ok(typeof leaseJson.ageMs === 'number');
  console.log(`✓ lease status（主=test-leader, ageMs=${leaseJson.ageMs}）`);

  // snapshots history：seed 两条 → history 返回降序点；productId 过滤
  const store = openStore(dbPath);
  store.snapshots.add([
    { projectName: 'cli-test-proj', productId: null, keyword: 'app', language: 'en', storefront: 'us', rank: 3, totalResults: 100, checkedAt: '2026-08-01T00:00:00Z' },
    { projectName: 'cli-test-proj', productId: null, keyword: 'app', language: 'en', storefront: 'us', rank: 2, totalResults: 100, checkedAt: '2026-08-02T00:00:00Z' },
    { projectName: 'cli-test-proj', productId: 'cli-test-proj:macos', keyword: 'app', language: 'en', storefront: 'us', rank: 1, totalResults: 100, checkedAt: '2026-08-02T00:00:00Z' },
  ]);
  store.close();
  const hist = await run(['snapshots', 'history', 'cli-test-proj'], dbPath);
  const histJson = JSON.parse(hist.stdout);
  assert.equal(histJson.count, 2, '缺省只返回 DSH 维度（productId null）');
  assert.equal(histJson.snapshots[0].rank, 2, '降序最新在前');
  const histProd = await run(['snapshots', 'history', 'cli-test-proj', '--product', 'cli-test-proj:macos'], dbPath);
  assert.equal(JSON.parse(histProd.stdout).count, 1);
  const histKw = await run(['snapshots', 'history', 'cli-test-proj', '--limit', '1'], dbPath);
  assert.equal(JSON.parse(histKw.stdout).count, 1);
  console.log('✓ snapshots history（降序/productId/limit）');

  // snapshots prune：清 90 天前（seed 里 2026-08 距今不足 90 天 → 保留？用显式 before 清全部）
  const seedStore = openStore(dbPath);
  seedStore.snapshots.add([
    { projectName: 'old-proj', productId: null, keyword: 'k', language: 'en', storefront: 'us', rank: 9, totalResults: 10, checkedAt: '2020-01-01T00:00:00Z' },
    { projectName: 'old-proj', productId: null, keyword: 'k', language: 'en', storefront: 'us', rank: 8, totalResults: 10, checkedAt: '2026-08-15T00:00:00Z' },
  ]);
  seedStore.close();
  const prune = await run(['snapshots', 'prune', 'old-proj', '--before', '2025-01-01T00:00:00Z'], dbPath);
  const pruneJson = JSON.parse(prune.stdout);
  assert.equal(pruneJson.removed, 1, '只清早于 before 的行');
  assert.equal(pruneJson.beforeIso, '2025-01-01T00:00:00Z');
  console.log('✓ snapshots prune（--before 窗口）');

  // tasks list --source：seed 不同来源行 → 过滤正确
  const tStore = openStore(dbPath);
  tStore.tasks.upsert({ id: 'release-sync', title: '发布同步', intervalMinutes: 60, lastRunAt: null, nextRunAt: null, lastStatus: 'never', lastSummary: null, runCount: 0, source: 'dsh' });
  tStore.tasks.upsert({ id: 'prod:macos:kw', title: '排名采集', intervalMinutes: 720, lastRunAt: null, nextRunAt: null, lastStatus: 'never', lastSummary: null, runCount: 0, source: 'electron' });
  tStore.close();
  const tAll = JSON.parse((await run(['tasks', 'list'], dbPath)).stdout);
  assert.ok(tAll.tasks.some((t: any) => t.source === 'electron'), 'tasks list 应含 source 字段');
  const tElectron = JSON.parse((await run(['tasks', 'list', '--source', 'electron'], dbPath)).stdout);
  assert.equal(tElectron.tasks.length, 1);
  assert.equal(tElectron.tasks[0].id, 'prod:macos:kw');
  const tDsh = JSON.parse((await run(['tasks', 'list', '--source', 'dsh'], dbPath)).stdout);
  assert.ok(tDsh.tasks.every((t: any) => t.source === 'dsh'));
  console.log('✓ tasks list --source 过滤');

  console.log('CLI 端到端测试全部通过 ✓');
}

main().catch((err) => {
  console.error('CLI 测试失败:', err);
  process.exit(1);
});
