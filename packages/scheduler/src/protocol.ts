/**
 * 壳 ↔ 调度守护进程 协议（本地 socket，换行分隔 JSON-RPC 2.0）。
 * 纯类型与编解码（可单测，不依赖 net）。
 */

export const SCHEDULER_PROTOCOL_VERSION = 1;

/** 客户端 → daemon 请求。 */
export type ClientRequest =
  | { method: 'hello'; params: { client: string; pid: number } }
  | { method: 'ping'; params?: Record<string, never> }
  | { method: 'runNow'; params: { taskId: string } }
  | { method: 'accelerate'; params: { on: boolean; seconds?: number } }
  | { method: 'shutdown'; params?: Record<string, never> }
  | { method: 'bye'; params?: Record<string, never> };

/** daemon → 客户端。 */
export type ServerMessage =
  | { jsonrpc: '2.0'; id: number; result?: unknown; error?: { code: number; message: string } }
  | { jsonrpc: '2.0'; method: 'notify:task-started'; params: { id: string; title: string } }
  | { jsonrpc: '2.0'; method: 'notify:task-finished'; params: { id: string; status: string; summary?: string | null } };

export interface HelloAck {
  protocolVersion: number;
  daemonPid: number;
}

/** 编码一条出站消息（换行 JSON）。 */
export function encode(msg: unknown): string {
  return JSON.stringify(msg) + '\n';
}

/** 解析一行入站消息；非法 JSON 返回 null（忽略）。 */
export function decodeLine<T = unknown>(line: string): T | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}
