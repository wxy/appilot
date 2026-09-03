/**
 * daemon 自更新 进程级测试：真进程验证「磁盘代码变更 → daemon 自动重启加载新代码」。
 * 场景：spawn cli.js（env 指向临时监控目录，检查周期 400ms）→ 改写哨兵文件 →
 * 旧进程应 exit 0，随后**新进程**出现并接管 socket/租约（pid 不同）→ shutdown 收尾。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';

const CLI = join(__dirname, '..', 'dist', 'cli.js');

function ping(socketPath: string, timeoutMs = 2500): Promise<boolean> {
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
    sock.on('error', () => finish(false));
    rl.on('error', () => finish(false));
    sock.on('close', () => finish(false));
  });
}

async function waitPing(socketPath: string, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await ping(socketPath)) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'sched-selfupd-proc-'));
  const mon = join(dir, 'mon');
  mkdirSync(mon, { recursive: true });
  const sentinel = join(mon, 'executors.js');
  writeFileSync(sentinel, 'v1');

  const env = {
    ...process.env,
    APPILOT_DB_FILE: join(dir, 'appilot.db'),
    APPILOT_SCHEDULER_MONITOR_DIRS: mon,
    APPILOT_SCHEDULER_UPDATE_CHECK_MS: '400',
  };

  const d1 = spawn(process.execPath, [CLI], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const d1err: string[] = [];
  d1.stderr.on('data', (d) => d1err.push(String(d)));
  const sockPath = join(dir, 'scheduler.sock');

  assert.equal(await waitPing(sockPath, 8000), true, 'daemon 应启动并监听 socket');
  const pid1 = d1.pid;
  console.log(`✓ daemon 启动（pid ${pid1}）`);

  // 改写监控文件 → 期望旧进程在数秒内优雅退出（exit 0）
  writeFileSync(sentinel, 'v2');
  const exit1 = new Promise<number | null>((resolve) =>
    d1.on('exit', (code) => resolve(code)),
  );
  const code1 = await Promise.race([exit1, new Promise<number | null>((r) => setTimeout(() => r(null), 8000))]);
  assert.notEqual(code1, null, '代码变更后 daemon 应退出（自重启）');
  assert.equal(code1, 0, `旧进程应 exit 0（实际 ${code1}）`);
  console.log(`✓ 代码变更 → 旧 daemon 退出（exit ${code1}）: ${d1err.join('').slice(0, 200)}`);

  // 新进程接管：socket 重新可 ping（期间短暂空窗）；pid 应不同
  assert.equal(await waitPing(sockPath, 8000), true, '新 daemon 应接管 socket');
  // 确认换了个进程：向新 daemon 发 hello 拿 daemonPid
  const helloPid = await new Promise<number>((resolve, reject) => {
    const sock = connect(sockPath);
    const rl = createInterface({ input: sock });
    sock.on('connect', () =>
      sock.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'hello', params: { client: 'test', pid: 0 } }) + '\n'),
    );
    rl.on('line', (line) => {
      try {
        const m = JSON.parse(line);
        if (m?.id === 2) resolve(m.result?.daemonPid as number);
      } catch {
        /* ignore */
      }
    });
    sock.on('error', reject);
    rl.on('error', reject);
    setTimeout(() => reject(new Error('hello 超时')), 4000);
  });
  assert.notEqual(helloPid, pid1, `接管者应是新进程（旧 ${pid1}，新 ${helloPid}）`);
  console.log(`✓ 新 daemon 接管（pid ${helloPid} ≠ 旧 ${pid1}）——已加载新代码`);

  // 收尾：shutdown 新 daemon
  await new Promise<void>((resolve) => {
    const sock = connect(sockPath);
    sock.on('connect', () =>
      sock.write(JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'shutdown', params: {} }) + '\n'),
    );
    sock.on('error', () => resolve());
    sock.on('close', () => resolve());
    setTimeout(() => resolve(), 3000);
  });
  console.log('daemon 自更新进程级测试通过 ✓');
}

main().catch((err) => {
  console.error('自更新进程级测试失败:', err);
  process.exit(1);
});
