/**
 * 本地 socket 服务：壳连接（hello/ping/runNow/bye）+ 任务事件推送。
 * 用 node:net Unix socket；Windows 走 named pipe 路径（\\\\.\\pipe\\...）。
 */
import { createServer, type Socket } from 'node:net';
import { createInterface } from 'node:readline';
import type { ClientRequest, ServerMessage } from './protocol.js';
import { decodeLine, encode } from './protocol.js';

export interface ServerHandlers {
  /** hello：记录客户端并返回 ack。 */
  onHello(client: { client: string; pid: number }): { protocolVersion: number; daemonPid: number };
  /** 显式运行任务；返回任务行或错误。 */
  onRunNow(taskId: string): Promise<unknown>;
  /** accelerate：开/关加速（催快积压）。 */
  onAccelerate?(on: boolean, seconds?: number): void;
  /** shutdown：让 daemon 优雅退出（reply 后调用方自会关闭进程）。 */
  onShutdown?(): void;
  /** 记录日志。 */
  log(msg: string): void;
}

export interface SchedulerServer {
  start(): Promise<void>;
  /** 向所有已连接客户端广播任务事件。 */
  broadcast(msg: { method: 'notify:task-started' | 'notify:task-finished'; params: Record<string, unknown> }): void;
  /** 当前连接数（心跳判定用）。 */
  clientCount(): number;
  close(): Promise<void>;
}

export function createSchedulerServer(socketPath: string, handlers: ServerHandlers): SchedulerServer {
  const log = handlers.log;
  const clients = new Set<Socket>();

  const server = createServer((socket) => {
    clients.add(socket);
    const rl = createInterface({ input: socket, crlfDelay: Infinity });
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));

    const send = (msg: unknown) => {
      if (!socket.destroyed) socket.write(encode(msg));
    };

    rl.on('line', (line) => {
      const msg = decodeLine<ClientRequest & { id?: number; jsonrpc?: string }>(line);
      if (!msg) return;
      const reply = (result?: unknown, error?: { code: number; message: string }) => {
        if (msg.id === undefined) return; // notification
        send({ jsonrpc: '2.0', id: msg.id, ...(error ? { error } : { result }) });
      };
      switch (msg.method) {
        case 'hello':
          try {
            const ack = handlers.onHello({ client: String(msg.params?.client ?? 'unknown'), pid: Number(msg.params?.pid ?? 0) });
            reply({ ok: true, ...ack });
          } catch (err: any) {
            reply(undefined, { code: -32603, message: err?.message || String(err) });
          }
          break;
        case 'ping':
          reply({ ok: true, ts: new Date().toISOString() });
          break;
        case 'runNow': {
          const id = String(msg.params?.taskId ?? '');
          handlers
            .onRunNow(id)
            .then((result) => reply({ taskId: id, result }))
            .catch((err: any) => reply(undefined, { code: -32000, message: err?.message || String(err) }));
          break;
        }
        case 'accelerate':
          handlers.onAccelerate?.(msg.params?.on === true, Number(msg.params?.seconds ?? 0) || undefined);
          reply({ ok: true });
          break;
        case 'shutdown':
          reply({ ok: true });
          // 延迟一拍，确保响应已写出再让调用方退出进程。
          setTimeout(() => handlers.onShutdown?.(), 50);
          break;
        case 'bye':
          socket.end();
          break;
        default:
          reply(undefined, { code: -32601, message: `未知方法: ${(msg as { method?: string }).method ?? "?"}` });
      }
    });
  });

  return {
    start(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(socketPath, () => {
          server.removeListener('error', reject);
          log(`scheduler socket listening at ${socketPath}`);
          resolve();
        });
      });
    },
    broadcast(msg) {
      const out = { jsonrpc: '2.0', ...msg };
      for (const socket of clients) {
        if (!socket.destroyed) socket.write(encode(out));
      }
    },
    clientCount() {
      return clients.size;
    },
    close(): Promise<void> {
      return new Promise((resolve) => {
        for (const socket of clients) socket.destroy();
        server.close(() => resolve());
      });
    },
  };
}
