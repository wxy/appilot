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

/** 旧镜像行（kind null）按 id 前缀推断类型（ops-sync:/reviews-sync:/build-status:/github-sync:）。 */
export function inferKindFromId(id: string): string | null {
  for (const k of ['ops-sync', 'reviews-sync', 'build-status', 'github-sync', 'rank']) {
    if (id.startsWith(k + ':')) return k;
  }
  return null;
}

/** productId → { projectName, trackName, platform } 索引（DB products 反查，不依赖 instance.projectName）。 */
export function productIndex(store: AppilotStore): Map<string, { projectName: string; trackName: string | null; platform: string | null }> {
  const idx = new Map<string, { projectName: string; trackName: string | null; platform: string | null }>();
  for (const p of store.projects.list()) {
    for (const rec of store.products.listByProject(p.name)) {
      idx.set(rec.productId, { projectName: p.name, trackName: rec.trackName, platform: rec.platform });
    }
  }
  return idx;
}

/** DB 任务行（+ 项目/产品上下文）→ renderer 视图行。 */
export function taskRowToView(
  row: TaskRow,
  rankGroups: Map<string, { ok: number; total: number }>,
  products?: Map<string, { projectName: string; trackName: string | null; platform: string | null }>,
): TaskCenterTaskView {
  const inst = (row.instance ?? {}) as any;
  const kind = row.kind ?? inferKindFromId(row.id) ?? 'unknown';
  const view: TaskCenterTaskView = {
    id: row.id,
    kind,
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
  if (kind === 'rank' && view.productId) {
    // Electron productId 惯例 `${projId}:${platform}` → projectId = 前缀
    view.projectId = String(view.productId).split(':')[0] ?? null;
    const ctx = products?.get(String(view.productId));
    if (ctx) {
      view.projectName = ctx.projectName;
      view.platform = inst.platform ?? ctx.platform ?? null;
      view.productName = ctx.trackName ?? ctx.projectName;
    } else {
      view.projectName = inst.projectName ?? '已删除项目';
      view.productName = inst.projectName ?? '未知产品';
    }
    if (inst.groupKey) {
      const g = rankGroups.get(String(inst.groupKey));
      if (g) view.round = { done: g.ok, total: g.total };
    }
  } else {
    view.projectName = inst.projectName ?? '已删除项目';
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
  const products = productIndex(store);
  return rows
    .map((r) => taskRowToView(r, rankGroups, products))
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
    const k = r.kind ?? inferKindFromId(r.id) ?? 'unknown';
    byKind[k] = (byKind[k] ?? 0) + 1;
    if (r.lastRunAt) executed += 1;
    if (r.nextRunAt) {
      const t = new Date(r.nextRunAt).getTime();
      if (t <= now) overdue += 1;
      if (!nextDueAt || t < new Date(nextDueAt).getTime()) nextDueAt = r.nextRunAt;
    }
  }
  return { total: rows.length, overdue, executed, nextDueAt, byKind };
}
