/**
 * 共享项目注册表同步（方案 A）：Electron 与 DSH 插件共用 `registry.json`
 * （userData 下），原子写 + updatedAt 合并（后写者赢）+ 文件变更 watch。
 *
 * - 本侧项目变更 → syncRegistryToFile（合并写回共享文件）；
 * - 对侧（DSH）新增 → hydrateFromFile（启动 + watch 时补进本侧 store）。
 * 强一致不可达（无锁双写）；本实现保证不损坏 + 最终收敛（秒级）。
 */
import { app } from 'electron';
import { basename, dirname, join } from 'node:path';
import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { log } from '@appilot-labs/appilot-core/logger';

export interface RegistryRecord {
  name: string;
  path: string;
  githubUrl: string | null;
  platform: string | null;
  languages: string[];
  lastResolvedAt: string | null;
  updatedAt: string;
  /** 商店图标（无则 null，前端显示占位）。 */
  artworkUrl?: string | null;
}

const REGISTRY_VERSION = 1;

export function registryFilePath(): string {
  return join(app.getPath('userData'), 'registry.json');
}

async function readRegistry(
  filePath: string,
): Promise<Record<string, RegistryRecord>> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !Array.isArray(data.projects)) return {};
    const out: Record<string, RegistryRecord> = {};
    for (const p of data.projects) {
      if (p && typeof p.name === 'string' && typeof p.path === 'string') {
        out[p.name] = p as RegistryRecord;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** 原子写注册表（进程内串行化，避免 read-merge-write 竞态丢记录）。 */
let writeChain: Promise<unknown> = Promise.resolve();

async function doWrite(
  filePath: string,
  records: Record<string, RegistryRecord>,
): Promise<void> {
  const payload = JSON.stringify(
    { version: REGISTRY_VERSION, projects: Object.values(records) },
    null,
    2,
  );
  await mkdir(dirname(filePath), { recursive: true });
  // tmp 名用 uuid 保证唯一：跨进程同毫秒并发写也不会互相覆盖导致 rename ENOENT。
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await writeFile(tmp, payload, 'utf8');
  await rename(tmp, filePath);
}

function writeRegistry(
  filePath: string,
  records: Record<string, RegistryRecord>,
): Promise<void> {
  const run = writeChain.then(() => doWrite(filePath, records));
  writeChain = run.catch(() => {});
  return run;
}

function mergeRecords(
  current: Record<string, RegistryRecord>,
  incoming: Record<string, RegistryRecord>,
): Record<string, RegistryRecord> {
  const out = { ...current };
  for (const [key, rec] of Object.entries(incoming)) {
    const existing = out[key];
    const recTime = new Date(rec.updatedAt || 0).getTime();
    const curTime = existing ? new Date(existing.updatedAt || 0).getTime() : 0;
    if (!existing || recTime >= curTime) out[key] = rec;
  }
  return out;
}

/** 本侧项目 → 注册表记录（identity 子集）。 */
export function registryRecordOf(project: any): RegistryRecord {
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
    updatedAt: resolved,
    artworkUrl: project?.artworkUrl ?? null,
  };
}

/** 把本侧项目的注册记录合并写回共享文件（后写者赢）。 */
export async function syncRegistryToFile(projects: any[]): Promise<void> {
  try {
    const filePath = registryFilePath();
    const current = await readRegistry(filePath);
    const incoming: Record<string, RegistryRecord> = {};
    for (const p of projects || []) {
      if (p && p.name && p.localPath) incoming[p.name] = registryRecordOf(p);
    }
    await writeRegistry(filePath, mergeRecords(current, incoming));
  } catch (err: any) {
    log.warn(`registry sync failed: ${err.message}`);
  }
}

/** 把共享文件里本侧缺失的项目补进来（DSH 侧注册的）；返回变更后的列表与是否有变化。 */
export async function hydrateFromFile(
  projects: any[],
): Promise<{ projects: any[]; changed: boolean }> {
  try {
    const records = await readRegistry(registryFilePath());
    const byPath = new Map(
      (projects || []).map((p: any) => [normalizePath(p.localPath), p]),
    );
    let changed = false;
    const next = [...(projects || [])];
    for (const rec of Object.values(records)) {
      const existing = byPath.get(normalizePath(rec.path));
      if (!existing) {
        next.push(minimalProjectFromRecord(rec));
        byPath.set(normalizePath(rec.path), rec.path);
        changed = true;
      } else if (rec.updatedAt && isNewer(rec.updatedAt, existing)) {
        // 对侧更新了 identity（name/platform/languages/githubUrl）→ 保守回填。
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

/** 由注册表记录构造最小 Project（storeProducts 等留空，待用户在应用中完善）。 */
function minimalProjectFromRecord(rec: RegistryRecord): any {
  const now = new Date().toISOString();
  const resolved = rec.lastResolvedAt ?? rec.updatedAt ?? now;
  return {
    id: `shared-${Buffer.from(rec.path).toString('base64url').slice(0, 16)}`,
    name: rec.name,
    localPath: rec.path,
    productType: rec.platform === 'ios' || rec.platform === 'macos' ? rec.platform : null,
    bundleId: null,
    trackId: null,
    trackName: null,
    supportedLanguages: (rec.languages || []).map((code) => ({ code, name: code })),
    storeLinks: [],
    trackedKeywords: [],
    submissionKeywords: [],
    removedKeywords: [],
    rankSnapshots: [],
    storeProducts: [],
    createdAt: resolved,
    artworkUrl: rec.artworkUrl ?? null,
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

/** 启动：hydrate + 初始写回 + watch 对侧变更（防抖 300ms）。 */
export function startRegistrySync(getStore: () => Promise<{ get<T = any>(k: string): T; set(k: string, v: unknown): void }>): () => void {
  let watcher: FSWatcher | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const hydrateOnce = async () => {
    try {
      const s = await getStore();
      const { projects, changed } = await hydrateFromFile((s.get('projects') || []) as any[]);
      if (changed) s.set('projects', projects);
      await syncRegistryToFile(projects as any[]);
    } catch (err: any) {
      log.warn(`registry start sync failed: ${err.message}`);
    }
  };

  void hydrateOnce();

  try {
    const dir = dirname(registryFilePath());
    watcher = watch(dir, (_event, filename) => {
      if (filename !== basename(registryFilePath())) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(hydrateOnce, 300);
    });
  } catch (err: any) {
    log.warn(`registry watch unavailable: ${err.message}`);
  }

  return () => {
    if (timer) clearTimeout(timer);
    watcher?.close();
  };
}
