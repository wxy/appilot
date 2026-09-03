/**
 * 任务中心 DB 视图（最终要求：Electron 任务中心读共享 DB 的活动任务）。
 *
 * 把共享 DB 的任务实例行组装成 renderer TaskCenterPage 期望的结构
 * （与旧 electron-store scheduler:list 输出对齐：kind/lastStatus('success'|
 * 'failed')/executionCount/round{...}/projectName/productName/platform 等）。
 * - rank 实例：参数从 instance（productId/keyword/queryLanguage/storefront/
 *   groupKey/platform），projectId 由 productId 前缀推导（Electron projId 惯例）；
 * - round 进度 = DB rankProgress（读时计算，daemon 执行也反映）；
 * - 执行统计（executions/avgDuration/successRate 等）仍由调用方传 electron-store
 *   数据计算——本模块只负责「活动任务」本体。
 * 纯函数（不 import electron），可 node 单测。
 */
import type { AppilotStore, TaskRow } from '@appilot-labs/appilot-headless';
import { createHeadlessService } from '@appilot-labs/appilot-headless';

export interface TaskCenterTaskView {
  id: string;
  kind: string;
  title?: string | null;
  intervalMinutes: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  firstRunAt: string | null;
  lastStatus?: 'success' | 'failed';
  executionCount: number;
  enabled: boolean;
  projectId?: string | null;
  projectName?: string;
  productId?: string | null;
  productName?: string;
  platform?: string | null;
  keyword?: string;
  queryLanguage?: string;
  storefront?: string;
  groupKey?: string;
  round?: { done: number; total: number } | null;
}

function electronStatus(s: TaskRow['lastStatus']): 'success' | 'failed' | undefined {
  if (s === 'ok') return 'success';
  if (s === 'error') return 'failed';
  return undefined;
}

/** DB 任务行（+ 项目/产品上下文）→ renderer 视图行。 */
export function taskRowToView(
  row: TaskRow,
  store: AppilotStore,
  rankGroups: Map<string, { ok: number; total: number }>,
): TaskCenterTaskView {
  const inst = (row.instance ?? {}) as any;
  const view: TaskCenterTaskView = {
    id: row.id,
    kind: row.kind ?? 'unknown',
    intervalMinutes: row.intervalMinutes,
    nextRunAt: row.nextRunAt,
    lastRunAt: row.lastRunAt,
    firstRunAt: null, // DB 未记录首次执行（降级：列为 —）
    lastStatus: electronStatus(row.lastStatus),
    executionCount: row.runCount ?? 0,
    enabled: true,
    projectId: inst.projectId ?? null,
    productId: inst.productId ?? null,
    platform: inst.platform ?? null,
    groupKey: inst.groupKey ?? undefined,
    keyword: inst.keyword,
    queryLanguage: inst.queryLanguage,
    storefront: inst.storefront,
  };
  if (row.kind === 'rank' && view.productId) {
    // Electron productId 惯例 `${projId}:${platform}` → projectId = 前缀
    view.projectId = String(view.productId).split(':')[0] ?? null;
    view.projectName = inst.projectName ?? '已删除项目';
    const products = store.products.listByProject(view.projectName as string);
    const rec = products.find((p) => p.productId === view.productId);
    view.productName = rec?.trackName ?? (view.projectName as string) ?? '未知产品';
    view.platform = inst.platform ?? rec?.platform ?? null;
    if (inst.groupKey) {
      const g = rankGroups.get(String(inst.groupKey));
      if (g) view.round = { done: g.ok, total: g.total };
    }
  } else {
    view.projectName = inst.projectName ?? inst.projectId ?? '已删除项目';
    view.productName = inst.projectName ?? '';
  }
  return view;
}

/** 组装任务中心列表（DB 实例行 → renderer 视图数组，按 kind/产品分组友好排序）。 */
export function taskCenterTasksFromDb(store: AppilotStore): TaskCenterTaskView[] {
  const rows = store.tasks.all();
  const rankGroups = new Map<string, { ok: number; total: number }>();
  for (const g of createHeadlessService(store).tasks.rankProgress()) {
    rankGroups.set(g.groupKey, { ok: g.ok, total: g.total });
  }
  return rows
    .map((r) => taskRowToView(r, store, rankGroups))
    .sort((a, b) => (a.kind ?? '').localeCompare(b.kind ?? '') || a.id.localeCompare(b.id));
}

/** 任务中心概览计数（基于 DB 任务行）。 */
export function taskCenterOverviewFromDb(store: AppilotStore): {
  total: number;
  overdue: number;
  executed: number;
  nextDueAt: string | null;
  byKind: Record<string, number>;
} {
  const rows = store.tasks.all();
  const now = Date.now();
  const byKind: Record<string, number> = {};
  let overdue = 0;
  let executed = 0;
  let nextDueAt: string | null = null;
  for (const r of rows) {
    byKind[r.kind ?? 'unknown'] = (byKind[r.kind ?? 'unknown'] ?? 0) + 1;
    if (r.lastRunAt) executed += 1;
    if (r.nextRunAt) {
      const t = new Date(r.nextRunAt).getTime();
      if (t <= now) overdue += 1;
      if (!nextDueAt || t < new Date(nextDueAt).getTime()) nextDueAt = r.nextRunAt;
    }
  }
  return { total: rows.length, overdue, executed, nextDueAt, byKind };
}
