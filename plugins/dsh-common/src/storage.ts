import { z } from 'zod';
import type { Context } from '@deepseek-ai/cordis';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { basename } from 'node:path';
import { collectRepoInfo } from '@appilot-labs/appilot-core/git-info';
import {
  detectApplePlatform,
  detectLocalizedLanguages,
} from '@appilot-labs/appilot-core/app-store-discovery';
import { defaultRegistryPath } from './registry-file.js';
import { sqliteProjectStore } from './sqlite-store.js';

/** 注册过的项目记录（持久化的最小快照，供按名引用）。 */
export const projectRecordSchema = z.object({
  name: z.string(),
  path: z.string(),
  githubUrl: z.string().nullable(),
  platform: z.string().nullable(),
  languages: z.array(z.string()),
  lastResolvedAt: z.string(),
  /** 商店图标（iTunes 公开 API 解析；无则 null，前端显示占位）。 */
  artworkUrl: z.string().nullable().optional(),
});
export type ProjectRecord = z.infer<typeof projectRecordSchema>;

/** 域声明：appilot/projects 表。由 dsh-web-app（web profile）提供 domain 存储。 */
export const appilotDomain = defineDomain({
  name: 'appilot',
  version: 1,
  tables: {
    projects: domainTable(projectRecordSchema),
  },
});

/** 项目存储抽象：save / list / get。 */
export interface ProjectStore {
  save(record: ProjectRecord): Promise<void>;
  list(): Promise<ProjectRecord[]>;
  get(name: string): Promise<ProjectRecord | undefined>;
}

/** 内存实现：无宿主存储（headless profile / 测试）时使用，会话内有效。 */
export function memoryProjectStore(): ProjectStore {
  const map = new Map<string, ProjectRecord>();
  return {
    async save(record) {
      map.set(record.name, record);
    },
    async list() {
      return [...map.values()];
    },
    async get(name) {
      return map.get(name);
    },
  };
}

/**
 * 宿主 domain 存储实现（ctx.get('storage').domain，web profile 提供）。
 * 用 ctx.get() 显式读取——无需 inject（headless 无 storage 时优雅回退内存）。
 * 打开 appilot 域并持有 projects 表；关闭由调用方 effect 负责（index.ts）。
 */
export function domainProjectStore(ctx: Context): ProjectStore {
  const hub = () =>
    ctx.get('storage') as { domain?: { open(spec: unknown): Promise<unknown> } } | undefined;
  const store: ProjectStore = {
    async save(record) {
      const domain = (await hub()?.domain?.open(appilotDomain)) as
        | { table(name: string): { put(k: string, v: unknown): Promise<void> }; close(): Promise<void> }
        | undefined;
      if (!domain) throw new Error('存储服务不可用（需要 dsh-storage-domain）。');
      try {
        await domain.table('projects').put(record.name, record);
      } finally {
        await domain.close();
      }
    },
    async list() {
      const domain = (await hub()?.domain?.open(appilotDomain)) as
        | { table(name: string): { entries(): IterableIterator<[string, unknown]> }; close(): Promise<void> }
        | undefined;
      if (!domain) return [];
      try {
        return [...domain.table('projects').entries()].map(([, v]) => v as ProjectRecord);
      } finally {
        await domain.close();
      }
    },
    async get(name) {
      const domain = (await hub()?.domain?.open(appilotDomain)) as
        | { table(name: string): { get(k: string): unknown }; close(): Promise<void> }
        | undefined;
      if (!domain) return undefined;
      try {
        return domain.table('projects').get(name) as ProjectRecord | undefined;
      } finally {
        await domain.close();
      }
    },
  };
  return store;
}

/** 优先共享 SQLite 注册表（Phase 2：单一 DB 取代 registry.json，自动迁移旧 JSON）；
 *  env APPILOT_DB_FILE='none' 可禁用回退原逻辑。 */
export function createProjectStore(
  ctx: Context,
  opts?: { dbFile?: string | null; legacyJsonPath?: string | null },
): ProjectStore {
  const override = opts?.dbFile !== undefined ? opts.dbFile : process.env.APPILOT_DB_FILE;
  if (override !== 'none' && override !== null) {
    const dbPath = override || undefined;
    if (dbPath) {
      try {
        return sqliteProjectStore({
          dbPath,
          legacyJsonPath:
            opts?.legacyJsonPath === undefined ? defaultRegistryPath() : opts?.legacyJsonPath,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[appilot-common] SQLite store unavailable, falling back: ${String(err)}`);
      }
    }
  }
  // 禁用/不可用时回退原逻辑（domain → memory）。
  const storage = ctx.get('storage') as { domain?: unknown } | undefined;
  return storage?.domain ? domainProjectStore(ctx) : memoryProjectStore();
}

/** 解析仓库 → ProjectRecord（与 resolve_current_project 共享的纯逻辑）。 */
export async function resolveProjectRecord(path: string): Promise<ProjectRecord> {
  const repo = await collectRepoInfo(path);
  // 商店图标（best-effort：README 商店链接 → iTunes Lookup；失败为 null）。
  let artworkUrl: string | null = null;
  try {
    const { discoverAppStoreLinks, lookupApp } = await import(
      '@appilot-labs/appilot-core/app-store-discovery'
    );
    const trackId = discoverAppStoreLinks(path)?.trackId ?? null;
    if (trackId) {
      const meta = await lookupApp(trackId);
      artworkUrl = meta?.artworkUrl ?? null;
    }
  } catch {
    artworkUrl = null;
  }
  return {
    name: basename(path),
    path,
    githubUrl: repo.githubUrl,
    platform: detectApplePlatform(path),
    languages: detectLocalizedLanguages(path),
    lastResolvedAt: new Date().toISOString(),
    artworkUrl,
  };
}
