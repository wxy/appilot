import { ipcMain } from "electron";
import { runReadinessChecks, type ReadinessCheckItem } from "../../engine/readiness-check";
import { runBuildStatusNow, runOpsSyncNow, runReviewsSyncNow } from "../scheduler";
import { findStoreSubmissionDraft, upsertStoreSubmissionDraft } from "../project-state";
import { getStore } from "../store";
import { assertNonEmptyString } from "../util";

function readinessInputFrom(draft: any, product: any, asc: any) {
  const localizations = (draft.localizations || []).map((loc: any) => ({
    language: loc.language || "",
    locale: loc.locale || loc.language || "",
    name: loc.name || "",
    subtitle: loc.subtitle || "",
    promotionalText: loc.promotionalText || "",
    keywords: loc.keywords || "",
    description: loc.description || "",
    whatsNew: loc.whatsNew || "",
  }));
  const ascVersion = (asc?.versions || []).find(
    (v: any) => v.versionString === draft.appVersion,
  ) || (asc?.versions || [])[0] || null;
  return {
    localizations,
    supportedLanguages: (product?.supportedLanguages || []).map((l: any) => l.code),
    // Target version is the ASC matching key; releaseTag is only the content
    // source and may legitimately differ (user can override the version).
    versionTag: draft.appVersion || draft.releaseTag || "",
    ascVersion: ascVersion?.versionString ?? null,
    buildAttached: Boolean(ascVersion?.buildId),
  };
}

export function registerOpsHandlers(): void {
  ipcMain.handle("reviews:list", async (_event, productId: string) => {
    productId = assertNonEmptyString(productId, "productId");
    const s = await getStore();
    return (s.get("reviews") || {})[productId] || {};
  });

  ipcMain.handle("reviews:sync", async (_event, productId: string) => {
    productId = assertNonEmptyString(productId, "productId");
    return runReviewsSyncNow(productId);
  });

  ipcMain.handle("traffic:snapshots", async (_event, projectId: string) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    const s = await getStore();
    return (s.get("trafficSnapshots") || {})[projectId] || [];
  });

  ipcMain.handle("traffic:sync", async (_event, projectId: string) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    return runOpsSyncNow(projectId);
  });

  ipcMain.handle("asc:sync", async (_event, productId: string) => {
    productId = assertNonEmptyString(productId, "productId");
    return runBuildStatusNow(productId);
  });

  ipcMain.handle("asc:status", async (_event, productId: string) => {
    productId = assertNonEmptyString(productId, "productId");
    const s = await getStore();
    return (s.get("ascCache") || {})[productId] || null;
  });

  // Public iTunes lookup — the no-ASC fallback: only confirms the current
  // live version; never fabricates submitted/review state.
  ipcMain.handle("store:currentVersion", async (_event, productId: string) => {
    productId = assertNonEmptyString(productId, "productId");
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    for (const project of projects) {
      const product = (project.storeProducts || []).find(
        (item: any) => item.id === productId,
      );
      if (product?.trackId) {
        const { fetchStoreCurrentVersion } = await import("../../engine/app-store-discovery");
        return fetchStoreCurrentVersion(product.trackId);
      }
    }
    return null;
  });

  ipcMain.handle("readiness:get", async (_event, projectId: string, draftId: string) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    draftId = assertNonEmptyString(draftId, "draftId");
    const s = await getStore();
    return (s.get("readinessChecks") || {})[projectId]?.[draftId] || null;
  });

  ipcMain.handle("readiness:check", async (_event, projectId: string, productId: string, releaseTag: string) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    productId = assertNonEmptyString(productId, "productId");
    releaseTag = assertNonEmptyString(releaseTag, "releaseTag");
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const project = projects.find((item: any) => item.id === projectId);
    if (!project) throw new Error("Project not found");
    const draft = findStoreSubmissionDraft(project, productId, releaseTag);
    if (!draft) throw new Error("Draft not found");
    const product = (project.storeProducts || []).find((item: any) => item.id === productId);
    const asc = (s.get("ascCache") || {})[productId] || null;
    // No ASC data (no credentials / not synced): fall back to per-language
    // public storefront copy so the live version's description/what's-new can
    // still be aligned after release. Only applies when the storefront's
    // current version matches the draft's target version.
    if (!asc && draft.appVersion && product?.trackId) {
      const { STOREFRONTS_BY_LANGUAGE } = await import("../../engine/storefronts");
      const { fetchStoreLocalizedCopy } = await import("../../engine/app-store-discovery");
      const { applyStorePublicSnapshotToDraft } = await import("../../engine/store-submission");
      const targetVersion = String(draft.appVersion || "").trim().replace(/^v/i, "");
      const updates: { language: string; description: string; whatsNew: string }[] = [];
      for (const loc of draft.localizations || []) {
        const country = STOREFRONTS_BY_LANGUAGE[String(loc.language || "")]?.[0];
        if (!country) continue;
        const copy = await fetchStoreLocalizedCopy(product.trackId, country);
        if (!copy) continue;
        if (String(copy.version || "").trim().replace(/^v/i, "") !== targetVersion) continue;
        updates.push({ language: loc.language, description: copy.description, whatsNew: copy.releaseNotes });
      }
      if (updates.length > 0 && applyStorePublicSnapshotToDraft(draft, updates)) {
        upsertStoreSubmissionDraft(project, draft);
        s.set("projects", projects);
      }
    }
    const items: ReadinessCheckItem[] = runReadinessChecks(readinessInputFrom(draft, product, asc));
    const all: Record<string, any> = s.get("readinessChecks") || {};
    all[projectId] = all[projectId] || {};
    all[projectId][draft.id] = { checkedAt: new Date().toISOString(), items };
    s.set("readinessChecks", all);
    return all[projectId][draft.id];
  });
}
