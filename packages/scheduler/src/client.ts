/**
 * daemon socket 客户端（壳/CLI 公共）：向运行中的 daemon 发一条请求并等响应。
 */
import { connect } from 'node:net';
import { createInterface } from 'node:readline';

export interface CommandResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** 向 daemon socket 发送请求（换行 JSON-RPC），等待 id 对应响应。 */
export function sendSchedulerCommand(
  socketPath: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 8000,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const socket = connect(socketPath);
    const rl = createInterface({ input: socket });
    let settled = false;
    const finish = (r: CommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'daemon 无响应（超时）' }), timeoutMs);
    socket.on('connect', () => {
      socket.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) + '\n');
    });
    rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.id === 1) {
          if (msg.error) finish({ ok: false, error: msg.error?.message ?? String(msg.error) });
          else finish({ ok: true, result: msg.result });
        }
      } catch {
        /* ignore */
      }
    });
    rl.on('error', () => finish({ ok: false, error: 'daemon 连接失败' }));
    socket.on('error', () => finish({ ok: false, error: 'daemon 未在运行（socket 不存在）' }));
  });
}
