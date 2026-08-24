import { ipcMain } from "electron";
import { runReadinessChecks, type ReadinessCheckItem } from "../../engine/readiness-check";
import { runBuildStatusNow, runOpsSyncNow, runReviewsSyncNow } from "../scheduler";
import { findStoreSubmissionDraft } from "../project-state";
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
    versionTag: draft.releaseTag || "",
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
    const items: ReadinessCheckItem[] = runReadinessChecks(readinessInputFrom(draft, product, asc));
    const all: Record<string, any> = s.get("readinessChecks") || {};
    all[projectId] = all[projectId] || {};
    all[projectId][draft.id] = { checkedAt: new Date().toISOString(), items };
    s.set("readinessChecks", all);
    return all[projectId][draft.id];
  });
}
