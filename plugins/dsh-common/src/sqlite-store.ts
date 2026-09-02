/**
 * SQLite 注册表存储适配器（Phase 2/3：单一 SQLite DB 共享给注册表与调度器）。
 *
 * - 进程内**共享单一 AppilotStore 实例**（openSharedHeadlessStore 模块级缓存）：
 *   注册表（projects）、调度器（tasks/lease）用同一连接/同一 DB 文件；
 * - 首次打开时把旧版 registry.json 一次性导入（幂等）；
 * - sqliteProjectStore 实现 ProjectStore 契约（save/list/get），供 dsh-project 工具使用。
 */
import {
  openStore,
  importLegacyRegistry,
  defaultDbPath,
  defaultLegacyRegistryPath,
  type AppilotStore,
} from '@appilot-labs/appilot-headless';
import type { ProjectRecord, ProjectStore } from './storage.js';

export interface SqliteStoreOptions {
  /** SQLite DB 路径（缺省用 headless 默认路径 / APPILOT_DB_FILE）。 */
  dbPath?: string;
  /** 旧版 registry.json 路径（缺省用约定路径；传 null 跳过迁移）。 */
  legacyJsonPath?: string | null;
}

let sharedStore: AppilotStore | null = null;

/** 打开（并缓存）进程内共享的 headless store——注册表、调度器等共用同一 DB。 */
export function openSharedHeadlessStore(opts: SqliteStoreOptions = {}): AppilotStore {
  if (sharedStore) return sharedStore;
  const dbPath = opts.dbPath ?? process.env.APPILOT_DB_FILE ?? defaultDbPath();
  sharedStore = openStore(dbPath);
  const legacy =
    opts.legacyJsonPath === null ? null : (opts.legacyJsonPath ?? defaultLegacyRegistryPath());
  if (legacy) {
    try {
      importLegacyRegistry(sharedStore, legacy);
    } catch {
      // 迁移失败不阻断（DB 仍可用）
    }
  }
  return sharedStore;
}

export function sqliteProjectStore(opts: SqliteStoreOptions = {}): ProjectStore {
  const store = openSharedHeadlessStore(opts);
  const strip = ({ updatedAt: _u, ...rec }: any): ProjectRecord => rec;
  return {
    async save(record) {
      store.projects.save({
        name: record.name,
        path: record.path,
        githubUrl: record.githubUrl,
        platform: record.platform,
        languages: record.languages,
        lastResolvedAt: record.lastResolvedAt,
        artworkUrl: record.artworkUrl ?? null,
        updatedAt: new Date().toISOString(),
      });
    },
    async list() {
      return store.projects.list().map(strip);
    },
    async get(name) {
      const rec = store.projects.get(name);
      return rec ? strip(rec) : undefined;
    },
  };
}
