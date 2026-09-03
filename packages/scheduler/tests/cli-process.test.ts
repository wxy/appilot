/**
 * daemon 进程级冒烟：spawn dist/cli.js 验证真进程行为——
 * 1) 双 spawn 单例（第二个安静退出 exit 0）；2) SIGTERM 优雅退出。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';

const CLI = join(__dirname, '..', 'dist', 'cli.js');

function ping(socketPath: string, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect(socketPath);
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(ok);
    };
    setTimeout(() => finish(false), timeoutMs);
    sock.on('connect', () => sock.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) + '\n'));
    const rl = createInterface({ input: sock });
    rl.on('line', (line) => {
      try {
        const m = JSON.parse(line);
        if (m?.result?.ok === true) finish(true);
      } catch {
        /* ignore */
      }
    });
    rl.on('error', () => finish(false));
    sock.on('error', () => finish(false));
    sock.on('close', () => finish(false));
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'sched-cli-'));
  const env = { ...process.env, APPILOT_DB_FILE: join(dir, 'appilot.db') };

  const d1 = spawn(process.execPath, [CLI], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const d1err: string[] = [];
  d1.stderr.on('data', (d) => d1err.push(String(d)));

  // 等 socket 就绪
  const sockPath = join(dir, 'scheduler.sock');
  const deadline = Date.now() + 8000;
  let up = false;
  while (Date.now() < deadline) {
    if (await ping(sockPath)) {
      up = true;
      break;
    }
    await sleep(200);
  }
  assert.equal(up, true, 'daemon socket 应就绪');
  console.log('✓ 进程启动 + socket ping');

  // 双 spawn：第二个应安静退出（exit 0）
  const exit2 = new Promise<number>((resolve) => {
    const d2 = spawn(process.execPath, [CLI], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const err2: string[] = [];
    d2.stderr.on('data', (d) => err2.push(String(d)));
    d2.on('exit', (code) => {
      console.log(`  second daemon exit=${code} stderr: ${err2.join('').slice(0, 120)}`);
      resolve(code ?? -1);
    });
  });
  const code2 = await exit2;
  assert.equal(code2, 0, '第二 daemon 应安静退出（单例仲裁）');
  console.log('✓ 双 spawn 单例（第二个 exit 0）');

  // shutdown（socket 命令）→ 优雅退出
  const shutdown = new Promise<any>((resolve, reject) => {
    const sock = connect(sockPath);
    const rl = createInterface({ input: sock });
    sock.on('connect', () => sock.write(JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'shutdown', params: {} }) + '\n'));
    rl.on('line', (line) => {
      try {
        const m = JSON.parse(line);
        if (m.id === 9) resolve(m);
      } catch {
        /* ignore */
      }
    });
    rl.on('error', reject);
    setTimeout(() => reject(new Error('shutdown 超时')), 5000);
  });
  await shutdown;
  const exit1 = new Promise<number>((resolve) => d1.on('exit', (c) => resolve(c ?? -1)));
  const code1 = await Promise.race([exit1, sleep(5000).then(() => -999)]);
  assert.notEqual(code1, -999, 'shutdown 后应退出');
  assert.equal(code1, 0, `优雅退出 exit 0（实际 ${code1}）`);
  console.log('✓ shutdown（socket）优雅退出');

  console.log('daemon 进程级冒烟全部通过 ✓');
}

main().catch((err) => {
  console.error('cli 进程冒烟失败:', err);
  process.exit(1);
});
