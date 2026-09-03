/**
 * 壳端 ensureScheduler：确保调度守护进程在跑。
 * - ping socket：通 → 直接复用；
 * - 不通 → spawn detached appilot-scheduler（stdio 到日志/继承，不随父死）；
 * - 退避重试 ping：双壳同时拉起由 daemon 的 lease 单例仲裁（输家 exit），
 *   壳最终连到活的那个。
 */
import { connect } from 'node:net';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { ServerMessage } from './protocol.js';
import { decodeLine } from './protocol.js';

export interface EnsureOptions {
  socketPath: string;
  /** 启动守护进程的命令（argv）。默认用同进程可执行路径的 cli。 */
  spawnCommand?: string[];
  /** ping 重试总时长（默认 8s）。 */
  timeoutMs?: number;
  log?(msg: string): void;
}

function pingSocket(socketPath: string, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(socketPath);
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.on('connect', () => {
      socket.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) + '\n');
    });
    const rl = createInterface({ input: socket });
    rl.on('line', (line) => {
      const msg = decodeLine<ServerMessage>(line);
      if (msg && (msg as any).result && (msg as any).result.ok === true) {
        clearTimeout(timer);
        finish(true);
      }
    });
    rl.on('error', () => finish(false));
    socket.on('error', () => finish(false));
    socket.on('close', () => finish(false));
  });
}

/** 确保守护进程在跑；返回 true = 可用。 */
export async function ensureScheduler(opts: EnsureOptions): Promise<boolean> {
  const log = opts.log ?? (() => {});
  const spawnCommand = opts.spawnCommand ?? [process.execPath, 'appilot-scheduler'];
  const deadline = Date.now() + (opts.timeoutMs ?? 8000);

  // 1) 直接 ping（已有 daemon）
  if (await pingSocket(opts.socketPath)) {
    log('scheduler already running');
    return true;
  }
  // 2) spawn detached（不随父死；stdio 继承便于诊断）
  log(`spawning scheduler: ${spawnCommand.join(' ')}`);
  const child = spawn(spawnCommand[0], spawnCommand.slice(1), {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  // 3) 退避重试 ping（daemon 启动 + lease 仲裁；冲突输家退出后可能需重连已存在的）
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 400));
    if (await pingSocket(opts.socketPath)) {
      log('scheduler up');
      return true;
    }
  }
  log('scheduler did not come up within timeout');
  return false;
}
