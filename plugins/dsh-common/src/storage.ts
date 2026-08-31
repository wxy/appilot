import { z } from 'zod';
import type { Context } from '@deepseek-ai/cordis';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { basename } from 'node:path';
import { collectRepoInfo } from '@appilot/core/git-info';
import {
  detectApplePlatform,
  detectLocalizedLanguages,
} from '@appilot/core/app-store-discovery';

/** 注册过的项目记录（持久化的最小快照，供按名引用）。 */
export const projectRecordSchema = z.object({
  name: z.string(),
  path: z.string(),
  githubUrl: z.string().nullable(),
  platform: z.string().nullable(),
  languages: z.array(z.string()),
  lastResolvedAt: z.string(),
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
 * 宿主 domain 存储实现（ctx.storage.domain，web profile 提供）。
 * 打开 appilot 域并持有 projects 表；关闭由调用方 effect 负责（index.ts）。
 */
export function domainProjectStore(ctx: Context): ProjectStore {
  const store: ProjectStore = {
    async save(record) {
      const domain = await ctx.storage?.domain?.open(appilotDomain);
      if (!domain) throw new Error('存储服务不可用（需要 dsh-storage-domain）。');
      try {
        await domain.table('projects').put(record.name, record);
      } finally {
        await domain.close();
      }
    },
    async list() {
      const domain = await ctx.storage?.domain?.open(appilotDomain);
      if (!domain) return [];
      try {
        return [...domain.table('projects').entries()].map(([, v]) => v);
      } finally {
        await domain.close();
      }
    },
    async get(name) {
      const domain = await ctx.storage?.domain?.open(appilotDomain);
      if (!domain) return undefined;
      try {
        return domain.table('projects').get(name);
      } finally {
        await domain.close();
      }
    },
  };
  return store;
}

/** 有存储则用 domain 实现，否则回退内存（同一进程内仍可形成循环）。 */
export function createProjectStore(ctx: Context): ProjectStore {
  // ctx.get() 显式读取，无需 inject：headless（无 storage 服务）优雅回退内存。
  const storage = ctx.get('storage') as { domain?: unknown } | undefined;
  return storage?.domain ? domainProjectStore(ctx) : memoryProjectStore();
}

/** 解析仓库 → ProjectRecord（与 resolve_current_project 共享的纯逻辑）。 */
export async function resolveProjectRecord(path: string): Promise<ProjectRecord> {
  const repo = await collectRepoInfo(path);
  return {
    name: basename(path),
    path,
    githubUrl: repo.githubUrl,
    platform: detectApplePlatform(path),
    languages: detectLocalizedLanguages(path),
    lastResolvedAt: new Date().toISOString(),
  };
}
