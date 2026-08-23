import { normalizeTrackedKeyword } from "../engine/rank-keywords";
import { submissionDraftId } from "../engine/store-submission";
import type { StoreSubmissionDraft } from "../engine/store-submission";

/** Shared project-shape helpers used by both IPC handlers and the scheduler. */

export function migrateLegacyStoreProducts(project: any): any {
  if (Array.isArray(project?.storeProducts) && project.storeProducts.length > 0) {
    const products = project.storeProducts.map((product: any) => {
      const platform = product.platform === "unknown" && project.productType
        ? project.productType
        : product.platform;
      const id = product.id?.endsWith(":unknown") && platform !== "unknown"
        ? `${project.id}:${platform}`
        : product.id;
      return { ...product, platform, id };
    });
    return products.some((product: any, index: number) => product !== project.storeProducts[index])
      ? { ...project, storeProducts: products }
      : project;
  }

  const platforms = new Set<string>();
  for (const link of project?.storeLinks || []) {
    platforms.add(link.platform || "unknown");
  }
  if (platforms.size === 0) platforms.add(project?.productType || "unknown");

  const platformList = [...platforms];
  const primaryPlatform = project?.productType || platformList[0];
  const storeProducts = platformList.map((platform) => {
    const isPrimary = platform === primaryPlatform;
    return {
      id: `${project.id}:${platform}`,
      projectId: project.id,
      platform,
      trackId: project.trackId ?? null,
      bundleId: project.bundleId ?? null,
      trackName: project.trackName ?? null,
      artworkUrl: project.artworkUrl ?? null,
      supportedLanguages: project.supportedLanguages || [],
      storeLinks: (project.storeLinks || []).filter(
        (link: any) => (link.platform || "unknown") === platform,
      ),
      trackedKeywords: isPrimary ? project.trackedKeywords || project.keywords || [] : [],
      submissionKeywords: isPrimary ? project.submissionKeywords || [] : [],
      removedKeywords: isPrimary ? project.removedKeywords || [] : [],
      rankSnapshots: isPrimary ? project.rankSnapshots || [] : [],
      createdAt: project.createdAt || new Date().toISOString(),
    };
  });

  return { ...project, storeProducts };
}

/**
 * Plan A — shared keyword pool: a product's keywords are one set queried
 * across language × platform × storefront. The pool lives at the project
 * level; per-platform keyword copies from older data are merged once here.
 */
export function ensureProjectKeywordPool(project: any): any {
  if (!project) return project;
  if (!Array.isArray(project.trackedKeywords)) {
    const byKey = new Map<string, any>();
    const order: string[] = [];
    for (const product of project.storeProducts || []) {
      for (const keyword of product.trackedKeywords || []) {
        if (!keyword || !keyword.keyword) continue;
        const key = `${keyword.language}\u0000${keyword.keyword}`;
        if (!byKey.has(key)) {
          byKey.set(key, normalizeTrackedKeyword(keyword));
          order.push(key);
        }
      }
    }
    project.trackedKeywords = order.map((key) => byKey.get(key));
  }
  if (!Array.isArray(project.submissionKeywords)) {
    const byLang = new Map<string, string>();
    for (const product of project.storeProducts || []) {
      for (const item of product.submissionKeywords || []) {
        if (item?.language && item.text && !byLang.has(item.language)) {
          byLang.set(item.language, item.text);
        }
      }
    }
    project.submissionKeywords = [...byLang].map(([language, text]) => ({ language, text }));
  }
  if (!Array.isArray(project.removedKeywords)) {
    const byKey = new Map<string, any>();
    for (const product of project.storeProducts || []) {
      for (const item of product.removedKeywords || []) {
        if (!item || !item.keyword) continue;
        const key = `${item.language}\u0000${item.keyword}`;
        if (!byKey.has(key)) byKey.set(key, item);
      }
    }
    project.removedKeywords = [...byKey.values()];
  }
  return project;
}

export function findProductContext(
  projects: any[],
  productId: string,
): { project: any; product: any } | null {
  for (const project of projects) {
    const product = (project.storeProducts || []).find(
      (item: any) => item.id === productId,
    );
    if (product) return { project: ensureProjectKeywordPool(project), product };
  }
  return null;
}

export function getStoreSubmissionDrafts(project: any): StoreSubmissionDraft[] {
  return Array.isArray(project.storeSubmissionDrafts) ? project.storeSubmissionDrafts : [];
}

export function upsertStoreSubmissionDraft(
  project: any,
  draft: StoreSubmissionDraft,
): StoreSubmissionDraft[] {
  const drafts = getStoreSubmissionDrafts(project);
  const index = drafts.findIndex((item) => item.id === draft.id);
  const next = index >= 0
    ? drafts.map((item) => item.id === draft.id ? draft : item)
    : [draft, ...drafts];
  project.storeSubmissionDrafts = next.slice(0, 100);
  return project.storeSubmissionDrafts;
}

export function findStoreSubmissionDraft(
  project: any,
  productId: string,
  releaseTag: string,
): StoreSubmissionDraft | null {
  return getStoreSubmissionDrafts(project).find(
    (item) => item.id === submissionDraftId(project.id, productId, releaseTag),
  ) || null;
}

export function isProductPostRelease(project: any, product: any): boolean {
  // A recognized App Store product (trackId resolved) is live; track its keywords.
  if (product?.trackId) return true;
  const hasPublishedDraft = getStoreSubmissionDrafts(project).some(
    (draft) =>
      draft.productId === product.id &&
      (draft.githubDraftStatus === "published" || draft.storeStatus === "released"),
  );
  if (hasPublishedDraft) return true;

  // Legacy projects from before StoreSubmissionDraft existed may have release history
  // but no published draft record. Treat them as already post-release.
  return Array.isArray(project.releaseHistory) && project.releaseHistory.length > 0;
}
