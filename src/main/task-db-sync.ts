/**
 * Electron 调度任务状态 → 共享 SQLite tasks 表镜像（Phase 4b 后半）。
 *
 * Electron 的动态任务（rank / github-sync / ops-sync / reviews-sync /
 * build-status，按产品×关键词拆分的数百个小任务）状态持久化在 electron-store
 * 的 'scheduledTasks'。这里把状态子集镜像进共享 DB tasks 表，使 DSH / CLI / MCP
 * （appilot-headless tasks list）能读到 Electron 的任务状态——任务真正执行仍由
 * Electron 自己的调度器跑（DB 任务行不会被 buildHeadlessJobs 的 dueJobs 误触发，
 * 因为 dueJobs 只遍历 headless 侧 job 定义）。
 *
 * 本模块不 import electron，纯映射可在 node 下单测。
 */
import type { AppilotStore, TaskRow } from '@appilot-labs/appilot-headless';

/** electron-store 'scheduledTasks' 里单个任务的最小形状。 */
export interface ElectronTaskLike {
  id?: unknown;
  kind?: unknown;
  keyword?: unknown;
  queryLanguage?: unknown;
  storefront?: unknown;
  title?: unknown;
  intervalMinutes?: unknown;
  lastRunAt?: unknown;
  nextRunAt?: unknown;
  executionCount?: unknown;
  lastStatus?: unknown;
  enabled?: unknown;
}

const KIND_LABELS: Record<string, string> = {
  rank: '排名采集',
  'github-sync': 'GitHub 发布同步',
  'ops-sync': '运营同步',
  'reviews-sync': '评价同步',
  'build-status': '构建状态',
};

function kindLabel(kind: unknown): string {
  return typeof kind === 'string' && KIND_LABELS[kind] ? KIND_LABELS[kind] : String(kind ?? '任务');
}

function taskTitle(t: ElectronTaskLike): string {
  if (typeof t.title === 'string' && t.title) return t.title;
  if (t.kind === 'rank') {
    const kw = typeof t.keyword === 'string' ? t.keyword : '?';
    const sf = typeof t.storefront === 'string' ? t.storefront : '?';
    const lang = typeof t.queryLanguage === 'string' ? t.queryLanguage : '?';
    return `${kindLabel(t.kind)}: ${kw} @ ${sf} (${lang})`;
  }
  return kindLabel(t.kind);
}

/** Electron 任务对象 → headless TaskRow；字段不合法返回 null（跳过）。 */
export function toTaskRow(t: ElectronTaskLike): TaskRow | null {
  if (!t || typeof t.id !== 'string' || !t.id) return null;
  if (typeof t.intervalMinutes !== 'number' || !Number.isFinite(t.intervalMinutes)) return null;
  const lastRunAt = typeof t.lastRunAt === 'string' ? t.lastRunAt : null;
  const lastStatus: TaskRow['lastStatus'] =
    t.lastStatus === 'failed'
      ? 'error'
      : lastRunAt
        ? 'ok'
        : 'never';
  const label = taskTitle(t);
  const disabled = t.enabled === false;
  return {
    id: t.id,
    title: disabled ? `${label}（已停用）` : label,
    intervalMinutes: t.intervalMinutes,
    lastRunAt,
    nextRunAt: typeof t.nextRunAt === 'string' ? t.nextRunAt : null,
    lastStatus,
    lastSummary: null,
    runCount: typeof t.executionCount === 'number' ? t.executionCount : 0,
  };
}

/**
 * 把 electron-store 的调度任务镜像进共享 DB tasks 表（upsert）。
 * 返回镜像的任务数。失败按调用方处理（此函数不做 try/catch）。
 */
export function mirrorTasksToDb(store: AppilotStore, tasks: ElectronTaskLike[]): number {
  let mirrored = 0;
  for (const t of tasks ?? []) {
    const row = toTaskRow(t);
    if (!row) continue;
    store.tasks.upsert(row);
    mirrored += 1;
  }
  return mirrored;
}
