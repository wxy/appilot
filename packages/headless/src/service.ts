/**
 * Headless 服务 API 面（Phase 4a）：壳（Electron / DSH / CLI / MCP）共用的操作入口。
 *
 * 行类型即契约；此层目前是 store 的类型化薄门面，后续可加编排/校验而不改壳。
 * 调度器（租约选主）与 store 分开持有：壳各自 createLeaseScheduler 嵌入。
 */
import type { AppilotStore } from './store.js';
import type { ProjectRow, RankSnapshotRow, TaskRow } from './schema.js';

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
  };
  tasks: {
    list(): TaskRow[];
  };
  /** 底层 store（调度器/租约等高级能力）。 */
  readonly store: AppilotStore;
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
    },
    tasks: { list: () => store.tasks.all() },
    store,
  };
}
