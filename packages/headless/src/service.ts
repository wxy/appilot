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
    /** 清理某项目早于 beforeIso 的旧快照；返回删除行数。 */
    prune(projectName: string, beforeIso: string): number;
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
      remove: (name) => store.projects.remove(name),
    },
    snapshots: {
      record: (rows) => store.snapshots.add(rows),
      latest: (projectName, productId) =>
        store.snapshots.latestByKey(projectName, productId ?? undefined),
      recent: (projectName, opts) => store.snapshots.recent(projectName, opts),
      prune: (projectName, beforeIso) => store.snapshots.pruneOlderThan(projectName, beforeIso),
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
