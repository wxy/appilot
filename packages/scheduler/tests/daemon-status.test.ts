/**
 * daemon 自维护状态（架构收敛 B）测试：
 * - socket status 方法返回 daemon 自状态（startedAt/uptimeMs/processed 系
 *   列/lastRunAt/version/fingerprint/accel）且序列化字段齐全；
 * - daemon 执行实例后 scheduler.stats() 累计（status 与 handle.stats 同源）；
 * - socket runDue（立即处理到期）正常响应；daemon 状态 accel 与 accelerate 联动。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';
import { openStore } from '@appilot-labs/appilot-headless';
import {
  runDaemon,
  SCHEDULER_LEADER_ID,
  sendSchedulerCommand,
  SCHEDULER_FINGERPRINT_ENV,
} from '../src/index.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 发一条 socket JSON-RPC 并等待响应。 */
function rpc(socketPath: string, id: number, method: string, params: Record<string, unknown>, timeoutMs = 6000): Promise<any> {
  return new Promise((resolve, reject) => {
    const sock = connect(socketPath);
    const rl = createInterface({ input: sock });
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error(`${method} 超时`));
    }, timeoutMs);
    sock.on('connect', () => sock.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'));
    rl.on('line', (line) => {
      try {
        const m = JSON.parse(line);
        if (m?.id === id) {
          clearTimeout(timer);
          sock.destroy();
          resolve(m);
        }
      } catch {
        /* ignore */
      }
    });
    sock.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'sched-status-'));
  const dbPath = join(dir, 'appilot.db');
  const socketPath = join(dir, 'scheduler.sock');
  const logs: string[] = [];
  const log = (m: string) => logs.push(m);

  // 注册一个真实 git 仓库项目，让 daemon reconcile seed github-sync 实例并可执行。
  const store = openStore(dbPath);
  const repo = join(dir, 'proj');
  const { execSync } = require('node:child_process');
  execSync('mkdir -p ' + repo, { shell: true });
  execSync('git init -q', { cwd: repo });
  execSync('git config user.email t@t.dev && git config user.name t', { cwd: repo });
  execSync('echo a > a.txt && git add -A && git commit -qm init && git tag v1.0.0', { cwd: repo });
  store.projects.save({ id: 'proj-id', name: 'proj', path: repo, githubUrl: null, platform: null, languages: [], lastResolvedAt: new Date().toISOString(), artworkUrl: null, updatedAt: new Date().toISOString() });
  store.close();

  const fingerprint = 'f'.repeat(40);
  const env = { ...process.env, [SCHEDULER_FINGERPRINT_ENV]: fingerprint };
  // runDaemon 读 process.env 指纹——通过注入 env 的 CLI 进程测太绕；库级直接设 env。
  const prevFp = process.env[SCHEDULER_FINGERPRINT_ENV];
  process.env[SCHEDULER_FINGERPRINT_ENV] = fingerprint;

  const d1 = await runDaemon({
    dbPath,
    socketPath,
    reconcileIntervalMs: 250,
    heartbeatMs: 100,
    ttlMs: 2000,
    log,
  });
  assert.equal(d1.store.lease.leader(), SCHEDULER_LEADER_ID, 'daemon 应持租约');

  // 1. status 字段齐全（daemon 自状态）
  const st = await rpc(socketPath, 1, 'status', {});
  assert.equal(st.result?.ok, true, 'status 应 ok');
  const s = st.result as Record<string, unknown>;
  assert.equal(s.daemonPid, process.pid, 'daemonPid');
  assert.ok(typeof s.version === 'string' && (s.version as string).length > 0, 'version 非空');
  assert.ok(Date.parse(String(s.startedAt)) > 0, 'startedAt 可解析');
  assert.ok(Number(s.uptimeMs) >= 0, 'uptimeMs 数值');
  assert.equal(typeof s.processedExecutions, 'number', 'processedExecutions 数值');
  assert.equal(typeof s.processedTasks, 'number', 'processedTasks 数值');
  assert.equal(typeof s.executedToday, 'number', 'executedToday 数值');
  assert.equal(typeof s.accel, 'boolean', 'accel 布尔');
  assert.equal(s.fingerprint, fingerprint, 'daemon 上报启动指纹');
  assert.equal(s.leaderId, SCHEDULER_LEADER_ID, 'leaderId = scheduler');
  console.log('✓ socket status：daemon 自状态字段齐全（含指纹上报）');

  // 2. reconcile→主 tick 执行 → stats 累计（status 与 handle.scheduler.stats 同源）
  const deadline = Date.now() + 12000;
  let row: any = null;
  while (Date.now() < deadline) {
    row = d1.store.tasks.get('github-sync:proj-id');
    if (row && row.lastStatus === 'ok') break;
    await sleep(150);
  }
  assert.equal(row?.lastStatus, 'ok', `github-sync 实例应被执行: ${JSON.stringify(row)}`);
  const hstats = d1.scheduler.stats();
  assert.ok(hstats.processed >= 1, `handle stats.processed ≥ 1（实际 ${hstats.processed}）`);
  const st2 = await rpc(socketPath, 2, 'status', {});
  assert.ok(Number(st2.result?.processedExecutions) >= 1, 'status processedExecutions 随执行累计');
  assert.equal(Number(st2.result?.processedTasks), hstats.uniqueTasks, 'processedTasks = uniqueTasks');
  assert.ok(Date.parse(String(st2.result?.lastRunAt)) > 0, 'lastRunAt 非空');
  console.log(`✓ 执行累计（status.processedExecutions=${st2.result?.processedExecutions}，handle 同源）`);

  // 3. runDue：kick 一轮 tick（响应 ok；不抛错）
  const kick = await rpc(socketPath, 3, 'runDue', {});
  assert.equal(kick.result?.ok, true, 'runDue 应 ok');
  console.log('✓ socket runDue（立即处理到期）');

  // 4. accelerate on → status.accel=true + accelUntil 有值；off → false
  await rpc(socketPath, 4, 'accelerate', { on: true, seconds: 60 }, 5000);
  const stOn = await rpc(socketPath, 5, 'status', {});
  assert.equal(stOn.result?.accel, true, 'accelerate on → accel=true');
  assert.ok(Date.parse(String(stOn.result?.accelUntil)) > 0, 'accelUntil 有值');
  await rpc(socketPath, 6, 'accelerate', { on: false }, 5000);
  const stOff = await rpc(socketPath, 7, 'status', {});
  assert.equal(stOff.result?.accel, false, 'accelerate off → accel=false');
  assert.equal(stOff.result?.accelUntil, null, 'accelUntil 清空');
  console.log('✓ status.accel/accelUntil 与 accelerate 联动');

  // 5. sendSchedulerCommand（包级客户端）也可读 status
  const viaClient = await sendSchedulerCommand(socketPath, 'status', {}, 3000);
  assert.equal(viaClient.ok, true, 'sendSchedulerCommand status ok');
  assert.ok(typeof (viaClient.result as any)?.startedAt === 'string', '客户端读 status 字段');
  console.log('✓ 包级客户端 sendSchedulerCommand(status)');

  await d1.stop();
  assert.ok(logs.some((l) => l.includes('daemon exited cleanly')), '应记录干净退出');
  if (prevFp == null) delete process.env[SCHEDULER_FINGERPRINT_ENV];
  else process.env[SCHEDULER_FINGERPRINT_ENV] = prevFp;
  console.log('daemon 自状态测试全部通过 ✓');
}

main().catch((err) => {
  console.error('daemon 自状态测试失败:', err);
  process.exit(1);
});
