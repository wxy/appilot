/**
 * Electron 富数据 → 共享 SQLite（M3：产品注册 + repo 状态）。
 *
 * electron-store 的 project 富数据（storeProducts / repo 状态）双写进共享 DB：
 * - product_records：每平台产品注册（platform/trackId/keywords/…）——rank 等
 *   富数据任务实例化与跨壳读取的前提；
 * - project_meta：repo 状态（githubUrl/head/lastReleaseSha——github-sync 边界）。
 *
 * 本模块不 import electron，纯映射可在 node 下单测；DB 写失败只告警（尽力而为）。
 */
import type { AppilotStore, ProductRecordRow, ProjectMetaRow } from '@appilot-labs/appilot-headless';

/** electron-store project 的最小形状。 */
export interface ElectronProjectRich {
  name?: string | null;
  localPath?: string | null;
  productType?: string | null;
  repo?: {
    githubUrl?: string | null;
    headSha?: string | null;
    headDate?: string | null;
  } | null;
  lastReleaseSha?: string | null;
  storeProducts?: Array<{
    id?: string | null;
    platform?: string | null;
    trackId?: number | null;
    bundleId?: string | null;
    trackName?: string | null;
    artworkUrl?: string | null;
    supportedLanguages?: Array<{ code?: string } | string>;
    trackedKeywords?: unknown[];
    storeLinks?: unknown[];
  }>;
}

function langCodes(list?: Array<{ code?: string } | string>): string[] {
  return (list ?? [])
    .map((l: any) => (typeof l === 'string' ? l : l?.code))
    .filter((c): c is string => Boolean(c));
}

/** electron project → project_meta 行。 */
export function toProjectMeta(p: ElectronProjectRich): ProjectMetaRow | null {
  if (!p?.name || !p?.localPath) return null;
  return {
    projectName: p.name,
    githubUrl: p.repo?.githubUrl ?? null,
    headSha: p.repo?.headSha ?? null,
    headDate: p.repo?.headDate ?? null,
    lastReleaseSha: p.lastReleaseSha ?? null,
    updatedAt: new Date().toISOString(),
  };
}

/** electron project 的 storeProducts → product_records 行。 */
export function toProductRows(p: ElectronProjectRich): ProductRecordRow[] {
  if (!p?.name) return [];
  const now = new Date().toISOString();
  return (p.storeProducts ?? [])
    .filter((sp) => sp && sp.id)
    .map((sp) => ({
      projectName: p.name as string,
      productId: sp.id as string,
      platform: sp.platform ?? null,
      trackId: sp.trackId ?? null,
      bundleId: sp.bundleId ?? null,
      trackName: sp.trackName ?? null,
      artworkUrl: sp.artworkUrl ?? null,
      supportedLanguages: langCodes(sp.supportedLanguages),
      trackedKeywords: Array.isArray(sp.trackedKeywords) ? sp.trackedKeywords : [],
      storeLinks: Array.isArray(sp.storeLinks) ? sp.storeLinks : [],
      updatedAt: now,
    }));
}

/**
 * 把 electron-store 项目富数据双写进共享 DB。
 * 返回写入的 { meta, products } 计数；项目缺 name/localPath 跳过。
 */
export function syncRichDataToDb(
  store: AppilotStore,
  projects: ElectronProjectRich[],
): { meta: number; products: number } {
  let meta = 0;
  let products = 0;
  for (const p of projects ?? []) {
    const m = toProjectMeta(p);
    if (m) {
      store.meta.save(m);
      meta += 1;
    }
    const rows = toProductRows(p);
    for (const row of rows) {
      store.products.upsert(row);
      products += 1;
    }
  }
  return { meta, products };
}
