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
  round?: {
    done: number;
    total: number;
    /** 上轮完成时间（引擎 schedulerRounds 状态；无 = 尚无完整轮次）。 */
    lastCompletedAt?: string | null;
    /** 本轮开始时间（引擎 schedulerRounds 状态）。 */
    roundStartedAt?: string | null;
  } | null;
}

interface TaskExecutionFacts {
  firstRunAt: string;
  lastRunAt: string;
  count: number;
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

/** 无损 electronJson → 对象（解析失败/缺失返回 null）。 */
function parseElectron(row: TaskRow): any | null {
  if (!row.electronJson) return null;
  try {
    const e = JSON.parse(row.electronJson);
    return e && typeof e === 'object' ? e : null;
  } catch {
    return null;
  }
}

/**
 * DB 任务行（+ 项目/产品上下文）→ renderer 视图行。
 *
 * 字段解析优先级：instance 参数 → 无损 electronJson → 注册表/产品索引反查 →
 * 执行记录最早时间（firstRunAt 兜底）。Electron ops/reviews/build-status 镜像行
 * 的 instance 为空，只有 electronJson 带 projectId/productId——此前归项目全靠
 * instance.projectName，缺了就显示「已删除项目」（实际项目仍存活）。现在先按
 * projectId 查注册表（projNames: 项目 id 与名称 → 显示名），再回退 instance。
 */
export function taskRowToView(
  row: TaskRow,
  rankGroups: Map<string, { ok: number; total: number }>,
  products?: Map<string, { projectName: string; trackName: string | null; platform: string | null }>,
  projNames?: Map<string, string>,
  executionFacts?: Map<string, TaskExecutionFacts>,
  roundsByGroup?: Map<string, { done: number; total: number; lastCompletedAt: string | null; roundStartedAt: string | null }>,
): TaskCenterTaskView {
  const inst = (row.instance ?? {}) as any;
  const electron = parseElectron(row);
  const kind =
    row.kind ??
    inferKindFromId(row.id) ??
    (typeof electron?.kind === 'string' ? electron.kind : null) ??
    'unknown';
  const productId = String(inst.productId ?? electron?.productId ?? '') || null;
  // Electron productId 惯例 `${projId}:${platform}` → projectId = 前缀
  const projectId0 = inst.projectId ?? electron?.projectId ?? (productId ? productId.split(':')[0] : null);
  const projectId = projectId0 ? String(projectId0) : null;
  const platform =
    inst.platform ??
    (electron && typeof electron.platform === 'string' ? electron.platform : null) ??
    (productId && productId.includes(':') ? productId.split(':').slice(1).join(':') : null);
  const electronFirst = electron && typeof electron.firstRunAt === 'string' && electron.firstRunAt ? electron.firstRunAt : null;
  const instFirst = typeof inst.firstRunAt === 'string' && inst.firstRunAt ? inst.firstRunAt : null;
  // DB 任务行未记首次：electronJson/instance 有就用，否则用最早可追溯执行时间。
  const facts = executionFacts?.get(row.id);
  const firstRunAt = electronFirst ?? instFirst ?? facts?.firstRunAt ?? null;
  const rowLastRunAt = row.lastRunAt ?? (electron && typeof electron.lastRunAt === 'string' ? electron.lastRunAt : null);
  // 执行表是不可变事实来源：任务行可能在 reconcile/清除失败后丢失运行字段。
  // 这里只补展示时间和次数，不从历史恢复 lastStatus，避免已清除的失败重新标红。
  const lastRunAt = [rowLastRunAt, facts?.lastRunAt]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .sort()
    .at(-1) ?? null;
  const executionCount = Math.max(row.runCount ?? 0, facts?.count ?? 0);
  const groupKey = inst.groupKey ?? electron?.groupKey ?? undefined;
  const view: TaskCenterTaskView = {
    id: row.id,
    kind,
    title: row.title ?? null,
    intervalMinutes: row.intervalMinutes,
    nextRunAt: row.nextRunAt,
    lastRunAt,
    firstRunAt,
    lastStatus: electronStatus(row.lastStatus),
    executionCount,
    enabled: true,
    projectId,
    productId,
    platform,
    groupKey,
    keyword: inst.keyword ?? electron?.keyword,
    queryLanguage: inst.queryLanguage ?? electron?.queryLanguage,
    storefront: inst.storefront ?? electron?.storefront,
  };
  const ctx = productId ? products?.get(productId) : undefined;
  // 项目归属：产品索引 → 注册表（id/名称）→ instance.projectName → electron → 兜底
  let projectName: string | undefined;
  if (ctx?.projectName) projectName = ctx.projectName;
  else if (projectId && projNames?.has(projectId)) projectName = projNames.get(projectId);
  else if (typeof inst.projectName === 'string' && inst.projectName) projectName = inst.projectName;
  else if (electron && typeof electron.projectName === 'string' && electron.projectName) projectName = electron.projectName;
  view.projectName = projectName ?? '已删除项目';
  const instName: string | undefined =
    typeof inst.projectName === 'string' && inst.projectName
      ? inst.projectName
      : electron && typeof electron.projectName === 'string' && electron.projectName
        ? electron.projectName
        : undefined;
  if (kind === 'rank') {
    if (!view.platform && ctx?.platform) view.platform = ctx.platform;
    view.productName = ctx ? ctx.trackName ?? ctx.projectName : instName ?? '未知产品';
    if (groupKey) {
      // 引擎轮次状态优先（真实本轮进度 + 上轮完成时间）；无该组状态时回退
      // rankProgress（DB 执行聚合：ok = 成功执行过的实例数，无轮次语义）。
      const kv = roundsByGroup?.get(String(groupKey));
      if (kv && kv.total > 0) {
        view.round = {
          done: kv.done,
          total: kv.total,
          lastCompletedAt: kv.lastCompletedAt,
          roundStartedAt: kv.roundStartedAt,
        };
      } else {
        const g = rankGroups.get(String(groupKey));
        if (g) view.round = { done: g.ok, total: g.total };
      }
    }
  } else {
    view.productName = ctx ? ctx.trackName ?? ctx.projectName : instName ?? '';
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
  // 注册表索引（项目 id 与名称 → 显示名）：instance 为空的 Electron 镜像行按
  // electronJson.projectId 归项目，而非一律显示「已删除项目」。
  const projNames = new Map<string, string>();
  for (const p of store.projects.list()) {
    projNames.set(p.name, p.name);
    if (p.id) projNames.set(p.id, p.name);
  }
  // 执行事实兜底：任务对象/instance 未记运行字段时，从不可变执行表恢复
  // 首次/最近执行时间与次数。状态刻意不恢复，避免“清除失败”后重新标红。
  const executionFacts = new Map<string, TaskExecutionFacts>();
  try {
    for (const summary of store.executions.summaryByTask()) {
      if (!summary.taskId || !summary.firstRunAt || !summary.lastRunAt) continue;
      executionFacts.set(summary.taskId, {
        firstRunAt: summary.firstRunAt,
        lastRunAt: summary.lastRunAt,
        count: summary.count,
      });
    }
  } catch {
    // 执行表不可用时忽略历史兜底（仅影响展示）。
  }
  // 引擎轮次状态（kv schedulerRounds，app_kv 落地，迁移前历史已保留）：本轮
  // done/members + 上轮完成时间。只在任务中心展示——调度仍由引擎自己维护。
  const roundsByGroup = new Map<string, { done: number; total: number; lastCompletedAt: string | null; roundStartedAt: string | null }>();
  try {
    const raw = store.kv.get('schedulerRounds');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const [gk, st] of Object.entries(parsed as Record<string, any>)) {
          if (!st || !Array.isArray(st.members)) continue;
          roundsByGroup.set(gk, {
            done: Array.isArray(st.done) ? st.done.length : 0,
            total: st.members.length,
            lastCompletedAt: typeof st.lastCompletedAt === 'string' ? st.lastCompletedAt : null,
            roundStartedAt: typeof st.roundStartedAt === 'string' ? st.roundStartedAt : null,
          });
        }
      }
    }
  } catch {
    // kv 状态缺失/损坏时忽略（各列回退 rankProgress/—）。
  }
  return rows
    .map((r) => taskRowToView(r, rankGroups, products, projNames, executionFacts, roundsByGroup))
    .sort((a, b) => (a.kind ?? '').localeCompare(b.kind ?? '') || a.id.localeCompare(b.id));
}

/** 任务中心概览计数（基于 DB 任务行）。 */
export function taskCenterOverviewFromDb(store: AppilotStore, taskViews?: TaskCenterTaskView[]): {
  total: number;
  overdue: number;
  executed: number;
  nextDueAt: string | null;
  byKind: Record<string, number>;
} {
  const rows = taskViews ?? taskCenterTasksFromDb(store);
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
