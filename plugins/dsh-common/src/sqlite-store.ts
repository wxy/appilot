/**
 * SQLite 注册表存储适配器（Phase 2：单一 SQLite DB 取代 registry.json）。
 *
 * - 基于 @appilot-labs/appilot-headless 的 openStore（WAL/事务）；
 * - 首次打开时把旧版 registry.json 一次性导入（幂等）；
 * - 实现 ProjectStore 契约（save/list/get），供 dsh-project 工具使用。
 */
import { openStore, importLegacyRegistry, defaultDbPath, defaultLegacyRegistryPath } from '@appilot-labs/appilot-headless';
import type { ProjectRecord, ProjectStore } from './storage.js';

export interface SqliteStoreOptions {
  /** SQLite DB 路径（缺省用 headless 默认路径 / APPILOT_DB_FILE）。 */
  dbPath?: string;
  /** 旧版 registry.json 路径（缺省用约定路径；传 null 跳过迁移）。 */
  legacyJsonPath?: string | null;
}

export function sqliteProjectStore(opts: SqliteStoreOptions = {}): ProjectStore {
  const dbPath = opts.dbPath ?? process.env.APPILOT_DB_FILE ?? defaultDbPath();
  const store = openStore(dbPath);
  const legacy =
    opts.legacyJsonPath === null ? null : (opts.legacyJsonPath ?? defaultLegacyRegistryPath());
  if (legacy) {
    try {
      importLegacyRegistry(store, legacy);
    } catch {
      // 迁移失败不阻断（DB 仍可用）
    }
  }
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
