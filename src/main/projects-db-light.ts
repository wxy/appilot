/**
 * 内部读取用的轻量 DB 项目视图（纯函数，无快照）：
 * 注册表 ∪ product_records(含扩展列) ∪ project_meta ∪ 草稿(project_blobs)。
 * 供 getStore 适配器 / 引擎 / handler 替代 kv projects 富数据读取；
 * 不含 rankSnapshots（重，UI 列表走 projects:list 的重视图）。
 */
import type { AppilotStore } from '@appilot-labs/appilot-headless';

export const DRAFT_BLOB_DOMAIN = 'storeSubmissionDrafts';

export interface LightProduct {
  id: string;
  platform: string;
  trackId: number | null;
  bundleId: string | null;
  trackName: string | null;
  artworkUrl: string | null;
  supportedLanguages: { code: string; name: string }[];
  trackedKeywords: unknown[];
  storeLinks: unknown[];
  submissionKeywords: unknown[];
  removedKeywords: unknown[];
  rankSnapshots: unknown[];
}

export interface LightProject {
  name: string;
  id: string;
  localPath: string;
  productType: string | null;
  supportedLanguages: { code: string; name: string }[];
  artworkUrl: string | null;
  storeSubmissionDrafts: unknown[];
  repo: Record<string, unknown> | null;
  storeProducts: LightProduct[];
}

export function buildLightProjects(store: AppilotStore): LightProject[] {
  const byName = new Map(store.projects.list().map((p) => [p.name, p]));
  const productsByProject = new Map<string, any[]>();
  const out: LightProject[] = [];
  for (const rec of byName.values()) {
    const products = store.products.listByProject(rec.name);
    productsByProject.set(rec.name, products);
    const meta = store.meta.get(rec.name);
    const drafts = (() => {
      try {
        const v = store.blobs.get(DRAFT_BLOB_DOMAIN, rec.id ?? rec.name);
        return Array.isArray(v) ? v : [];
      } catch {
        return [];
      }
    })();
    const repo = meta
      ? {
          githubUrl: meta.githubUrl,
          remoteUrl: meta.githubUrl,
          headSha: meta.headSha,
          headDate: meta.headDate,
          branch: meta.branch ?? null,
          headMessage: meta.headMessage ?? null,
          dirty: meta.dirty ?? null,
          description: meta.description ?? null,
          capturedAt: meta.updatedAt,
        }
      : null;
    out.push({
      name: rec.name,
      id: rec.id ?? rec.name,
      localPath: rec.path,
      productType: rec.platform === 'ios' || rec.platform === 'macos' ? rec.platform : null,
      supportedLanguages: (rec.languages || []).map((code) => ({ code, name: code })),
      artworkUrl: rec.artworkUrl ?? null,
      storeSubmissionDrafts: drafts,
      repo: repo as Record<string, unknown> | null,
      storeProducts: products.map((p) => ({
        id: p.productId,
        platform: p.platform ?? 'unknown',
        trackId: p.trackId,
        bundleId: p.bundleId,
        trackName: p.trackName,
        artworkUrl: p.artworkUrl,
        supportedLanguages: (p.supportedLanguages || []).map((code) => ({ code, name: code })),
        trackedKeywords: p.trackedKeywords ?? [],
        storeLinks: p.storeLinks ?? [],
        submissionKeywords: p.submissionKeywords ?? [],
        removedKeywords: p.removedKeywords ?? [],
        rankSnapshots: [],
      })),
    });
  }
  return out;
}
