/**
 * 共享注册表（Phase 2：单一 SQLite DB，取代 registry.json 双向同步）。
 *
 * Electron 与 DSH 打开**同一个 appilot.db**（headless 的 openStore，WAL/事务）。
 * - 本侧项目变更 → syncRegistryToDb（identity upsert 进 DB）；
 * - DSH 侧注册的新项目 → hydrateFromDb（启动 + 每 10s 轮询，补进 electron-store
 *   的富数据副本——electron-store 仍持有富数据，DB 是注册表单一事实源）；
 * - 首次打开时把旧版 registry.json 一次性导入（headless.importLegacyRegistry）。
 */
import { app } from 'electron';
import { join } from 'node:path';
import {
  openStore,
  importLegacyRegistry,
  type AppilotStore,
  type ProjectRow,
} from '@appilot-labs/appilot-headless';
import { log } from '@appilot-labs/appilot-core/logger';

let store: AppilotStore | null = null;

function db(): AppilotStore {
  if (!store) {
    const path = join(app.getPath('userData'), 'appilot.db');
    store = openStore(path);
    // 旧版 registry.json 一次性迁移（幂等）。
    const legacy = join(app.getPath('userData'), 'registry.json');
    try {
      const n = importLegacyRegistry(store, legacy);
      if (n > 0) log.info(`appilot: migrated ${n} legacy registry records to SQLite`);
    } catch (err: any) {
      log.warn(`appilot: legacy registry migration failed: ${err.message}`);
    }
  }
  return store;
}

/** 本侧项目 → DB 注册表行（identity 子集）。 */
export function registryRecordOf(project: any): ProjectRow {
  const resolved = project?.repo?.capturedAt ?? project?.createdAt ?? new Date().toISOString();
  return {
    name: project.name,
    path: project.localPath,
    githubUrl: project?.repo?.githubUrl ?? null,
    platform: project?.productType ?? null,
    languages: (project?.supportedLanguages || [])
      .map((l: any) => (typeof l === 'string' ? l : l?.code))
      .filter(Boolean),
    lastResolvedAt: resolved,
    artworkUrl: project?.artworkUrl ?? null,
    updatedAt: resolved,
  };
}

/** 本侧项目变更 → 写共享 DB（identity upsert）。 */
export async function syncRegistryToDb(projects: any[]): Promise<void> {
  try {
    const s = db();
    for (const p of projects || []) {
      if (p && p.name && p.localPath) s.projects.save(registryRecordOf(p));
    }
  } catch (err: any) {
    log.warn(`registry sync to db failed: ${err.message}`);
  }
}

/** 共享 DB 里本侧缺失的项目补进 electron-store（最小 Project）；返回变更后的列表与是否有变化。 */
export async function hydrateFromDb(
  projects: any[],
): Promise<{ projects: any[]; changed: boolean }> {
  try {
    const records = db().projects.list();
    const byPath = new Map(
      (projects || []).map((p: any) => [normalizePath(p.localPath), p]),
    );
    let changed = false;
    const next = [...(projects || [])];
    for (const rec of records) {
      const existing = byPath.get(normalizePath(rec.path));
      if (!existing) {
        next.push(minimalProjectFromRecord(rec));
        byPath.set(normalizePath(rec.path), rec.path);
        changed = true;
      } else if (rec.updatedAt && isNewer(rec.updatedAt, existing)) {
        const before = JSON.stringify(existing);
        if (rec.name) existing.name = rec.name;
        if (rec.platform === 'ios' || rec.platform === 'macos') existing.productType = rec.platform;
        if (Array.isArray(rec.languages) && rec.languages.length) {
          existing.supportedLanguages = rec.languages.map((code) => ({ code, name: code }));
        }
        if (rec.githubUrl) {
          existing.repo = existing.repo || {};
          existing.repo.githubUrl = rec.githubUrl;
          existing.repo.remoteUrl = rec.githubUrl;
        }
        if (rec.artworkUrl && !existing.artworkUrl) existing.artworkUrl = rec.artworkUrl;
        if (JSON.stringify(existing) !== before) changed = true;
      }
    }
    return { projects: next, changed };
  } catch (err: any) {
    log.warn(`registry hydrate failed: ${err.message}`);
    return { projects: projects || [], changed: false };
  }
}

function normalizePath(p: string): string {
  return (p || '').replace(/[/\\]+$/, '');
}

function isNewer(updatedAt: string, project: any): boolean {
  const recTime = new Date(updatedAt).getTime();
  const projTime = new Date(
    project?.repo?.capturedAt ?? project?.createdAt ?? 0,
  ).getTime();
  return recTime > projTime;
}

/** 由 DB 记录构造最小 Project（storeProducts 等留空，待用户在应用中完善）。 */
function minimalProjectFromRecord(rec: ProjectRow): any {
  const resolved = rec.lastResolvedAt ?? rec.updatedAt ?? new Date().toISOString();
  return {
    id: `shared-${Buffer.from(rec.path).toString('base64url').slice(0, 16)}`,
    name: rec.name,
    localPath: rec.path,
    productType: rec.platform === 'ios' || rec.platform === 'macos' ? rec.platform : null,
    bundleId: null,
    trackId: null,
    trackName: null,
    artworkUrl: rec.artworkUrl ?? null,
    supportedLanguages: (rec.languages || []).map((code) => ({ code, name: code })),
    storeLinks: [],
    trackedKeywords: [],
    submissionKeywords: [],
    removedKeywords: [],
    rankSnapshots: [],
    storeProducts: [],
    createdAt: resolved,
    repo: rec.githubUrl
      ? {
          remoteUrl: rec.githubUrl,
          githubUrl: rec.githubUrl,
          branch: null,
          headSha: null,
          headMessage: null,
          headDate: null,
          dirty: false,
          description: null,
          capturedAt: resolved,
        }
      : null,
    registryShared: true,
  };
}

/**
 * 启动：立即 hydrate 一次 + 初始写回 + 每 10 秒轮询 DB（对侧 DSH 注册/变更）。
 * 返回清理函数。
 */
export function startRegistrySync(
  getStore: () => Promise<{ get<T = any>(k: string): T; set(k: string, v: unknown): void }>,
): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;

  const hydrateOnce = async () => {
    try {
      const s = await getStore();
      const { projects, changed } = await hydrateFromDb((s.get('projects') || []) as any[]);
      if (changed) s.set('projects', projects);
      await syncRegistryToDb(projects as any[]);
    } catch (err: any) {
      log.warn(`registry sync failed: ${err.message}`);
    }
  };

  void hydrateOnce();
  timer = setInterval(hydrateOnce, 10_000);

  return () => {
    if (timer) clearInterval(timer);
  };
}
