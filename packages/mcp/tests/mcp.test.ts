/**
 * MCP server 端到端测试：spawn 真实进程，按 MCP stdio 协议（换行分隔 JSON-RPC）
 * 走 initialize → tools/list → tools/call（register → list → run），验证输出。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert';
import { createInterface } from 'node:readline';
import { once } from 'node:events';

const BIN = join(__dirname, '..', 'dist', 'mcp.js');
const dbPath = join(mkdtempSync(join(tmpdir(), 'appilot-mcp-test-')), 'appilot.db');

interface JsonRpc { id?: number; jsonrpc: string; method?: string; result?: any; error?: any }

function startServer(): { child: ChildProcess; send: (msg: object) => Promise<JsonRpc>; close: () => Promise<void> } {
  const child = spawn(process.execPath, [BIN], {
    env: { ...process.env, APPILOT_DB_FILE: dbPath },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stderr: string[] = [];
  child.stderr!.on('data', (d) => stderr.push(String(d)));
  const rl = createInterface({ input: child.stdout! });
  const pending = new Map<number, (m: JsonRpc) => void>();
  let nextId = 1;
  rl.on('line', (line) => {
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)!(msg);
        pending.delete(msg.id);
      }
    } catch {
      /* ignore non-JSON lines */
    }
  });
  return {
    child,
    send(msg) {
      const id = nextId++;
      return new Promise<JsonRpc>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`MCP 请求超时 (id=${id}, stderr=${stderr.join('')})`)), 15_000);
        pending.set(id, (m) => {
          clearTimeout(t);
          resolve(m);
        });
        child.stdin!.write(JSON.stringify({ ...msg, id }) + '\n');
      });
    },
    close() {
      child.stdin!.end();
      return once(child, 'exit').then(() => undefined);
    },
  };
}

async function main(): Promise<void> {
  const s = startServer();

  // 1. initialize
  const init = await s.send({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0.0.0' } } });
  assert.equal(init.result?.serverInfo?.name, 'appilot-mcp', 'serverInfo.name');
  assert.ok(init.result?.capabilities?.tools, 'tools capability');
  console.log('✓ initialize');

  // 2. tools/list
  const list = await s.send({ jsonrpc: '2.0', method: 'tools/list', params: {} });
  const names = (list.result?.tools ?? []).map((t: any) => t.name);
  assert.ok(names.includes('projects_list') && names.includes('projects_register') && names.includes('task_run'), `工具集: ${names.join(',')}`);
  console.log(`✓ tools/list (${names.length} tools)`);

  // 3. tools/call projects_register
  const reg = await s.send({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { name: 'projects_register', arguments: { path: '/tmp', name: 'mcp-test-proj' } },
  });
  const regText = reg.result?.content?.[0]?.text ?? '';
  assert.ok(regText.includes('mcp-test-proj'), `register 结果: ${regText}`);
  console.log('✓ projects_register');

  // 4. tools/call projects_list（跨调用持久化验证）
  const lst = await s.send({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'projects_list', arguments: {} } });
  const lstText = lst.result?.content?.[0]?.text ?? '';
  assert.ok(lstText.includes('mcp-test-proj'), `list 应含新项目: ${lstText}`);
  console.log('✓ projects_list');

  // 5. tools/call task_run（release-sync：DB 有项目，走 git 本地逻辑）
  const run = await s.send({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'task_run', arguments: { id: 'readiness' } } });
  const runText = run.result?.content?.[0]?.text ?? '';
  assert.ok(runText.includes('mcp-test-proj'), `run 结果应含项目名: ${runText}`);
  console.log('✓ task_run (readiness)');

  // 6. 错误路径：未知工具
  const bad = await s.send({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'nope', arguments: {} } });
  assert.equal(bad.error?.code, -32601, '未知工具应报 -32601');
  console.log('✓ 未知工具错误');

  await s.close();
  console.log('MCP 端到端测试全部通过 ✓');
}

main().catch((err) => {
  console.error('MCP 测试失败:', err);
  process.exit(1);
});
