/**
 * Appilot 定时任务（任务中心服务端）。
 *
 * - 使用宿主 timer 服务（dsh-base 自带 cordis-plugin-timer）的 ctx.interval；
 * - 任务直接运行 core 函数（确定性 API 调用，不经过模型、不花 token）；
 * - 运行状态（last/next run、status、summary）持久化到 tasks.json（与注册表同目录，
 *   原子写），经 appilot_tasks 工具读给 agent/前端。
 *
 * 说明：任务只在 dsh 服务运行期间生效（Electron 桌面应用同理——不打开就没有调度）。
 */
import { dirname, join } from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { defineTool } from '@deepseek-ai/dsh-tools';
import {
  jsonify,
  defaultRegistryPath,
  type CredentialReader,
  type ProjectStore,
} from '@appilot-labs/appilot-common';
import { listGitTags } from '@appilot-labs/appilot-core/release-watcher';
import { listGitHubReleases } from '@appilot-labs/appilot-core/github-api';
import { detectLocalizedLanguages } from '@appilot-labs/appilot-core/app-store-discovery';
import { runReadinessChecks } from '@appilot-labs/appilot-core/readiness-check';

/** 任务运行状态（对 agent/前端可见的只读快照）。 */
export interface TaskState {
  id: string;
  title: string;
  intervalMinutes: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: 'never' | 'ok' | 'error';
  lastSummary: string | null;
  runCount: number;
}

interface PersistedTask {
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: 'never' | 'ok' | 'error';
  lastSummary: string | null;
  runCount: number;
}

/** 任务定义：id / 标题 / 间隔 / 执行函数（返回摘要文本）。 */
interface TaskDefinition {
  id: string;
  title: string;
  intervalMinutes: number;
  run(store: ProjectStore, reader: CredentialReader): Promise<string>;
}

export function tasksFilePath(): string {
  const env = process.env.APPILOT_REGISTRY_FILE;
  const dir = env ? dirname(env) : dirname(defaultRegistryPath());
  return join(dir, 'tasks.json');
}

/* ── 状态持久化（原子写）── */

async function readPersisted(filePath: string): Promise<Record<string, PersistedTask>> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !data.tasks) return {};
    return data.tasks as Record<string, PersistedTask>;
  } catch {
    return {};
  }
}

let writeChain: Promise<unknown> = Promise.resolve();
async function writePersisted(
  filePath: string,
  tasks: Record<string, PersistedTask>,
): Promise<void> {
  const run = writeChain.then(async () => {
    const payload = JSON.stringify({ version: 1, tasks }, null, 2);
    await mkdir(dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    await writeFile(tmp, payload, 'utf8');
    await rename(tmp, filePath);
  });
  writeChain = run.catch(() => {});
  await run;
}

/* ── 任务定义 ── */

const releaseSync: TaskDefinition = {
  id: 'release-sync',
  title: '发布同步（git tags + GitHub releases）',
  intervalMinutes: 60,
  async run(store, reader) {
    const token = (await reader('GITHUB_TOKEN')) || null;
    const projects = await store.list();
    if (projects.length === 0) return '无已注册项目';
    const parts: string[] = [];
    for (const p of projects) {
      try {
        const tags = await listGitTags(p.path);
        const releases = await listGitHubReleases(p.path, token);
        const drafts = releases.filter((r) => r.draft).length;
        parts.push(
          `${p.name}: tag=${tags[0]?.name ?? '无'} · GitHub 发布 ${releases.length}（草稿 ${drafts}）`,
        );
      } catch (err: any) {
        parts.push(`${p.name}: 失败 ${err.message}`);
      }
    }
    return parts.join('；');
  },
};

const readinessCheck: TaskDefinition = {
  id: 'readiness',
  title: '发布准备度检查',
  intervalMinutes: 24 * 60,
  async run(store) {
    const projects = await store.list();
    if (projects.length === 0) return '无已注册项目';
    const parts: string[] = [];
    for (const p of projects) {
      try {
        const languages = detectLocalizedLanguages(p.path);
        const checks = runReadinessChecks({
          localizations: [],
          supportedLanguages: languages,
          versionTag: '',
          ascVersion: null,
          buildAttached: false,
        });
        const pass = checks.filter((c) => c.status === 'pass').length;
        const warn = checks.filter((c) => c.status === 'warning').length;
        const fail = checks.filter((c) => c.status === 'fail').length;
        parts.push(`${p.name}: 通过 ${pass} / 警告 ${warn} / 失败 ${fail}`);
      } catch (err: any) {
        parts.push(`${p.name}: 失败 ${err.message}`);
      }
    }
    return parts.join('；');
  },
};

const DEFINITIONS: TaskDefinition[] = [releaseSync, readinessCheck];

/* ── 调度器 ── */

export interface TaskScheduler {
  /** 当前任务快照（含运行状态）。 */
  snapshot(): TaskState[];
  /** 立即运行一个任务（供工具/调试）。 */
  runNow(id: string): Promise<TaskState | null>;
}

export function createTaskScheduler(
  ctx: any,
  store: ProjectStore,
  reader: CredentialReader,
  filePath: string = tasksFilePath(),
): TaskScheduler {
  const persisted = new Map<string, PersistedTask>();
  void readPersisted(filePath).then((data) => {
    for (const [id, v] of Object.entries(data)) persisted.set(id, v);
  });

  async function runTask(def: TaskDefinition): Promise<void> {
    let next: PersistedTask;
    const started = new Date().toISOString();
    try {
      const summary = await def.run(store, reader);
      next = {
        lastRunAt: started,
        nextRunAt: new Date(Date.now() + def.intervalMinutes * 60_000).toISOString(),
        lastStatus: 'ok',
        lastSummary: summary,
        runCount: (persisted.get(def.id)?.runCount ?? 0) + 1,
      };
    } catch (err: any) {
      next = {
        lastRunAt: started,
        nextRunAt: new Date(Date.now() + def.intervalMinutes * 60_000).toISOString(),
        lastStatus: 'error',
        lastSummary: err instanceof Error ? err.message : String(err),
        runCount: (persisted.get(def.id)?.runCount ?? 0) + 1,
      };
    }
    persisted.set(def.id, next);
    await writePersisted(filePath, Object.fromEntries(persisted));
  }

  // 注册 interval（宿主 timer 服务；缺失时跳过调度但保留工具可读）。
  const timer = ctx.get?.('timer') as { interval?: (fn: () => void, ms: number) => unknown } | undefined;
  for (const def of DEFINITIONS) {
    if (timer?.interval) {
      timer.interval(() => void runTask(def), def.intervalMinutes * 60_000);
    }
  }
  // 启动即跑一次（先有数据，不必等一个周期）。
  for (const def of DEFINITIONS) {
    void runTask(def);
  }

  return {
    snapshot() {
      return DEFINITIONS.map((def) => {
        const p = persisted.get(def.id);
        return {
          id: def.id,
          title: def.title,
          intervalMinutes: def.intervalMinutes,
          lastRunAt: p?.lastRunAt ?? null,
          nextRunAt: p?.nextRunAt ?? null,
          lastStatus: p?.lastStatus ?? 'never',
          lastSummary: p?.lastSummary ?? null,
          runCount: p?.runCount ?? 0,
        };
      });
    },
    async runNow(id) {
      const def = DEFINITIONS.find((d) => d.id === id);
      if (!def) return null;
      await runTask(def);
      return this.snapshot().find((s) => s.id === id) ?? null;
    },
  };
}

/** appilot_tasks 状态工具：列出任务定义与运行状态（agent/前端读取）。 */
export function createTasksStatusTool(scheduler: TaskScheduler) {
  return defineTool({
    name: 'appilot_tasks',
    description:
      'List Appilot scheduled tasks and their state: interval, last run, next run, last status and summary. Tasks run server-side on a timer while the dsh server is running.',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [
        { type: 'text', text: JSON.stringify(value, null, 2) },
      ],
    },
    async execute() {
      return jsonify({ tasks: scheduler.snapshot() });
    },
  });
}
