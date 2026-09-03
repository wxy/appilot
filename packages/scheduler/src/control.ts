/**
 * 统一控制路由（最终要求：任何壳都能控制活动任务）。
 *
 * 壳（DSH / CLI / MCP / Electron）的干预命令（立即运行 / 加速 / 停止）应送达
 * 「当前调度主」：daemon 主 → 走 socket 命令；壳本地仅作 daemon 不可达时的
 * 回退（且只能执行本壳 executor 覆盖的任务类型）。本模块给壳一个一致的入口：
 *   controlRunNow / controlAccelerate / controlShutdown / controlStatus
 */
import { defaultDbPath } from '@appilot-labs/appilot-headless';
import { dirname, join } from 'node:path';
import { sendSchedulerCommand, type CommandResult } from './client.js';

export interface ControlOptions {
  dbPath?: string;
  socketPath?: string;
  log?(msg: string): void;
}

function resolvePaths(opts: ControlOptions): { dbPath: string; socketPath: string } {
  const dbPath = opts.dbPath ?? process.env.APPILOT_DB_FILE ?? defaultDbPath();
  return { dbPath, socketPath: opts.socketPath ?? join(dirname(dbPath), 'scheduler.sock') };
}

export interface LeaderControl {
  /** 调度主身份：'scheduler'（daemon，socket 可用）| null（无主/未知）。 */
  leader: string | null;
  socketUp: boolean;
}

/** 探测当前调度主与 daemon socket 可用性。 */
export async function controlStatus(opts: ControlOptions = {}): Promise<LeaderControl & { running: boolean }> {
  const { socketPath } = resolvePaths(opts);
  const res = await sendSchedulerCommand(socketPath, 'ping', {}, 1500);
  if (res.ok) return { leader: 'scheduler', socketUp: true, running: true };
  // socket 不通 → 查 DB 租约（壳主场景）
  let leader: string | null = null;
  try {
    const { openStore } = require('@appilot-labs/appilot-headless') as typeof import('@appilot-labs/appilot-headless');
    const s = openStore(process.env.APPILOT_DB_FILE || defaultDbPath());
    leader = s.lease.leader();
    s.close();
  } catch {
    /* DB 不可读 */
  }
  return { leader, socketUp: false, running: leader !== null };
}

/** 立即运行任务：daemon 主 → socket；否则返回 false（调用方落本地/报错）。 */
export async function controlRunNow(
  taskId: string,
  opts: ControlOptions = {},
): Promise<CommandResult & { routed: 'daemon' | 'local' | 'none' }> {
  const { socketPath } = resolvePaths(opts);
  const res = await sendSchedulerCommand(socketPath, 'runNow', { taskId }, 15_000);
  if (res.ok) return { ...res, routed: 'daemon' };
  return { ...res, routed: res.error?.includes('socket') ? 'none' : 'local' };
}

/** 加速：daemon 主 → socket accelerate。 */
export async function controlAccelerate(
  on: boolean,
  seconds?: number,
  opts: ControlOptions = {},
): Promise<CommandResult & { routed: 'daemon' | 'none' }> {
  const { socketPath } = resolvePaths(opts);
  const res = await sendSchedulerCommand(socketPath, 'accelerate', { on, seconds }, 3000);
  return { ...res, routed: res.ok ? 'daemon' : 'none' };
}

/** 停止整个调度（daemon）。 */
export async function controlShutdown(opts: ControlOptions = {}): Promise<CommandResult> {
  const { socketPath } = resolvePaths(opts);
  return sendSchedulerCommand(socketPath, 'shutdown', {}, 5000);
}
