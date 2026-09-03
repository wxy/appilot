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
  /** 启动守护进程的命令（argv）。缺省用 resolveSchedulerCli() 定位。 */
  spawnCommand?: string[];
  /** ping 重试总时长（默认 8s）。 */
  timeoutMs?: number;
  log?(msg: string): void;
}

/**
 * 解析 appilot-scheduler cli 路径（壳依赖本包时用 createRequire 解析）。
 * 解析失败返回 null（壳可跳过 ensure，回退自身调度）。
 */
export function resolveSchedulerCli(requirer?: { resolve(id: string): string }): string | null {
  try {
    const req = requirer ?? (require as unknown as { resolve(id: string): string });
    return req.resolve('@appilot-labs/appilot-scheduler/cli');
  } catch {
    return null;
  }
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
  const spawnCommand =
    opts.spawnCommand ?? (resolveSchedulerCli() ? [process.execPath, resolveSchedulerCli()!] : null);
  const deadline = Date.now() + (opts.timeoutMs ?? 8000);

  // 1) 直接 ping（已有 daemon）
  if (await pingSocket(opts.socketPath)) {
    log('scheduler already running');
    return true;
  }
  if (!spawnCommand) {
    log('appilot-scheduler cli 不可解析，跳过 ensure（回退壳内调度）');
    return false;
  }
  // 2) spawn detached（不随父死；stdio 忽略）
  log(`spawning scheduler: ${spawnCommand.join(' ')}`);
  const child = spawn(spawnCommand[0], spawnCommand.slice(1), {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
  // daemon 快速 exit 0 = 单例仲裁让位（已有调度者——壳/其他 daemon 持主）：
  // 调度已在跑，ensure 视为成功，无需继续等待/报错。
  let gaveWay = false;
  child.on('exit', (code) => {
    if (code === 0) {
      gaveWay = true;
      log('scheduler exited 0（单例仲裁让位——已有调度者在跑）');
    }
  });
  // 3) 退避重试 ping（daemon 启动 + lease 仲裁；冲突输家退出后可能需重连已存在的）
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 400));
    if (gaveWay) return true;
    if (await pingSocket(opts.socketPath)) {
      log('scheduler up');
      return true;
    }
  }
  log('scheduler did not come up within timeout');
  return false;
}
