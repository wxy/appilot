import { ipcMain } from "electron";
import { runReadinessChecks, type ReadinessCheckItem } from "@appilot-labs/appilot-core/readiness-check";
import { runBuildStatusNow, runOpsSyncNow, runReviewsSyncNow } from "../scheduler";
import { findStoreSubmissionDraft, upsertStoreSubmissionDraft } from "../project-state";
import { getStore } from "../store";
import { assertNonEmptyString } from "../util";
import { notifyDataChanged } from "../data-sync";
import { resolveEffectiveCredentials } from "../credentials";
import { log } from "@appilot-labs/appilot-core/logger";
import { localeMatchesLocale } from "@appilot-labs/appilot-core/store-submission";

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

/**
 * 取“商店实际文案”用于对齐校验：有 ASC 凭证时直接读 ASC 该版本的全部
 * 本地化（名称/副标题/推广文本/描述/新增内容/关键词，name/subtitle 缺失时
 * 回退 App 级）；无凭证时逐语言走公开商店 lookup（仅 description + whatsNew，
 * 且要求商店当前版本与目标版本一致）。
 */
async function fetchAlignmentStoreCopy(
  s: any,
  project: any,
  product: any,
  draft: any,
): Promise<{
  mode: "asc" | "public";
  versionMatched: boolean;
  storeByLanguage: { language: string; fields: Record<string, string | null> }[];
  ascLocalizations?: any[];
  appInfoLocalizations?: any[];
}> {
  const creds = resolveEffectiveCredentials(s, project.id);
  const hasAsc = Boolean(
    creds.ascIssuerId && creds.ascKeyId && creds.ascPrivateKeyPath,
  );
  const targetVersion = String(draft.appVersion || "").trim().replace(/^v/i, "");
  const supported = (product.supportedLanguages || []).map((l: any) => l.code);

  if (hasAsc && product.bundleId && targetVersion) {
    try {
      const fs = await import("fs");
      const { createAscClient } = await import("@appilot-labs/appilot-core/asc-api");
      const client = createAscClient({
        issuerId: creds.ascIssuerId,
        keyId: creds.ascKeyId,
        privateKeyPem: fs.readFileSync(creds.ascPrivateKeyPath, "utf8"),
      });
      const appId = await client.getAppIdByBundleId(product.bundleId);
      if (appId) {
        const versions = await client.listAppStoreVersions(appId);
        const version = versions.find(
          (v: any) =>
            String(v.versionString || "").trim().replace(/^v/i, "") ===
            targetVersion,
        );
        if (!version) return { mode: "asc", versionMatched: false, storeByLanguage: [] };
        const [versionLocalizations, appInfoLocalizations] = await Promise.all([
          client.listVersionLocalizations(version.id),
          client.listAppInfoLocalizations(appId),
        ]);
        const appInfoByLocale = new Map(
          (appInfoLocalizations || []).map((loc: any) => [
            String(loc.locale || "").toLowerCase(),
            loc,
          ]),
        );
        const storeByLanguage = (versionLocalizations || []).map((loc: any) => {
          const locale = String(loc.locale || "");
          const language =
            supported.find((code: string) => localeMatchesLocale(locale, code)) ||
            locale;
          const appInfo = appInfoByLocale.get(locale.toLowerCase()) || null;
          return {
            language,
            fields: {
              name: appInfo?.name || loc.name || null,
              subtitle: appInfo?.subtitle || loc.subtitle || null,
              promotionalText: loc.promotionalText ?? null,
              description: loc.description ?? null,
              whatsNew: loc.whatsNew ?? null,
              keywords: loc.keywords ?? null,
            },
          };
        });
        return {
          mode: "asc",
          versionMatched: true,
          storeByLanguage,
          ascLocalizations: versionLocalizations,
          appInfoLocalizations,
        };
      }
    } catch (err: any) {
      log.warn(`Alignment ASC fetch failed for ${product.id}: ${err.message}`);
      // 落到公开商店模式继续（部分字段可核对）。
    }
  }

  const { STOREFRONTS_BY_LANGUAGE } = await import("@appilot-labs/appilot-core/storefronts");
  const { fetchStoreLocalizedCopy } = await import("@appilot-labs/appilot-core/app-store-discovery");
  const storeByLanguage: { language: string; fields: Record<string, string | null> }[] = [];
  let versionMatched = false;
  for (const loc of draft.localizations || []) {
    const country = STOREFRONTS_BY_LANGUAGE[String(loc.language || "")]?.[0];
    if (!country || !product.trackId) continue;
    const copy = await fetchStoreLocalizedCopy(product.trackId, country);
    if (!copy) continue;
    if (String(copy.version || "").trim().replace(/^v/i, "") !== targetVersion) continue;
    versionMatched = true;
    storeByLanguage.push({
      language: loc.language,
      fields: {
        description: copy.description ?? null,
        whatsNew: copy.releaseNotes ?? null,
      },
    });
  }
  return { mode: "public", versionMatched, storeByLanguage };
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

  ipcMain.handle("activity:commits", async (_event, projectId: string) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const project = projects.find((item: any) => item.id === projectId);
    if (!project?.localPath) return {};
    const { getCommitActivity } = await import("@appilot-labs/appilot-core/git-info");
    return getCommitActivity(project.localPath);
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
        const { fetchStoreCurrentVersion } = await import("@appilot-labs/appilot-core/app-store-discovery");
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
      const { STOREFRONTS_BY_LANGUAGE } = await import("@appilot-labs/appilot-core/storefronts");
      const { fetchStoreLocalizedCopy } = await import("@appilot-labs/appilot-core/app-store-discovery");
      const { applyStorePublicSnapshotToDraft } = await import("@appilot-labs/appilot-core/store-submission");
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

  // 对齐校验（只读）：本地文案 vs 商店实际文案，逐语言列出差异。
  ipcMain.handle(
    "alignment:check",
    async (_event, projectId: string, productId: string, releaseTag: string) => {
      projectId = assertNonEmptyString(projectId, "projectId");
      productId = assertNonEmptyString(productId, "productId");
      releaseTag = assertNonEmptyString(releaseTag, "releaseTag");
      const s = await getStore();
      const projects: any[] = s.get("projects") || [];
      const project = projects.find((item: any) => item.id === projectId);
      if (!project) throw new Error("Project not found");
      const product = (project.storeProducts || []).find(
        (item: any) => item.id === productId,
      );
      if (!product) throw new Error("Store product not found");
      const draft = findStoreSubmissionDraft(project, productId, releaseTag);
      if (!draft) throw new Error("Draft not found");
      const copy = await fetchAlignmentStoreCopy(s, project, product, draft);
      const { diffDraftAgainstStore } = await import("@appilot-labs/appilot-core/store-submission");
      const diffs = diffDraftAgainstStore(draft, copy.storeByLanguage);
      return { mode: copy.mode, versionMatched: copy.versionMatched, diffs };
    },
  );

  // 对齐应用：把商店实际文案写回本地草稿（ASC→完全对齐 ascSyncedAt；
  // 公开商店→部分对齐 storeSyncedAt）。
  ipcMain.handle(
    "alignment:apply",
    async (_event, projectId: string, productId: string, releaseTag: string) => {
      projectId = assertNonEmptyString(projectId, "projectId");
      productId = assertNonEmptyString(productId, "productId");
      releaseTag = assertNonEmptyString(releaseTag, "releaseTag");
      const s = await getStore();
      const projects: any[] = s.get("projects") || [];
      const project = projects.find((item: any) => item.id === projectId);
      if (!project) throw new Error("Project not found");
      const product = (project.storeProducts || []).find(
        (item: any) => item.id === productId,
      );
      if (!product) throw new Error("Store product not found");
      const draft = findStoreSubmissionDraft(project, productId, releaseTag);
      if (!draft) throw new Error("Draft not found");
      const copy = await fetchAlignmentStoreCopy(s, project, product, draft);
      const {
        applyAscSnapshotToDraft,
        applyStorePublicSnapshotToDraft,
        diffDraftAgainstStore,
      } = await import("@appilot-labs/appilot-core/store-submission");
      let changed = false;
      if (copy.mode === "asc" && copy.versionMatched && copy.ascLocalizations) {
        changed =
          applyAscSnapshotToDraft(draft, copy.ascLocalizations) ||
          applyAscSnapshotToDraft(draft, copy.appInfoLocalizations || []);
      } else if (copy.mode === "public" && copy.versionMatched) {
        changed = applyStorePublicSnapshotToDraft(
          draft,
          copy.storeByLanguage.map((entry) => ({
            language: entry.language,
            description: entry.fields.description ?? undefined,
            whatsNew: entry.fields.whatsNew ?? undefined,
          })),
        );
      }
      if (changed) {
        upsertStoreSubmissionDraft(project, draft);
        s.set("projects", projects);
        notifyDataChanged("releases");
      }
      const diffs = diffDraftAgainstStore(draft, copy.storeByLanguage);
      return { applied: changed, mode: copy.mode, versionMatched: copy.versionMatched, diffs };
    },
  );
}
