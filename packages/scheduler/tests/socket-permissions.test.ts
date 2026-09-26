/**
 * socket 控制面权限测试（审计 2026-09-26 H3）：
 * socket 文件权限 = 内核默认 & ~umask——测试刻意把 umask 放宽到 000，
 * 无 chmod 修复时 socket 会是 0777（任意本地用户可连）；修复后必须为 0600，
 * 且收紧不得破坏正常客户端通信。
 */
import { mkdtempSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';
import { createSchedulerServer } from '../src/server.js';

async function main(): Promise<void> {
  if (process.platform === 'win32') {
    console.log('win32 无 unix socket 文件权限语义，跳过');
    return;
  }
  const oldUmask = process.umask(0o000); // 放宽到最坏情况：新文件默认全开放
  const dir = mkdtempSync(join(tmpdir(), 'sched-sockperm-'));
  const socketPath = join(dir, 'scheduler.sock');
  const server = createSchedulerServer(socketPath, {
    onHello: ({ client }) => ({ protocolVersion: 1, daemonPid: process.pid }),
    onRunNow: async () => ({}),
    log: () => {},
  });
  try {
    await server.start();
    const mode = statSync(socketPath).mode & 0o777;
    assert.equal(mode, 0o600, `socket 权限应为 0600（实际 ${mode.toString(8)}）`);
    console.log('✓ umask 000 下 socket 权限仍为 0600');

    // 连通性：chmod 不得破坏正常客户端（ping → ok）。
    const pong = await new Promise<any>((resolve, reject) => {
      const sock = connect(socketPath);
      const rl = createInterface({ input: sock });
      sock.on('connect', () =>
        sock.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) + '\n'),
      );
      rl.on('line', (line) => {
        try {
          const m = JSON.parse(line);
          if (m.id === 1) resolve(m);
        } catch {
          /* 忽略非 JSON 行 */
        }
      });
      sock.on('error', reject);
      setTimeout(() => reject(new Error('ping 超时')), 3000);
    });
    assert.equal(pong?.result?.ok, true, 'chmod 后客户端 ping 仍应成功');
    console.log('✓ 收紧后客户端 ping 正常');
  } finally {
    process.umask(oldUmask);
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
  console.log('socket 权限测试全部通过 ✓');
}

main().catch((err) => {
  console.error('socket 权限测试失败:', err);
  process.exit(1);
});
