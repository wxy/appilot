/**
 * 注册表双向同步纯逻辑（无 electron 依赖，node 单测覆盖）。
 *
 * - syncRegistryCore：本侧（Electron）项目变更 → 共享 DB identity upsert；
 * - hydrateFromDbCore：共享 DB 里本侧缺失/更新的项目 → 补进 electron-store 富数据副本
 *   （DB 是注册表单一事实源，electron-store 是富数据副本）。
 *
 * store 由调用方注入（Electron 传 sharedStore()；测试传任意 headless store）。
 */
import type { AppilotStore, ProjectRow } from '@appilot-labs/appilot-headless';

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

/** 本侧项目变更 → 写共享 DB（identity upsert）。返回写入条数。 */
export function syncRegistryCore(store: AppilotStore, projects: any[]): number {
  let n = 0;
  for (const p of projects || []) {
    if (p && p.name && p.localPath) {
      store.projects.save(registryRecordOf(p));
      n += 1;
    }
  }
  return n;
}

export function normalizePath(p: string): string {
  return (p || '').replace(/[/\\]+$/, '');
}

export function isNewer(updatedAt: string, project: any): boolean {
  const recTime = new Date(updatedAt).getTime();
  const projTime = new Date(
    project?.repo?.capturedAt ?? project?.createdAt ?? 0,
  ).getTime();
  return recTime > projTime;
}

/** 由 DB 记录构造最小 Project（storeProducts 等留空，待用户在应用中完善）。 */
export function minimalProjectFromRecord(rec: ProjectRow): any {
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

/** 共享 DB 里本侧缺失的项目补进列表（最小 Project）；已有项目按 DB 更新字段。 */
export function hydrateFromDbCore(
  store: AppilotStore,
  projects: any[],
): { projects: any[]; changed: boolean } {
  const records = store.projects.list();
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
}
