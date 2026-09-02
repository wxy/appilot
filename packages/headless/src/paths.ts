/**
 * Appilot headless 存储路径约定 + 旧版 JSON 注册表迁移。
 *
 * 单一 SQLite 数据库文件路径由本模块统一推导（两边壳共用同一约定），
 * 可用环境变量 APPILOT_DB_FILE 覆盖/重定向（测试用）。
 */
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync } from 'node:fs';
import type { ProjectRow } from './schema.js';

/** 共享 SQLite 数据库默认路径（与 Electron userData 同目录：appilot.db）。 */
export function defaultDbPath(): string {
  const env = process.env.APPILOT_DB_FILE;
  if (env) return env;
  const home = homedir();
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Appilot', 'appilot.db');
  }
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || join(home, 'AppData', 'Roaming');
    return join(base, 'Appilot', 'appilot.db');
  }
  const base = process.env.XDG_CONFIG_HOME || join(home, '.config');
  return join(base, 'Appilot', 'appilot.db');
}

/** 旧版 registry.json 路径（Phase 2 前的 JSON 注册表，仅用于一次性迁移）。 */
export function defaultLegacyRegistryPath(): string {
  const env = process.env.APPILOT_REGISTRY_FILE;
  if (env) return env;
  return join(dirname(defaultDbPath()), 'registry.json');
}

interface LegacyStoreLike {
  projects: {
    save(row: ProjectRow): void;
    list(): ProjectRow[];
  };
}

/**
 * 旧版 registry.json → SQLite 一次性迁移（幂等）：
 * DB projects 表为空且旧 JSON 存在时导入；返回导入条数（0 = 无迁移）。
 */
export function importLegacyRegistry(db: LegacyStoreLike, legacyJsonPath: string): number {
  if (db.projects.list().length > 0) return 0; // 已有数据不重复导入
  let records: any[] = [];
  try {
    const raw = readFileSync(legacyJsonPath, 'utf8');
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.projects)) records = data.projects;
  } catch {
    return 0; // 文件缺失/损坏 → 无迁移
  }
  let imported = 0;
  const now = new Date().toISOString();
  for (const r of records) {
    if (!r || typeof r.name !== 'string' || typeof r.path !== 'string') continue;
    db.projects.save({
      name: r.name,
      path: r.path,
      githubUrl: r.githubUrl ?? null,
      platform: r.platform ?? null,
      languages: Array.isArray(r.languages) ? r.languages.map(String) : [],
      lastResolvedAt: r.lastResolvedAt ?? now,
      artworkUrl: r.artworkUrl ?? null,
      updatedAt: r.updatedAt ?? r.lastResolvedAt ?? now,
    });
    imported += 1;
  }
  return imported;
}
