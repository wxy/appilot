#!/usr/bin/env node
/**
 * Appilot MCP server（stdio）— 把 headless 服务 API 暴露为标准 MCP 工具。
 *
 * 协议：MCP stdio transport = 换行分隔的 JSON-RPC 2.0 消息（每行一个 JSON）。
 * 支持 initialize / notifications/initialized / ping / tools/list / tools/call。
 * 工具直接对接共享 SQLite（headless service + 共享任务集），无壳依赖；
 * 供 Claude Desktop / Cursor / 任意 MCP 客户端调用。
 *
 * DB 路径：默认 defaultDbPath()；APPILOT_DB_FILE 覆盖。日志走 stderr（不污染协议流）。
 */
import { createInterface } from 'node:readline';
import { basename, resolve } from 'node:path';
import {
  buildHeadlessJobs,
  createHeadlessService,
  createLeaseScheduler,
  defaultDbPath,
  openStore,
  type ProjectRow,
} from '@appilot-labs/appilot-headless';
import type { HeadlessService } from '@appilot-labs/appilot-headless';

const PROTOCOL_VERSION = '2025-03-26';
const SERVER_INFO = { name: 'appilot-mcp', version: '0.1.0' };

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(args: Record<string, unknown>): Promise<unknown> | unknown;
}

function toolResult(value: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function toolError(message: string) {
  return {
    content: [{ type: 'text', text: `错误: ${message}` }],
    isError: true,
  };
}

/** 用共享任务集定义一个「立即运行」壳（不参与选主，仅显式触发）。 */
function createRunShell(store: ReturnType<typeof openStore>) {
  return createLeaseScheduler({
    store,
    leaderId: `mcp-run-${process.pid}`,
    jobs: buildHeadlessJobs({ readToken: (n) => Promise.resolve(process.env[n] ?? null) }),
    heartbeatMs: 60_000,
  });
}

async function serve(): Promise<void> {
  const dbPath = process.env.APPILOT_DB_FILE || defaultDbPath();
  const store = openStore(dbPath);
  const svc: HeadlessService = createHeadlessService(store);
  const runShell = createRunShell(store);

  const tools: McpTool[] = [
    {
      name: 'projects_list',
      description: '列出 Appilot 已注册项目（共享 SQLite 注册表）。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: () => svc.projects.list(),
    },
    {
      name: 'projects_get',
      description: '按名字获取单个项目记录。',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', description: '项目名' } },
        required: ['name'],
        additionalProperties: false,
      },
      execute: (a) => {
        const p = svc.projects.get(String(a.name ?? ''));
        if (!p) throw new Error(`项目未注册: ${a.name}`);
        return p;
      },
    },
    {
      name: 'projects_register',
      description: '注册/更新一个项目（登记路径与名字；name 缺省取路径 basename）。',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '项目本地绝对路径' },
          name: { type: 'string', description: '可选项目名' },
        },
        required: ['path'],
        additionalProperties: false,
      },
      execute: (a) => {
        const now = new Date().toISOString();
        const row: Omit<ProjectRow, 'updatedAt'> = {
          name: String(a.name ?? basename(String(a.path))),
          path: resolve(String(a.path)),
          githubUrl: null,
          platform: null,
          languages: [],
          lastResolvedAt: now,
          artworkUrl: null,
        };
        svc.projects.register(row);
        return svc.projects.get(row.name);
      },
    },
    {
      name: 'projects_remove',
      description: '从注册表移除一个项目。',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
      },
      execute: (a) => ({ removed: svc.projects.remove(String(a.name)) }),
    },
    {
      name: 'snapshots_latest',
      description: '某项目每个 (keyword, language, storefront) 的最新排名快照；可按 productId 过滤。',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          productId: { type: ['string', 'null'], description: '可选：产品维度（Electron 侧）' },
        },
        required: ['project'],
        additionalProperties: false,
      },
      execute: (a) => ({
        project: a.project,
        productId: a.productId ?? null,
        snapshots: svc.snapshots.latest(String(a.project), (a.productId as string | undefined) ?? null),
      }),
    },
    {
      name: 'snapshots_history',
      description: '某项目最近排名快照时间序列（checkedAt 降序）；可按 productId / keyword 过滤。',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          productId: { type: ['string', 'null'], description: '可选：产品维度（Electron 侧）' },
          keyword: { type: 'string', description: '可选：只看某关键词' },
          limit: { type: 'number', description: '最大点数（默认 200，最大 2000）' },
        },
        required: ['project'],
        additionalProperties: false,
      },
      execute: (a) => {
        const rows = svc.snapshots.recent(String(a.project), {
          productId: (a.productId as string | null) ?? null,
          keyword: (a.keyword as string | undefined) ?? undefined,
          limit: typeof a.limit === 'number' ? a.limit : undefined,
        });
        return { project: a.project, productId: a.productId ?? null, count: rows.length, snapshots: rows };
      },
    },
    {
      name: 'tasks_list',
      description: '列出共享定时任务定义与运行状态（interval / last run / next run / status）。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: () => {
        const definitions = buildHeadlessJobs({ readToken: () => null }).map((j) => ({
          id: j.id,
          title: j.title,
          intervalMinutes: j.intervalMinutes,
        }));
        return { tasks: svc.tasks.list(), definitions };
      },
    },
    {
      name: 'task_run',
      description: '立即运行一个共享任务（release-sync / readiness），同步等待结果。',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', enum: ['release-sync', 'readiness'] } },
        required: ['id'],
        additionalProperties: false,
      },
      execute: async (a) => {
        const result = await runShell.runNow(String(a.id));
        if (!result) throw new Error(`未知任务: ${a.id}`);
        return result;
      },
    },
  ];

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const send = (msg: unknown) => {
    process.stdout.write(JSON.stringify(msg) + '\n');
  };

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: any;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return; // 非法行忽略（协议要求严格 JSON）
    }
    if (msg.jsonrpc !== '2.0') return;

    const respond = (result?: unknown, error?: { code: number; message: string }) => {
      if (msg.id === undefined) return; // notification
      const out: any = { jsonrpc: '2.0', id: msg.id };
      if (error) out.error = error;
      else out.result = result;
      send(out);
    };

    try {
      switch (msg.method) {
        case 'initialize':
          respond({
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
          });
          return;
        case 'notifications/initialized':
        case 'notifications/cancelled':
          return; // 无需回复
        case 'ping':
          respond({});
          return;
        case 'tools/list':
          respond({
            tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
          });
          return;
        case 'tools/call': {
          const { name, arguments: args } = msg.params ?? {};
          const tool = tools.find((t) => t.name === name);
          if (!tool) {
            respond(undefined, { code: -32601, message: `未知工具: ${name}` });
            return;
          }
          try {
            const value = await tool.execute(args ?? {});
            respond(toolResult(value));
          } catch (err: any) {
            respond(toolError(err?.message ?? String(err)));
          }
          return;
        }
        default:
          respond(undefined, { code: -32601, message: `未知方法: ${msg.method}` });
      }
    } catch (err: any) {
      respond(undefined, { code: -32603, message: `内部错误: ${err?.message ?? err}` });
    }
  });

  rl.on('close', () => {
    try {
      runShell.dispose();
    } catch {
      /* ignore */
    }
    try {
      store.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  });
}

serve().catch((err: any) => {
  process.stderr.write(`appilot-mcp 启动失败: ${err?.message ?? err}\n`);
  process.exit(1);
});
