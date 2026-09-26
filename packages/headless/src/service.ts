/**
 * Headless 服务 API 面（Phase 4a）：壳（Electron / DSH / CLI / MCP）共用的操作入口。
 *
 * 行类型即契约；此层目前是 store 的类型化薄门面，后续可加编排/校验而不改壳。
 * 调度器（租约选主）与 store 分开持有：壳各自 createLeaseScheduler 嵌入。
 */
import type { AppilotStore } from './store.js';
import type { ProjectRow, RankSnapshotRow, TaskRow, ProjectMetaRow, ProductRecordRow, ReleaseCacheRow } from './schema.js';

export interface HeadlessService {
  projects: {
    /** 注册/更新（stamp updatedAt）。 */
    register(row: Omit<ProjectRow, 'updatedAt'>): void;
    list(): ProjectRow[];
    get(name: string): ProjectRow | undefined;
    remove(name: string): boolean;
  };
  snapshots: {
    /** 批量写入排名快照（追加历史）。 */
    record(rows: RankSnapshotRow[]): void;
    /** 每个 (keyword, language, storefront) 的最新一条；可按 productId 过滤。 */
    latest(projectName: string, productId?: string | null): RankSnapshotRow[];
    /** 最近时间序列点（降序），可按 productId/keyword 过滤。 */
    recent(
      projectName: string,
      opts?: { productId?: string | null; keyword?: string; limit?: number },
    ): RankSnapshotRow[];
    /**
     * 清理某项目早于 beforeIso 的旧快照；返回 { matched, removed, total }。
     * 破坏性命令防护（审计 H7）：before 必须 ISO 8601（字典序陷阱——传 "z"
     * 等字符串会删光全部快照）；未知项目抛错（不再静默 0）；dryRun 只预览；
     * 单次删除超过存量 50% 需显式 force:true。
     */
    prune(
      projectName: string,
      beforeIso: string,
      opts?: { dryRun?: boolean; force?: boolean },
    ): { matched: number; removed: number; total: number };
  };
  tasks: {
    list(): TaskRow[];
    /** 按 source 过滤任务行（'dsh' | 'electron' | 'cli'）。 */
    listBySource(source: string): TaskRow[];
    /**
     * rank 组进度（P5-2b：rounds 的 DB 表达——读时按 groupKey 聚合，不再需要
     * Electron 的 schedulerRounds 存储态）。每组 = product×platform×语言×商店
     * 下所有关键词实例；ok = 该组成功执行过的实例数。
     */
    rankProgress(opts?: { projectName?: string; productId?: string }): RankGroupProgress[];
  };
  /** v5 富数据：产品注册查询（rank 实例化 / UI / agent 只读）。 */
  products: {
    listByProject(projectName: string): ProductRecordRow[];
  };
  /** v5 富数据：repo 状态查询。 */
  meta: {
    get(projectName: string): ProjectMetaRow | undefined;
  };
  /** v6 富数据：发布页缓存（githubSyncCache 条目）。 */
  releaseCache: {
    get(projectName: string): ReleaseCacheRow | undefined;
  };
  /** 底层 store（调度器/租约等高级能力）。 */
  readonly store: AppilotStore;
}

/** rank 组进度行。 */
export interface RankGroupProgress {
  groupKey: string;
  projectName: string;
  productId: string;
  total: number;
  /** 成功跑过的实例数。 */
  ok: number;
  error: number;
  /** 未运行（never）。 */
  pending: number;
  lastRunAt: string | null;
}

export function createHeadlessService(store: AppilotStore): HeadlessService {
  return {
    projects: {
      register(row) {
        store.projects.save({ ...row, updatedAt: new Date().toISOString() });
      },
      list: () => store.projects.list(),
      get: (name) => store.projects.get(name),
      // 深删：CLI/MCP 删除项目必须与 Electron UI 删除同级联——tasks 表无外键，
      // 浅删（store.projects.remove）会留下引用已删项目的任务行，任务中心出现
      // 「已删除项目」幽灵任务（github-sync 等 legacy source 行连 reconcile 都
      // 不 prune，只能等启动兜底清理）。
      remove: (name) => store.projects.removeDeep(name),
    },
    snapshots: {
      record: (rows) => store.snapshots.add(rows),
      latest: (projectName, productId) =>
        store.snapshots.latestByKey(projectName, productId ?? undefined),
      recent: (projectName, opts) => store.snapshots.recent(projectName, opts),
      prune: (projectName, beforeIso, opts = {}) => {
        // 审计 H7：checkedAt 是 TEXT，prune 按字典序比较——非 ISO 字符串
        // （如 "z"）会删光项目全部快照且静默返回成功。入口先做格式强校验。
        if (
          !/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(
            String(beforeIso).trim(),
          )
        ) {
          throw new Error(
            `before 必须是 ISO 8601 时间（如 2026-01-01T00:00:00Z），收到："${String(beforeIso).slice(0, 40)}"`,
          );
        }
        const preview = store.snapshots.prunePreview(projectName, beforeIso);
        if (!preview) {
          throw new Error(`项目不存在：${projectName}`);
        }
        if (opts.dryRun) {
          return { matched: preview.matched, removed: 0, total: preview.total };
        }
        if (preview.total > 0 && preview.matched * 2 > preview.total && !opts.force) {
          throw new Error(
            `将删除 ${preview.matched}/${preview.total} 条快照（超过存量的 50%）。` +
              '如确认无误请传 force:true；建议先用 dryRun 预览影响面。',
          );
        }
        const removed = store.snapshots.pruneOlderThan(projectName, beforeIso);
        return { matched: preview.matched, removed, total: preview.total };
      },
    },
    tasks: {
      list: () => store.tasks.all(),
      listBySource: (source) => store.tasks.all().filter((t) => t.source === source),
      rankProgress: (opts = {}) => {
        const groups = new Map<string, RankGroupProgress>();
        for (const t of store.tasks.all()) {
          if (t.kind !== 'rank') continue;
          const inst = (t.instance ?? {}) as any;
          const projectName = String(inst.projectName ?? '');
          const productId = String(inst.productId ?? '');
          if (opts.projectName && projectName !== opts.projectName) continue;
          if (opts.productId && productId !== opts.productId) continue;
          const groupKey = String(inst.groupKey ?? `rank:${productId}:${t.title}`);
          let g = groups.get(groupKey);
          if (!g) {
            g = { groupKey, projectName, productId, total: 0, ok: 0, error: 0, pending: 0, lastRunAt: null };
            groups.set(groupKey, g);
          }
          g.total += 1;
          if (t.lastStatus === 'ok') g.ok += 1;
          else if (t.lastStatus === 'error') g.error += 1;
          else g.pending += 1;
          if (t.lastRunAt && (!g.lastRunAt || t.lastRunAt > g.lastRunAt)) g.lastRunAt = t.lastRunAt;
        }
        return [...groups.values()].sort((a, b) => a.groupKey.localeCompare(b.groupKey));
      },
    },
    products: {
      listByProject: (projectName) => store.products.listByProject(projectName),
    },
    meta: {
      get: (projectName) => store.meta.get(projectName),
    },
    releaseCache: {
      get: (projectName) => store.releaseCache.get(projectName),
    },
    store,
  };
}
