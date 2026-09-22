import type { StoreSubmissionDraft } from "@appilot-labs/appilot-core/store-submission";

function normalizedVersion(draft: StoreSubmissionDraft): string {
  return String(draft.appVersion || draft.releaseTag || "").replace(/^v/i, "");
}

function draftTime(draft: StoreSubmissionDraft): number {
  return new Date(draft.ascSyncedAt || draft.storeSyncedAt || draft.updatedAt || 0).getTime();
}

/**
 * A release version is a product-family fact. Multiple platform drafts may
 * describe it, but promotion must expose one candidate and prefers macOS as
 * the project's main platform when that draft is eligible.
 */
export function releasedPromotionDrafts(project: any, currentStoreVersion = ""): StoreSubmissionDraft[] {
  const platformByProduct = new Map<string, string>(
    (Array.isArray(project?.storeProducts) ? project.storeProducts : [])
      .map((product: any) => [String(product.id || ""), String(product.platform || "")]),
  );
  const eligible = (Array.isArray(project?.storeSubmissionDrafts) ? project.storeSubmissionDrafts : [])
    .filter((draft: StoreSubmissionDraft) => {
      const version = normalizedVersion(draft);
      return Boolean(
        draft.storeStatus === "released" ||
        draft.ascSyncedAt ||
        draft.storeSyncedAt ||
        (currentStoreVersion && version === currentStoreVersion),
      );
    });
  const byVersion = new Map<string, StoreSubmissionDraft>();
  for (const draft of eligible) {
    const version = normalizedVersion(draft);
    const current = byVersion.get(version);
    const isMac = platformByProduct.get(String(draft.productId || "")) === "macos";
    const currentIsMac = current && platformByProduct.get(String(current.productId || "")) === "macos";
    if (!current || (isMac && !currentIsMac) || (isMac === currentIsMac && draftTime(draft) > draftTime(current))) {
      byVersion.set(version, draft);
    }
  }
  return [...byVersion.values()].sort((a, b) => draftTime(b) - draftTime(a));
}
