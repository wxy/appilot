import { normalizeTrackedKeyword } from "@appilot-labs/appilot-core/rank-keywords";
import { submissionDraftId } from "@appilot-labs/appilot-core/store-submission";
import type { StoreSubmissionDraft } from "@appilot-labs/appilot-core/store-submission";

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
  const withDraft = index >= 0
    ? drafts.map((item) => item.id === draft.id ? draft : item)
    : [draft, ...drafts];
  // Identity by appVersion: one copy per software (project) and target
  // version — a copy is bound to the app, not to (app, platform). A draft
  // relinked to a newer release (different releaseTag → different id)
  // replaces the previous entry for the same target version instead of
  // duplicating it.
  const version = normalizeVersionKey(String(draft.appVersion || ""));
  const next = version
    ? withDraft.filter(
        (item) =>
          item.id === draft.id ||
          normalizeVersionKey(String(item.appVersion || "")) !== version,
      )
    : withDraft;
  project.storeSubmissionDrafts = next.slice(0, 100);
  return project.storeSubmissionDrafts;
}

export function findStoreSubmissionDraft(
  project: any,
  releaseTag: string,
): StoreSubmissionDraft | null {
  return getStoreSubmissionDrafts(project).find(
    (item) => item.id === submissionDraftId(project.id, releaseTag),
  ) || null;
}

/** Find the copy draft for a target version across any source release or platform. */
export function findDraftByVersion(
  project: any,
  appVersion: string,
): StoreSubmissionDraft | null {
  const version = normalizeVersionKey(appVersion);
  if (!version) return null;
  return getStoreSubmissionDrafts(project)
    .filter((item) => normalizeVersionKey(String(item.appVersion || "")) === version)
    .sort(
      (a, b) =>
        new Date(b.updatedAt || "").getTime() -
        new Date(a.updatedAt || "").getTime(),
    )[0] || null;
}

/**
 * Migrate existing drafts to the appVersion identity: one copy per software
 * (project) and target version, keeping the newest updatedAt. Returns true
 * when duplicates were removed.
 */
export function normalizeDraftIdentity(project: any): boolean {
  const drafts = getStoreSubmissionDrafts(project);
  const sorted = [...drafts].sort(
    (a, b) =>
      new Date(b.updatedAt || "").getTime() -
      new Date(a.updatedAt || "").getTime(),
  );
  const seen = new Set<string>();
  const next: StoreSubmissionDraft[] = [];
  let removed = false;
  for (const draft of sorted) {
    const version = normalizeVersionKey(String(draft.appVersion || ""));
    const key = version
      ? `version::${version}`
      : `no-version::${draft.id}`;
    if (seen.has(key)) {
      removed = true;
      continue;
    }
    seen.add(key);
    next.push(draft);
  }
  if (removed) project.storeSubmissionDrafts = next.slice(0, 100);
  return removed;
}

function normalizeVersionKey(value: string): string {
  return String(value || "").trim().replace(/^v/i, "");
}

export function isProductPostRelease(project: any, product: any): boolean {
  // A recognized App Store product (trackId resolved) is live; track its keywords.
  if (product?.trackId) return true;
  // The copy belongs to the software as a whole: any published/frozen draft
  // for the project means the app is post-release.
  const hasPublishedDraft = getStoreSubmissionDrafts(project).some(
    (draft) =>
      draft.githubDraftStatus === "published" || draft.storeStatus === "released",
  );
  if (hasPublishedDraft) return true;

  // Legacy projects from before StoreSubmissionDraft existed may have release history
  // but no published draft record. Treat them as already post-release.
  return Array.isArray(project.releaseHistory) && project.releaseHistory.length > 0;
}
