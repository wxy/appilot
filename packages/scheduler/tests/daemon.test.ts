/**
 * daemon 库级测试：单例仲裁、reconcile→实例执行闭环、socket hello/ping/runNow。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';
import { openStore } from '@appilot-labs/appilot-headless';
import { runDaemon, SCHEDULER_LEADER_ID } from '../src/index.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'sched-daemon-'));
  const dbPath = join(dir, 'appilot.db');
  const socketPath = join(dir, 'scheduler.sock');
  const logs: string[] = [];
  const log = (m: string) => logs.push(m);

  // 预注册一个真实 git 仓库项目（github-sync 实例可立即执行成功）
  const store = openStore(dbPath);
  const repo = join(dir, 'proj');
  const { execSync } = require('node:child_process');
  execSync('mkdir -p ' + repo, { shell: true });
  execSync('git init -q', { cwd: repo });
  execSync('git config user.email t@t.dev && git config user.name t', { cwd: repo });
  execSync('echo a > a.txt && git add -A && git commit -qm init && git tag v1.0.0', { cwd: repo });
  store.projects.save({ name: 'proj', path: repo, githubUrl: null, platform: null, languages: [], lastResolvedAt: new Date().toISOString(), artworkUrl: null, updatedAt: new Date().toISOString() });
  store.close();

  // 1. 单例：第一 daemon 启动成功
  const d1 = await runDaemon({
    dbPath,
    socketPath,
    reconcileIntervalMs: 300,
    heartbeatMs: 100,
    ttlMs: 2000,
    log,
  });
  assert.equal(d1.store.lease.leader(), SCHEDULER_LEADER_ID, 'daemon 应持租约');
  console.log('✓ daemon 启动并持租约');

  // 2. 第二 daemon 同 DB → acquire 失败抛错（单例仲裁）
  let conflict = false;
  try {
    await runDaemon({ dbPath, socketPath, reconcileIntervalMs: 300, heartbeatMs: 100, ttlMs: 2000, log });
  } catch (err: any) {
    // 同 id 双进程：acquire 视为续租，单例由 socket 独占兜底（bind 失败退出）；
    // 跨 id（壳内调度过渡期）由 acquire 拒绝。
    conflict = /已有调度者|single-instance|socket 启动失败/.test(err?.message || '');
  }
  assert.equal(conflict, true, '第二 daemon 应仲裁退出（acquire 或 socket 独占）');
  console.log('✓ 单例仲裁（第二 daemon acquire 失败）');

  // 3. socket：hello + ping
  const hello = await new Promise<any>((resolve, reject) => {
    const sock = connect(socketPath);
    const rl = createInterface({ input: sock });
    sock.on('connect', () => sock.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'hello', params: { client: 'test', pid: 1 } }) + '\n'));
    rl.on('line', (line) => {
      try {
        resolve(JSON.parse(line));
      } catch {
        /* ignore */
      }
    });
    sock.on('error', reject);
    setTimeout(() => reject(new Error('hello 超时')), 3000);
  });
  assert.equal(hello.result?.ok, true);
  assert.equal(hello.result?.protocolVersion, 1);
  console.log('✓ socket hello ack');

  // 4. reconcile 闭环：daemon reconcile seed github-sync 实例 → 主 tick 执行（git tag）
  const deadline = Date.now() + 10000;
  let row: any = null;
  while (Date.now() < deadline) {
    row = d1.store.tasks.get('github-sync:proj');
    if (row && row.lastStatus === 'ok') break;
    await sleep(150);
  }
  assert.equal(row?.lastStatus, 'ok', `github-sync 实例应被执行: ${JSON.stringify(row)}`);
  assert.ok((row?.lastSummary ?? '').includes('tag=v1.0.0'), `摘要应含 tag: ${row?.lastSummary}`);
  assert.equal(row?.source, SCHEDULER_LEADER_ID);
  console.log(`✓ reconcile + 主 tick 执行（source=${row?.source}）`);

  // 5. runNow（socket）
  const runNow = await new Promise<any>((resolve, reject) => {
    const sock = connect(socketPath);
    const rl = createInterface({ input: sock });
    sock.on('connect', () => sock.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'runNow', params: { taskId: 'github-sync:proj' } }) + '\n'));
    rl.on('line', (line) => {
      try {
        resolve(JSON.parse(line));
      } catch {
        /* ignore */
      }
    });
    sock.on('error', reject);
    setTimeout(() => reject(new Error('runNow 超时')), 8000);
  });
  assert.equal(runNow.result?.taskId, 'github-sync:proj');
  console.log('✓ socket runNow');

  // 6. accelerate（socket 命令）→ daemon scheduler 加速（isAccel true 无法直接读，
  //    以无异常响应为验证；加速开启不影响后续 stop）
  const accelRes = await new Promise<any>((resolve, reject) => {
    const sock = connect(socketPath);
    const rl = createInterface({ input: sock });
    sock.on('connect', () => sock.write(JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'accelerate', params: { on: true, seconds: 60 } }) + '\n'));
    rl.on('line', (line) => {
      try {
        const m = JSON.parse(line);
        if (m.id === 8) resolve(m);
      } catch {
        /* ignore */
      }
    });
    sock.on('error', reject);
    setTimeout(() => reject(new Error('accelerate 超时')), 5000);
  });
  assert.equal(accelRes.result?.ok, true, 'accelerate 应 ok');
  console.log('✓ socket accelerate');
  // 关闭加速（避免影响后续）
  await new Promise<any>((resolve) => {
    const sock = connect(socketPath);
    const rl = createInterface({ input: sock });
    sock.on('connect', () => sock.write(JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'accelerate', params: { on: false } }) + '\n'));
    rl.on('line', () => {
      sock.destroy();
      resolve(null);
    });
    sock.on('error', () => resolve(null));
    setTimeout(() => resolve(null), 3000);
  });
  console.log('✓ socket accelerate off');

  // 7. 优雅停止（stop 内关闭 store——停止后不可再查 store）
  await d1.stop();
  assert.ok(logs.some((l) => l.includes('daemon exited cleanly')), '应记录干净退出');
  console.log('✓ 优雅停止');

  console.log('daemon 库级测试全部通过 ✓');
}

main().catch((err) => {
  console.error('daemon 测试失败:', err);
  process.exit(1);
});
