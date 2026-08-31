import { app, dialog, ipcMain } from "electron";
import fs from "fs";
import path from "path";
import { log } from "@appilot/core/logger";
import { appendRankSnapshots } from "@appilot/core/rank-snapshots";
import { evaluatePause, normalizeTrackedKeyword } from "@appilot/core/rank-keywords";
import { isStorefrontAllowedForQueryLanguage, storefrontsForLanguage } from "@appilot/core/storefronts";
import { createAiProvider } from "../ai-service";
import { importAscKeyFileTo } from "../asc-key-file";
import { notifyDataChanged } from "../data-sync";
import { withAiOperation } from "../ai-cancel";
import {
  ascJwt,
  decryptApiKey,
  encryptApiKey,
  garbageCollectKeys,
  resolveEffectiveCredentials,
} from "../credentials";
import { emitProjectsChanged } from "../project-events";
import {
  ensureProjectKeywordPool,
  findProductContext,
  getStoreSubmissionDrafts,
  migrateLegacyStoreProducts,
} from "../project-state";
import { buildProjectProfileFor } from "../release-service";
import { githubSyncCacheEntry, schedulerTick } from "../scheduler";
import { getStore } from "../store";
import { filterTasksForRemovedProject } from "../task-cleanup";
import {
  parsePlistVersion,
  parsePlistBundleId,
  parsePlistBundleVersion,
  archiveCheck,
  permissionsCheck,
  parsePbxprojVersion,
  parsePbxprojBuildNumber,
  buildNumberConsistencyCheck,
  pbxprojPermissionKeys,
  plistPermissionKeys,
  entitlementKeys,
  xcstringsLocalizationCount,
  COMMON_PERMISSION_KEYS,
  capabilityLabel,
  versionConsistencyCheck,
} from "@appilot/core/pre-release";
import {
  assertNonEmptyString,
  dedupeProjects,
  normalizeLocalPath,
} from "../util";

function updateProjectInProjects(projects: any[], projectId: string, updater: (project: any) => any): any[] {
  return projects.map((project) =>
    project.id === projectId ? { ...project, ...updater(project) } : project,
  );
}

function submissionReferenceFor(product: any, project: any, language: string) {
  ensureProjectKeywordPool(project);
  const drafts = getStoreSubmissionDrafts(project)
    .filter((draft) => draft.productId === product.id)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const latest = drafts[0];
  const loc = latest?.localizations?.find((item: any) => item.language === language)
    || latest?.localizations?.[0];
  const fallbackSubmission = (project.submissionKeywords || []).find(
    (item: any) => item.language === language,
  );
  return {
    name: loc?.name || product.trackName || project.name,
    subtitle: loc?.subtitle || "",
    submissionKeywords: loc?.keywords || fallbackSubmission?.text || "",
  };
}

function sanitizeRankSnapshots(project: any): any {
  const cleanSnapshots = (snapshots: any[]) =>
    snapshots.filter((snapshot: any) => {
    return isStorefrontAllowedForQueryLanguage(snapshot?.language || "", snapshot?.storefront || "");
  });

  const storeProducts = Array.isArray(project?.storeProducts)
    ? project.storeProducts.map((product: any) => {
        const snapshots = Array.isArray(product?.rankSnapshots) ? product.rankSnapshots : [];
        const cleaned = cleanSnapshots(snapshots);
        return cleaned.length === snapshots.length ? product : { ...product, rankSnapshots: cleaned };
      })
    : [];
  const snapshots = Array.isArray(project?.rankSnapshots) ? project.rankSnapshots : [];
  const cleaned = cleanSnapshots(snapshots);
  const productsChanged = storeProducts.some(
    (product: any, index: number) => product !== project?.storeProducts?.[index],
  );
  if (cleaned.length === snapshots.length && !productsChanged) return project;
  return { ...project, rankSnapshots: cleaned, storeProducts };
}

export function registerProjectsHandlers(): void {
  ipcMain.handle("projects:list", async () => {
    const s = await getStore();
    const raw: any[] = s.get("projects") || [];
    const projects = dedupeProjects(raw);
    const migrated = projects.map(migrateLegacyStoreProducts);
    const cleaned = migrated.map(sanitizeRankSnapshots);
    if (
      projects.length !== raw.length ||
      migrated.some((project, index) => project !== projects[index]) ||
      cleaned.some((project, index) => project !== migrated[index])
    ) {
      s.set("projects", cleaned);
    }
    // Backfill read-only repo info for projects added before this feature,
    // then refresh it at most once a day so branch/HEAD stay roughly fresh.
    const repoStaleMs = 24 * 60 * 60 * 1000;
    let repoChanged = false;
    for (const project of cleaned) {
      const repo = project.repo || null;
      const stale =
        !repo?.capturedAt ||
        Date.now() - new Date(repo.capturedAt).getTime() > repoStaleMs;
      if (!stale) continue;
      try {
        const { collectRepoInfo } = await import("@appilot/core/git-info");
        project.repo = await collectRepoInfo(project.localPath || "");
        repoChanged = true;
      } catch (err: any) {
        log.warn(`Repo info refresh failed for ${project.localPath}: ${err.message}`);
      }
    }
    if (repoChanged) s.set("projects", cleaned);
    return cleaned.map((project) => {
      const creds = resolveEffectiveCredentials(s, project.id);
      const override = (s.get("projectCredentials") || {})[project.id] || {};
      return {
        ...project,
        hasGithubToken: Boolean(creds.githubToken),
        hasAscKey: Boolean(
          creds.ascIssuerId && creds.ascKeyId && creds.ascPrivateKeyPath,
        ),
        githubSource: creds.githubToken
          ? override.githubToken
            ? "project"
            : "global"
          : null,
        ascSource:
          override.ascIssuerId || override.ascKeyId || override.ascPrivateKeyPath
            ? "project"
            : creds.ascIssuerId && creds.ascKeyId && creds.ascPrivateKeyPath
              ? "global"
              : null,
        trafficError: (s.get("opsStatus") || {})[project.id]?.trafficError ?? null,
      };
    });
  });

  ipcMain.handle(
    "projects:updateSettings",
    async (
      _event,
      projectId: string,
      settings: { name?: string; localPath?: string; githubUrl?: string | null },
    ) => {
      projectId = assertNonEmptyString(projectId, "projectId");
      const s = await getStore();
      const projects: any[] = s.get("projects") || [];
      const index = projects.findIndex((project) => project.id === projectId);
      if (index < 0) throw new Error("Project not found");
      const project = { ...projects[index] };

      if (typeof settings.name === "string" && settings.name.trim()) {
        project.name = settings.name.trim();
      }
      if (
        typeof settings.localPath === "string" &&
        settings.localPath.trim() &&
        settings.localPath.trim() !== project.localPath
      ) {
        const candidate = normalizeLocalPath(settings.localPath);
        if (!candidate || !fs.existsSync(candidate)) throw new Error("本地目录不存在");
        if (!fs.statSync(candidate).isDirectory()) throw new Error("本地目录不是文件夹");
        if (!fs.existsSync(path.join(candidate, ".git"))) {
          throw new Error("目录不是 git 仓库（缺少 .git）");
        }
        project.localPath = candidate;
        try {
          const { collectRepoInfo } = await import("@appilot/core/git-info");
          project.repo = await collectRepoInfo(candidate);
        } catch (err: any) {
          log.warn(`Repo info refresh failed after path change: ${err.message}`);
        }
      }
      if (typeof settings.githubUrl === "string" && settings.githubUrl.trim()) {
        project.repo = { ...(project.repo || {}), githubUrl: settings.githubUrl.trim() };
      } else if (settings.githubUrl === null || settings.githubUrl === "") {
        try {
          const { collectRepoInfo } = await import("@appilot/core/git-info");
          project.repo = await collectRepoInfo(project.localPath || "");
        } catch (err: any) {
          log.warn(`Repo info refresh failed while clearing github url: ${err.message}`);
        }
      }

      const latestProjects: any[] = s.get("projects") || [];
      const latestIndex = latestProjects.findIndex((p: any) => p.id === projectId);
      if (latestIndex >= 0) {
        latestProjects[latestIndex] = project;
        s.set("projects", latestProjects);
      }
      void schedulerTick();
    notifyDataChanged("projects");
      emitProjectsChanged();
      return project;
    },
  );

  ipcMain.handle("projects:getCredentials", async (_event, projectId: string) => {
    const s = await getStore();
    const eff = resolveEffectiveCredentials(s, projectId);
    const global = s.get("globalCredentials") || {};
    const override = (s.get("projectCredentials") || {})[projectId] || {};
    const maskSecret = (value: string) => {
      if (!value) return "";
      return value.length <= 8 ? "••••••••" : `${value.slice(0, 4)}••••${value.slice(-4)}`;
    };
    // Project-scope form must show only the project's own override values.
    // Effective values (global ?? override) would make the override form look
    // like it is replacing the global credentials.
    const overrideGithubToken = override.githubToken
      ? decryptApiKey(override.githubToken)
      : "";
    return {
      hasGithubToken: Boolean(eff.githubToken),
      githubExpiresAt: eff.githubExpiresAt || "",
      hasAscKey: Boolean(eff.ascIssuerId && eff.ascKeyId && eff.ascPrivateKeyPath),
      globalGithubTokenSet: Boolean(global.githubToken),
      globalAscKeySet: Boolean(
        global.ascIssuerId && global.ascKeyId && global.ascPrivateKeyPath,
      ),
      githubSource: override.githubToken ? "project" : global.githubToken ? "global" : null,
      ascSource:
        override.ascIssuerId || override.ascKeyId || override.ascPrivateKeyPath
          ? "project"
          : global.ascIssuerId || global.ascKeyId || global.ascPrivateKeyPath
            ? "global"
            : null,
      ascIssuerIdSet: Boolean(eff.ascIssuerId),
      ascKeyIdSet: Boolean(eff.ascKeyId),
      ascPrivateKeyPathSet: Boolean(eff.ascPrivateKeyPath),
      githubTokenMasked: maskSecret(eff.githubToken),
      ascIssuerId: eff.ascIssuerId,
      ascKeyId: eff.ascKeyId,
      ascPrivateKeyPath: eff.ascPrivateKeyPath || "",
      projectHasGithubToken: Boolean(override.githubToken),
      projectGithubTokenMasked: maskSecret(overrideGithubToken),
      projectGithubExpiresAt: override.githubExpiresAt || "",
      projectHasAscKey: Boolean(
        override.ascIssuerId && override.ascKeyId && override.ascPrivateKeyPath,
      ),
      projectAscIssuerId: override.ascIssuerId || "",
      projectAscKeyId: override.ascKeyId || "",
      projectAscPrivateKeyPath: override.ascPrivateKeyPath || "",
    };
  });

  ipcMain.handle(
    "projects:saveCredentials",
    async (
      _event,
      projectId: string,
      creds: {
        scope?: "global" | "project";
        githubToken?: string;
        githubExpiresAt?: string;
        ascIssuerId?: string;
        ascKeyId?: string;
        ascPrivateKeyPath?: string;
      },
    ) => {
      const s = await getStore();
      const scope = creds.scope === "project" ? "project" : "global";
      if (scope === "project") projectId = assertNonEmptyString(projectId, "projectId");
      const ascCopy = creds.ascPrivateKeyPath
        ? importAscKeyFileTo(
            path.join(app.getPath("userData"), "keys"),
            creds.ascPrivateKeyPath,
            scope === "global" ? "global" : projectId || "project",
          )
        : undefined;
      const setField = (entry: Record<string, string>, key: string, value?: string) => {
        if (value === undefined) return;
        if (value.trim() === "") delete entry[key];
        // Issuer/Key ID and the .p8 path are identifiers, not secrets; only the
        // GitHub token needs encryption. (Encrypting a 10-char Key ID produced
        // base64 under 32 chars, which the legacy decryption heuristic treated
        // as plaintext and leaked into the JWT `kid`.)
        else if (
          key === "ascPrivateKeyPath" ||
          key === "ascIssuerId" ||
          key === "ascKeyId" ||
          key === "githubExpiresAt"
        ) {
          entry[key] = value.trim();
        }
        else entry[key] = encryptApiKey(value);
      };
      if (scope === "global") {
        const entry: Record<string, string> = { ...(s.get("globalCredentials") || {}) };
        setField(entry, "githubToken", creds.githubToken);
        setField(entry, "githubExpiresAt", creds.githubExpiresAt);
        setField(entry, "ascIssuerId", creds.ascIssuerId);
        setField(entry, "ascKeyId", creds.ascKeyId);
        setField(entry, "ascPrivateKeyPath", ascCopy);
        s.set("globalCredentials", entry);
      } else {
        const all: Record<string, Record<string, string>> = s.get("projectCredentials") || {};
        const entry: Record<string, string> = { ...(all[projectId] || {}) };
        setField(entry, "githubToken", creds.githubToken);
        setField(entry, "githubExpiresAt", creds.githubExpiresAt);
        setField(entry, "ascIssuerId", creds.ascIssuerId);
        setField(entry, "ascKeyId", creds.ascKeyId);
        setField(entry, "ascPrivateKeyPath", ascCopy);
        if (Object.keys(entry).length === 0) delete all[projectId];
        else all[projectId] = entry;
        s.set("projectCredentials", all);
      }
      garbageCollectKeys(s);
      return true;
    },
  );

  ipcMain.handle(
    "projects:clearCredentials",
    async (_event, projectId: string, scope: "global" | "project") => {
      const s = await getStore();
      if (scope === "global") {
        s.set("globalCredentials", {});
      } else {
        projectId = assertNonEmptyString(projectId, "projectId");
        const all = s.get("projectCredentials") || {};
        delete all[projectId];
        s.set("projectCredentials", all);
      }
      garbageCollectKeys(s);
      return true;
    },
  );

  ipcMain.handle("projects:testGithubToken", async (_event, projectId: string, token?: string) => {
    const s = await getStore();
    const eff = resolveEffectiveCredentials(s, projectId);
    const candidate = token?.trim() || eff.githubToken;
    if (!candidate) return { ok: false, error: "未配置 GitHub Token" };
    try {
      const res = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${candidate}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "Appilot",
        },
      });
      if (!res.ok) return { ok: false, error: `GitHub API ${res.status}` };
      const data: any = await res.json();
      return { ok: true, user: data.login || "" };
    } catch (err: any) {
      return { ok: false, error: err.message || "连接失败" };
    }
  });

  ipcMain.handle(
    "projects:testAscKey",
    async (
      _event,
      projectId: string,
      params?: { issuerId?: string; keyId?: string; privateKeyPath?: string },
    ) => {
      const s = await getStore();
      const eff = resolveEffectiveCredentials(s, projectId);
      const issuerId = params?.issuerId?.trim() || eff.ascIssuerId || "";
      const keyId = params?.keyId?.trim() || eff.ascKeyId || "";
      const keyPath = params?.privateKeyPath?.trim() || eff.ascPrivateKeyPath || "";
      if (!issuerId || !keyId || !keyPath) {
        return { ok: false, error: "App Store Connect Key 信息不完整（Issuer / Key ID / .p8 文件）" };
      }
      let pem = "";
      try {
        pem = fs.readFileSync(keyPath, "utf8");
      } catch {
        return { ok: false, error: "无法读取 .p8 私钥文件" };
      }
      try {
        const token = ascJwt(issuerId, keyId, pem);
        const res = await fetch("https://api.appstoreconnect.apple.com/v1/apps?limit=1", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return { ok: false, error: `App Store Connect API ${res.status}` };
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message || "连接失败" };
      }
    },
  );

  ipcMain.handle("projects:selectAscKeyFile", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择 App Store Connect API 私钥（.p8）",
      properties: ["openFile"],
      filters: [{ name: "App Store Connect Key", extensions: ["p8"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("projects:add", async (_event, localPath: string) => {
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const normalizedPath = normalizeLocalPath(localPath);
    const existingIndex = projects.findIndex(
      (p: any) => normalizeLocalPath(p.localPath) === normalizedPath,
    );

    const project: {
      id: string;
      name: string;
      localPath: string;
      productType: "ios" | "macos" | null;
      bundleId: string | null;
      trackId: string | null;
      trackName: string | null;
      artworkUrl: string | null;
      supportedLanguages: { code: string; name: string }[];
      storeLinks: { country: string; name: string; platform: "ios" | "macos" | "unknown"; url: string }[];
      trackedKeywords: { language: string; keyword: string; rationale: string; translation: string }[];
      submissionKeywords: { language: string; text: string }[];
      removedKeywords: { language: string; keyword: string; rationale: string; translation: string; removedAt: string }[];
      rankSnapshots: { keyword: string; language: string; storefront: string; rank: number | null; totalResults: number; checkedAt: string }[];
      storeProducts: {
        id: string;
        projectId: string;
        platform: "ios" | "macos" | "unknown";
        trackId: string | null;
        bundleId: string | null;
        trackName: string | null;
        artworkUrl: string | null;
        supportedLanguages: { code: string; name: string }[];
        storeLinks: { country: string; name: string; platform: "ios" | "macos" | "unknown"; url: string }[];
        trackedKeywords: { language: string; keyword: string; rationale: string; translation: string }[];
        submissionKeywords: { language: string; text: string }[];
        removedKeywords: { language: string; keyword: string; rationale: string; translation: string; removedAt: string }[];
        rankSnapshots: { keyword: string; language: string; storefront: string; rank: number | null; totalResults: number; checkedAt: string }[];
        createdAt: string;
      }[];
      createdAt: string;
    } = existingIndex >= 0
      ? { ...projects[existingIndex] }
      : {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          name: localPath.split("/").pop() || localPath,
          localPath,
          productType: null,
          bundleId: null,
          trackId: null,
          trackName: null,
          artworkUrl: null,
          supportedLanguages: [],
          storeLinks: [],
          trackedKeywords: [],
          submissionKeywords: [],
          removedKeywords: [],
          rankSnapshots: [],
          storeProducts: [],
          createdAt: new Date().toISOString(),
        };

    // Auto-analyze: detect product type, discover App Store link, resolve bundleId.
    try {
      const {
        detectApplePlatform,
        detectLocalizedLanguages,
        discoverAppStoreLinks,
        languageDisplayName,
        lookupApp,
        localizedStoreLinks,
      } = await import("@appilot/core/app-store-discovery");
      const languages = detectLocalizedLanguages(localPath);
      project.supportedLanguages = languages.map((code) => ({ code, name: languageDisplayName(code) }));
      const discovery = discoverAppStoreLinks(localPath);
      const detectedPlatform = detectApplePlatform(localPath);
      const products: any[] = [];

      if (discovery) {
        const localizedLinks = localizedStoreLinks(discovery.links);
        const byPlatform = new Map<string, typeof localizedLinks>();
        for (const link of localizedLinks) {
          const key = link.platform;
          if (!byPlatform.has(key)) byPlatform.set(key, []);
          byPlatform.get(key)?.push(link);
        }

        for (const [platform, links] of byPlatform.entries()) {
          const existingProduct = (project.storeProducts || []).find(
            (item: any) => item.id === `${project.id}:${platform}` || item.platform === platform,
          );
          const trackId = discovery.links.find((link) => {
            const linkPlatform = link.mt === "12" ? "macos" : link.mt === "8" ? "ios" : "unknown";
            return linkPlatform === platform;
          })?.trackId || null;
          const meta = trackId ? await lookupApp(trackId) : null;
          products.push({
            id: `${project.id}:${platform}`,
            projectId: project.id,
            platform,
            trackId,
            bundleId: meta?.bundleId ?? null,
            trackName: meta?.trackName ?? null,
            artworkUrl: meta?.artworkUrl ?? null,
            supportedLanguages: project.supportedLanguages,
            storeLinks: links,
            trackedKeywords: existingProduct?.trackedKeywords || [],
            submissionKeywords: existingProduct?.submissionKeywords || [],
            removedKeywords: existingProduct?.removedKeywords || [],
            rankSnapshots: existingProduct?.rankSnapshots || [],
            createdAt: project.createdAt,
          });
        }
      }

      if (products.length === 0) {
        const existingProduct = (project.storeProducts || []).find(
          (item: any) => item.platform === detectedPlatform || item.platform === "unknown",
        );
        products.push({
          id: `${project.id}:${detectedPlatform || "unknown"}`,
          projectId: project.id,
          platform: detectedPlatform || "unknown",
          trackId: null,
          bundleId: null,
          trackName: null,
          artworkUrl: null,
          supportedLanguages: project.supportedLanguages,
          storeLinks: [],
          trackedKeywords: existingProduct?.trackedKeywords || [],
          submissionKeywords: existingProduct?.submissionKeywords || [],
          removedKeywords: existingProduct?.removedKeywords || [],
          rankSnapshots: existingProduct?.rankSnapshots || [],
          createdAt: project.createdAt,
        });
      }

      project.storeProducts = products;
      const primary = products[0];
      project.productType = primary.platform === "unknown" ? null : primary.platform;
      project.trackId = primary.trackId;
      project.bundleId = primary.bundleId;
      project.trackName = primary.trackName;
      project.artworkUrl = primary.artworkUrl;
      project.storeLinks = primary.storeLinks;
    } catch (err: any) {
      log.warn(`Project analysis failed for ${localPath}: ${err.message}`);
    }

    try {
      const { collectRepoInfo } = await import("@appilot/core/git-info");
      (project as any).repo = await collectRepoInfo(localPath);
    } catch (err: any) {
      log.warn(`Repo info collection failed for ${localPath}: ${err.message}`);
    }

    // Re-read before writing: the analysis above awaits network calls, during
    // which concurrent handlers may have replaced the projects array.
    const latestProjects: any[] = s.get("projects") || [];
    const latestIndex = latestProjects.findIndex(
      (p: any) => normalizeLocalPath(p.localPath) === normalizedPath,
    );
    if (latestIndex >= 0) {
      latestProjects[latestIndex] = project;
    } else {
      latestProjects.push(project);
    }
    s.set("projects", latestProjects);
    void schedulerTick();
    notifyDataChanged("projects");
    emitProjectsChanged();
    return project;
  });

  ipcMain.handle("projects:remove", async (_event, id: string) => {
    const s = await getStore();
    const all = s.get("projects") || [];
    const removed = all.find((p: any) => p.id === id);
    const projects: any[] = (s.get("projects") || []).filter((p: any) => p.id !== id);
    s.set("projects", projects);
    // Drop the removed project's credential overrides and reclaim its .p8 copy.
    const creds = s.get("projectCredentials") || {};
    if (creds[id]) {
      delete creds[id];
      s.set("projectCredentials", creds);
    }
    garbageCollectKeys(s);
    // Remove the deleted project's scheduled tasks (both keyword-collection
    // rows and its project-level GitHub sync task) and its sync cache entry.
    if (removed) {
      const removedProductIds = new Set<string>(
        (removed.storeProducts || []).map((product: any) => product.id),
      );
      const tasks = filterTasksForRemovedProject(
        s.get("scheduledTasks") || [],
        removedProductIds,
        id,
      );
      s.set("scheduledTasks", tasks);
    }
    const syncCache = s.get("githubSyncCache") || {};
    if (syncCache[id]) {
      delete syncCache[id];
      s.set("githubSyncCache", syncCache);
    }
    void schedulerTick();
    notifyDataChanged("projects");
    emitProjectsChanged();
    return true;
  });

  ipcMain.handle("projects:generateKeywords", async (_event, productId: string, language: string) => {
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const context = findProductContext(projects, productId);
    if (!context) throw new Error("Store product not found");
    if (!language) throw new Error("Missing language");

    const provider = await createAiProvider(s);
    const { generateKeywords } = await import("@appilot/core/ai/keyword-suggester");
    const { readRepoDescription } = await import("@appilot/core/app-store-discovery");

    const description = readRepoDescription(context.project.localPath);
    const profile = await buildProjectProfileFor(context.project, context.product);
    const result = await generateKeywords(provider, {
      name: context.product.trackName || context.project.name,
      description,
      productType: context.product.platform || "unknown",
      language,
      uiLanguage: "zh-Hans",
      profile,
    }, (received) => {
      if (!_event.sender.isDestroyed()) {
        _event.sender.send("projects:keywordProgress", {
          productId,
          language,
          chars: received.chars,
          phase: received.phase,
        });
      }
    });
    return result;
  });

  ipcMain.handle("projects:curateKeywords", async (_event, productId: string, language: string) => {
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const context = findProductContext(projects, productId);
    if (!context) throw new Error("Store product not found");
    if (!language) throw new Error("Missing language");
    const { project, product } = context;

    const provider = await createAiProvider(s);
    const { curateKeywords } = await import("@appilot/core/ai/keyword-suggester");
    const { readRepoDescription } = await import("@appilot/core/app-store-discovery");

    const drafts = getStoreSubmissionDrafts(project)
      .filter((draft) => draft.productId === productId)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    const latest = drafts[0];
    const loc = latest?.localizations?.find((item: any) => item.language === language)
      || latest?.localizations?.[0];
    const submission = (project.submissionKeywords || []).find((item: any) => item.language === language);
    const submissionKeywords = (submission?.text || "")
      .split(",")
      .map((item: string) => item.trim())
      .filter(Boolean);
    const existingKeywords = (project.trackedKeywords || [])
      .filter((item: any) => item.language === language)
      .map((item: any) => ({
        keyword: item.keyword,
        language: item.language,
        bestRank: item.bestRank ?? null,
        lastSeenAt: item.lastSeenAt ?? null,
        status: item.status || "active",
      }));
    const removedKeywords = (project.removedKeywords || [])
      .filter((item: any) => item.language === language)
      .map((item: any) => item.keyword);
    const profile = await buildProjectProfileFor(project, product, loc?.subtitle || "");

    return curateKeywords(provider, {
      name: product.trackName || project.name,
      subtitle: loc?.subtitle || "",
      description: readRepoDescription(project.localPath),
      language,
      uiLanguage: "zh-Hans",
      existingKeywords,
      submissionKeywords,
      removedKeywords,
      profile,
    }, (received) => {
      if (!_event.sender.isDestroyed()) {
        _event.sender.send("projects:keywordProgress", {
          productId,
          language,
          chars: received.chars,
          phase: received.phase,
        });
      }
    });
  });

  ipcMain.handle("projects:getSubmissionReference", async (_event, productId: string, language: string) => {
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const context = findProductContext(projects, productId);
    if (!context) throw new Error("Store product not found");
    if (!language) throw new Error("Missing language");
    return submissionReferenceFor(context.product, context.project, language);
  });

  ipcMain.handle("projects:extractSubmissionCandidates", async (_event, productId: string, language: string, operationId = "") => {
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const context = findProductContext(projects, productId);
    if (!context) throw new Error("Store product not found");
    if (!language) throw new Error("Missing language");
    const { project, product } = context;
    const profile = await buildProjectProfileFor(project, product);
    const provider = await createAiProvider(s);
    const { extractSubmissionCandidates } = await import("@appilot/core/ai/keyword-suggester");

    const ref = submissionReferenceFor(product, project, language);
    const submissionTerms = (ref.submissionKeywords || "")
      .split(",")
      .map((item: string) => item.trim())
      .filter(Boolean)
      .map((keyword: string) => ({
        keyword,
        source: "submission" as const,
        rationale: "来自商店关键词",
      }));
    const aiCandidates = await withAiOperation(operationId, (signal) =>
      extractSubmissionCandidates(provider, {
        name: ref.name,
        subtitle: ref.subtitle,
        language,
        uiLanguage: "zh-Hans",
        profile,
      }, (received) => {
        if (!_event.sender.isDestroyed()) {
          _event.sender.send("projects:submissionProgress", {
            productId,
            language,
            chars: received.chars,
            phase: received.phase,
          });
        }
      }, signal),
    );
    return { candidates: [...submissionTerms, ...aiCandidates] };
  });

  ipcMain.handle("projects:saveTrackedKeywords", async (_event, productId: string, trackedKeywords: any[]) => {
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const context = findProductContext(projects, productId);
    if (!context) throw new Error("Store product not found");
    const nextProjects = updateProjectInProjects(projects, context.project.id, (project) => {
      const normalized = trackedKeywords.map((item: any) => normalizeTrackedKeyword(item));
      // 全量保存时，把“旧列表有、新列表无”的关键词记入已删除历史（可恢复），
      // 与单条删除行为保持一致。
      const oldItems = project.trackedKeywords || [];
      const newKeys = new Set(
        normalized.map((k: any) => `${k.language}\u0000${k.keyword}`),
      );
      const removedKeywords = [...(project.removedKeywords || [])];
      for (const item of oldItems) {
        const key = `${item.language}\u0000${item.keyword}`;
        if (newKeys.has(key)) continue;
        if (
          removedKeywords.some(
            (r: any) => `${r.language}\u0000${r.keyword}` === key,
          )
        ) {
          continue;
        }
        removedKeywords.push({
          language: item.language,
          keyword: item.keyword,
          rationale: item.rationale || "",
          translation: item.translation || "",
          removedAt: new Date().toISOString(),
        });
      }
      return { trackedKeywords: normalized, removedKeywords };
    });
    s.set("projects", nextProjects);
    void schedulerTick();
    notifyDataChanged("projects");
    return nextProjects.find((project) => project.id === context.project.id) || context.project;
  });

  ipcMain.handle("projects:saveSubmissionKeywords", async (_event, productId: string, submissionKeywords: any[]) => {
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const context = findProductContext(projects, productId);
    if (!context) throw new Error("Store product not found");
    const nextProjects = updateProjectInProjects(projects, context.project.id, (_project) => ({
      submissionKeywords,
    }));
    s.set("projects", nextProjects);
    void schedulerTick();
    notifyDataChanged("projects");
    return nextProjects.find((project) => project.id === context.project.id) || context.project;
  });

  ipcMain.handle("projects:removeTrackedKeyword", async (_event, productId: string, language: string, keyword: string) => {
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const context = findProductContext(projects, productId);
    if (!context) throw new Error("Store product not found");
    const nextProjects = updateProjectInProjects(projects, context.project.id, (project) => {
      const removedKeyword = (project.trackedKeywords || []).find(
        (item: any) => item.language === language && item.keyword === keyword,
      );
      const trackedKeywords = (project.trackedKeywords || []).filter(
        (item: any) => !(item.language === language && item.keyword === keyword),
      );
      const removedKeywords = Array.isArray(project.removedKeywords) ? [...project.removedKeywords] : [];
      if (!removedKeywords.some((item: any) => item.language === language && item.keyword === keyword)) {
        removedKeywords.push({
          language,
          keyword,
          rationale: removedKeyword?.rationale || "",
          translation: removedKeyword?.translation || "",
          removedAt: new Date().toISOString(),
        });
      }
      return { trackedKeywords, removedKeywords };
    });
    s.set("projects", nextProjects);
    void schedulerTick();
    notifyDataChanged("projects");
    return nextProjects.find((project) => project.id === context.project.id) || context.project;
  });

  // 待处理暂停复核队列：列出命中“连续未在榜”但等待人工分类的关键词
  // （按 关键词 × 平台），并给出规则层的分类建议。
  ipcMain.handle("projects:pendingPauseList", async (_event, projectId: string) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const project = projects.find((item: any) => item.id === projectId);
    if (!project) return [];
    const { readFullReadme } = await import("@appilot/core/app-store-discovery");
    let readme = "";
    try {
      readme = project.localPath ? readFullReadme(project.localPath) : "";
    } catch {
      readme = "";
    }
    const entries: any[] = [];
    for (const keyword of project.trackedKeywords || []) {
      const pending = keyword.pendingPausePlatforms || [];
      // 历史自动暂停（原因含“连续”，且尚未复核）也进入复核队列，便于
      // 重新分类（例如列为文案缺口）。
      const pausedLegacy = (keyword.pausedPlatforms || []).filter(
        () =>
          !keyword.pauseReviewedAt &&
          String(keyword.pausedReason || "").includes("连续"),
      );
      const platforms = Array.from(new Set([...pending, ...pausedLegacy]));
      if (platforms.length === 0) continue;
      // 文案字段（跨产品草稿 + trackName）用于“是否已覆盖”判断。
      const copyTexts: string[] = [];
      for (const product of project.storeProducts || []) {
        copyTexts.push(String(product.trackName || ""));
        for (const draft of project.storeSubmissionDrafts || []) {
          if (draft.productId !== product.id) continue;
          for (const loc of draft.localizations || []) {
            for (const field of [
              "name",
              "subtitle",
              "promotionalText",
              "description",
              "whatsNew",
              "keywords",
            ]) {
              if (String(loc[field] || "")) copyTexts.push(String(loc[field]));
            }
          }
        }
      }
      const needle = String(keyword.keyword || "").trim().toLowerCase();
      const covered = needle
        ? copyTexts.some((text) => String(text).toLowerCase().includes(needle))
        : false;
      const inReadme = needle ? readme.toLowerCase().includes(needle) : false;
      for (const platform of platforms) {
        // 用当前快照重新生成原因（商店显示名称），而不是历史缩写。
        const product = (project.storeProducts || []).find(
          (p: any) => (p.platform || "unknown") === platform,
        );
        const evaluated = evaluatePause(
          keyword,
          product?.rankSnapshots || [],
        );
        const reason =
          evaluated.pausedReason ||
          keyword.pendingPauseReason ||
          keyword.pausedReason ||
          "连续未在榜";
        entries.push({
          language: keyword.language,
          keyword: keyword.keyword,
          translation: keyword.translation || null,
          platform,
          reason,
          state: pending.includes(platform) ? "pending" : "paused",
          suggestion: covered
            ? "competitive"
            : inReadme
              ? "copy-gap"
              : "off-topic",
          suggestionDetail: covered
            ? "文案中已出现该关键词，排名不佳更可能是竞争或权重原因"
            : inReadme
              ? "产品档案提到该关键词，但商店文案未覆盖——可能是文案缺口"
              : "文案与产品档案均未出现，可能与产品无关",
        });
      }
    }
    return entries;
  });

  // 把单个关键词翻译成界面语言（简体中文），并持久化到该关键词的
  // translation 字段，之后所有显示位置都能用 ruby 标注。
  ipcMain.handle(
    "projects:translateKeyword",
    async (
      _event,
      productId: string,
      language: string,
      keywordText: string,
    ) => {
      const s = await getStore();
      const projects: any[] = s.get("projects") || [];
      const context = findProductContext(projects, productId);
      if (!context) throw new Error("Store product not found");
      const project = context.project;
      const item = (project.trackedKeywords || []).find(
        (k: any) => k.language === language && k.keyword === keywordText,
      );
      if (!item) throw new Error("Keyword not found");
      if (item.translation && item.translation.trim()) {
        return { translation: item.translation };
      }
      const { createAiProvider } = await import("../ai-service");
      const provider = await createAiProvider(s);
      const translated = (
        await provider.chat(
          [
            {
              role: "system",
              content: "你是 App Store 关键词翻译助手，只输出译文本身。",
            },
            {
              role: "user",
              content: `把下面的 App Store 关键词翻译成简体中文（界面语言）。只输出译文，不要解释、不要引号、不要加注。\n关键词：${keywordText}`,
            },
          ] as any,
          { temperature: 0.2, maxTokens: 200 },
        )
      )
        .trim()
        .replace(/^["'“”]+|["'“”]+$/g, "");
      if (!translated) throw new Error("翻译失败，请重试");
      item.translation = translated;
      s.set("projects", projects);
      return { translation: translated };
    },
  );

  // 批量翻译：为当前项目所有“非中文且缺译文”的关键词补全译文（一次性任务，
  // 可重入——已有译文的跳过）。逐条持久化，避免中断丢失进度。
  ipcMain.handle("projects:translateKeywords", async (event, projectId: string) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const project = projects.find((item: any) => item.id === projectId);
    if (!project) throw new Error("Project not found");
    const { createAiProvider } = await import("../ai-service");
    const provider = await createAiProvider(s);
    const pending = (project.trackedKeywords || []).filter(
      (k: any) =>
        k.language !== "zh-Hans" &&
        k.language !== "zh-Hant" &&
        !(k.translation && String(k.translation).trim()),
    );
    const total = pending.length;
    let done = 0;
    let translated = 0;
    for (const item of pending) {
      try {
        const text = (
          await provider.chat(
            [
              {
                role: "system",
                content: "你是 App Store 关键词翻译助手，只输出译文本身。",
              },
              {
                role: "user",
                content: `把下面的 App Store 关键词翻译成简体中文（界面语言）。只输出译文，不要解释、不要引号、不要加注。\n关键词：${item.keyword}`,
              },
            ] as any,
            { temperature: 0.2, maxTokens: 200 },
          )
        )
          .trim()
          .replace(/^["'“”]+|["'“”]+$/g, "");
        if (text) {
          item.translation = text;
          translated += 1;
        }
      } catch (err: any) {
        log.warn(`Keyword translation failed for ${item.keyword}: ${err.message}`);
      }
      done += 1;
      if (!event.sender.isDestroyed()) {
        event.sender.send("projects:translateKeywordsProgress", { done, total });
      }
      if (done % 10 === 0 || done === total) s.set("projects", projects);
    }
    s.set("projects", projects);
    notifyDataChanged("projects");
    return { total, translated };
  });

  // 名称/副标题修改建议（发布前、多语言）：结合各语言的文案缺口，给出
  // “当前名称/副标题 → 建议名称/副标题”，提示用户在提交前同步到代码与商店。
  ipcMain.handle(
    "projects:generateNameSubtitleSuggestions",
    async (_event, productId: string) => {
      const s = await getStore();
      const projects: any[] = s.get("projects") || [];
      const context = findProductContext(projects, productId);
      if (!context) throw new Error("Store product not found");
      const { project, product } = context;
      const drafts = (project.storeSubmissionDrafts || [])
        .filter((draft: any) => draft.productId === productId)
        .sort(
          (a: any, b: any) =>
            new Date(b.updatedAt || 0).getTime() -
            new Date(a.updatedAt || 0).getTime(),
        );
      const latestDraft = drafts[0] || null;
      const locByName = new Map<string, any>(
        (latestDraft?.localizations || []).map((loc: any) => [
          loc.language,
          loc,
        ]),
      );
      const gapsByLanguage: Record<string, string[]> = {};
      for (const gap of project.copyGapKeywords || []) {
        const lang = String(gap.language || "");
        if (!lang) continue;
        (gapsByLanguage[lang] = gapsByLanguage[lang] || []).push(
          String(gap.keyword || ""),
        );
      }
      const languages = (product.supportedLanguages || []).map((l: any) =>
        String(l?.code || ""),
      );
      const inputs: {
        language: string;
        currentName: string;
        currentSubtitle: string;
        gapKeywords: string[];
      }[] = languages.filter(Boolean).map((language: string) => {
        const current = locByName.get(language) || null;
        return {
          language,
          currentName: current?.name || product.trackName || "",
          currentSubtitle: current?.subtitle || "",
          gapKeywords: gapsByLanguage[language] || [],
        };
      });
      if (inputs.length === 0) return [];

      const { createAiProvider } = await import("../ai-service");
      const { parseJsonObject } = await import("@appilot/core/ai/ai-request");
      const provider = await createAiProvider(s);
      const prompt = [
        "你是 App Store 的 ASO 顾问。根据每个语言当前的名称/副标题与文案缺口关键词，给出发布前应采用的名称/副标题修改建议。",
        "规则：",
        "- 名称 ≤30 字符、副标题 ≤30 字符；",
        "- 保留品牌名主体（如 “AI Pulse” 部分）不变，只调整描述性后缀；",
        "- 把该语言最重要的 1-2 个文案缺口关键词自然融入名称或副标题（不堆砌）；",
        "- 该语言没有缺口关键词时，建议保持当前值（suggestedName=suggestedSubtitle=当前值，reason=无文案缺口）；",
        "- reason 用简体中文一句话说明修改意图。",
        "只输出 JSON：{\"suggestions\":[{\"language\":\"...\",\"suggestedName\":\"...\",\"suggestedSubtitle\":\"...\",\"reason\":\"...\"}]}",
      ].join("\n");
      const payload = JSON.stringify({ inputs }, null, 2);
      const raw = await provider.chat(
        [
          { role: "system", content: prompt },
          { role: "user", content: `各语言当前信息与缺口关键词：\n${payload}` },
        ] as any,
        { temperature: 0.3, maxTokens: 4000 },
      );
      const data = parseJsonObject(raw);
      const suggestions = Array.isArray(data?.suggestions)
        ? data.suggestions
            .filter((item: any) => item?.language)
            .map((item: any) => ({
              language: String(item.language),
              suggestedName: String(item.suggestedName || ""),
              suggestedSubtitle: String(item.suggestedSubtitle || ""),
              reason: String(item.reason || ""),
              gapKeywords: gapsByLanguage[String(item.language)] || [],
            }))
        : [];
      const now = new Date().toISOString();
      const next = inputs.map((input) => {
        const suggestion =
          suggestions.find(
            (item: any) => item.language === input.language,
          ) || null;
        return {
          language: input.language,
          currentName: input.currentName,
          currentSubtitle: input.currentSubtitle,
          suggestedName: suggestion?.suggestedName || input.currentName,
          suggestedSubtitle:
            suggestion?.suggestedSubtitle || input.currentSubtitle,
          reason: suggestion?.reason || "无文案缺口",
          gapKeywords: suggestion?.gapKeywords || input.gapKeywords,
          status: "pending" as const,
          createdAt: now,
        };
      });
      project.nameSubtitleSuggestions = next;
      s.set("projects", projects);
      notifyDataChanged("projects");
      return next;
    },
  );

  // 忽略某语言的名称/副标题建议（下次重新生成时重置）。
  ipcMain.handle(
    "projects:dismissNameSuggestion",
    async (_event, projectId: string, language: string) => {
      projectId = assertNonEmptyString(projectId, "projectId");
      language = assertNonEmptyString(language, "language");
      const s = await getStore();
      const projects: any[] = s.get("projects") || [];
      const project = projects.find((item: any) => item.id === projectId);
      if (!project) throw new Error("Project not found");
      project.nameSubtitleSuggestions = (project.nameSubtitleSuggestions || []).map(
        (item: any) =>
          item.language === language ? { ...item, status: "dismissed" } : item,
      );
      s.set("projects", projects);
      notifyDataChanged("projects");
      return true;
    },
  );

  // 发布前检查单：自动检查（版本一致性、权限用途说明）+ 发布前素材
  // （名称/副标题/截图建议，多语言），全部持久化到项目。
  ipcMain.handle(
    "projects:generatePreReleaseChecklist",
    async (_event, productId: string) => {
      const s = await getStore();
      const projects: any[] = s.get("projects") || [];
      const context = findProductContext(projects, productId);
      if (!context) throw new Error("Store product not found");
      const { project, product } = context;

      // ── 自动检查：读仓库 Info.plist / project.pbxproj / entitlements ──
      const findProjectFiles = (dir: string, depth: number): string[] => {
        if (depth > 5 || !dir) return [];
        let entries: any[] = [];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return [];
        }
        const results: string[] = [];
        for (const entry of entries) {
          if (
            entry.name.startsWith(".") ||
            entry.name === "node_modules" ||
            entry.name === ".git" ||
            entry.name === "DerivedData"
          ) {
            continue;
          }
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) results.push(...findProjectFiles(full, depth + 1));
          else if (
            entry.name.endsWith(".plist") ||
            entry.name.endsWith(".pbxproj") ||
            entry.name.endsWith(".entitlements") ||
            entry.name.endsWith(".xcstrings")
          ) {
            results.push(full);
          }
        }
        return results;
      };
      let codeVersion: string | null = null;
      let codeBuildNumber: string | null = null;
      const permissionKeys: string[] = [];
      const capabilityKeys: string[] = [];
      const xcstringsFiles: string[] = [];
      for (const filePath of findProjectFiles(project.localPath, 0)) {
        try {
          const content = fs.readFileSync(filePath, "utf8");
          if (filePath.endsWith(".plist")) {
            codeVersion = codeVersion || parsePlistVersion(content);
            permissionKeys.push(...plistPermissionKeys(content));
          } else if (filePath.endsWith(".pbxproj")) {
            codeVersion = codeVersion || parsePbxprojVersion(content);
            codeBuildNumber =
              codeBuildNumber || parsePbxprojBuildNumber(content);
            permissionKeys.push(...pbxprojPermissionKeys(content));
          } else if (filePath.endsWith(".entitlements")) {
            capabilityKeys.push(...entitlementKeys(content));
          } else if (filePath.endsWith(".xcstrings")) {
            xcstringsFiles.push(content);
          }
        } catch {
          // 单个文件读取失败忽略
        }
      }
      const drafts = (project.storeSubmissionDrafts || [])
        .filter((draft: any) => draft.productId === productId)
        .sort(
          (a: any, b: any) =>
            new Date(b.updatedAt || 0).getTime() -
            new Date(a.updatedAt || 0).getTime(),
        );
      const targetVersion = drafts[0]?.appVersion || null;
      const targetBuildNumber = drafts[0]?.buildNumber || null;
      const versionCheck = versionConsistencyCheck(codeVersion, targetVersion);
      const buildCheck = buildNumberConsistencyCheck(
        codeBuildNumber,
        targetBuildNumber,
      );
      const uniquePermissionKeys = Array.from(new Set(permissionKeys));
      const coverage: Record<string, number> = {};
      for (const key of COMMON_PERMISSION_KEYS) {
        const count = Math.max(
          ...xcstringsFiles.map((content) =>
            xcstringsLocalizationCount(content, key),
          ),
        );
        if (count > 0) coverage[key] = count;
      }
      const permCheck = permissionsCheck(uniquePermissionKeys, coverage);
      if (capabilityKeys.length > 0) {
        permCheck.items.push(
          ...Array.from(new Set(capabilityKeys)).map((key) => ({
            label: capabilityLabel(key),
            kind: "capability" as const,
          })),
        );
        permCheck.detail += `，另有 ${Array.from(new Set(capabilityKeys)).length} 项能力`;
      }
      // 构建产物（Archive）检查：在默认 Archives（*.xcarchive）、DerivedData
      // 与 /tmp 中定向遍历 .app（只进入 Build/Products/Applications、xcarchive、
      // 日期目录与临时 Derived 目录，跳过 DerivedSources 等大目录，保证秒回），
      // 按 bundleId 匹配后核对版本号与构建号。
      let builtApp: { version: string | null; build: string | null } | null =
        null;
      {
        const os = await import("os");
        const home = os.homedir();
        const roots = [
          {
            root: path.join(home, "Library/Developer/Xcode/Archives"),
            topFilter: /^\d{4}-\d{2}-\d{2}/,
          },
          {
            root: path.join(home, "Library/Developer/Xcode/DerivedData"),
            topFilter: null,
          },
          { root: "/tmp", topFilter: /Derived/i },
        ];
        const findProductApps = (
          root: string,
          topFilter: RegExp | null,
        ): string[] => {
          const apps: string[] = [];
          const visit = (dir: string, depth: number) => {
            if (depth > 5) return;
            let entries: any[] = [];
            try {
              entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
              return;
            }
            for (const entry of entries) {
              if (!entry.isDirectory()) continue;
              const full = path.join(dir, entry.name);
              if (entry.name.endsWith(".app")) {
                apps.push(full);
                continue;
              }
              if (depth === 0) {
                if (topFilter && !topFilter.test(entry.name)) continue;
                visit(full, 1);
                continue;
              }
              const lower = entry.name.toLowerCase();
              const allowed =
                entry.name.endsWith(".xcarchive") ||
                lower === "build" ||
                lower === "products" ||
                lower === "applications" ||
                lower.startsWith("release-") ||
                lower.startsWith("debug-") ||
                /^\d{4}-\d{2}-\d{2}/.test(entry.name);
              if (allowed) visit(full, depth + 1);
            }
          };
          visit(root, 0);
          return apps;
        };
        const findBuiltApp = (): {
          version: string | null;
          build: string | null;
        } | null => {
          for (const { root, topFilter } of roots) {
            for (const appDir of findProductApps(root, topFilter)) {
              for (const plistPath of [
                path.join(appDir, "Info.plist"),
                path.join(appDir, "Contents", "Info.plist"),
              ]) {
                try {
                  const content = fs.readFileSync(plistPath, "utf8");
                  if (parsePlistBundleId(content) === product.bundleId) {
                    return {
                      version: parsePlistVersion(content),
                      build: parsePlistBundleVersion(content),
                    };
                  }
                } catch {
                  // 单个 plist 读取失败忽略
                }
              }
            }
          }
          return null;
        };
        builtApp = findBuiltApp();
      }
      const archiveCheckResult = archiveCheck(
        builtApp,
        targetVersion,
        targetBuildNumber,
      );
      const checks = [
        {
          id: "version-consistency",
          label: "版本一致性（代码 vs 目标）",
          ...versionCheck,
        },
        {
          id: "build-number",
          label: "构建号一致性（代码 vs 目标）",
          ...buildCheck,
        },
        {
          id: "archive",
          label: "构建产物（Archive）版本匹配",
          ...archiveCheckResult,
        },
        {
          id: "permissions",
          label: "权限与能力声明（Info.plist / entitlements）",
          ...permCheck,
        },
        {
          id: "prep-gaps",
          label: "待复核暂停 / 文案缺口",
          ...(() => {
            const pendingPauseCount = (project.trackedKeywords || []).filter(
              (k: any) =>
                (k.pendingPausePlatforms || []).includes(product.platform),
            ).length;
            const copyGapCount = (project.copyGapKeywords || []).length;
            const openCount = pendingPauseCount + copyGapCount;
            return {
              status: (openCount > 0 ? "warn" : "pass") as "warn" | "pass",
              detail:
                openCount > 0
                  ? `${pendingPauseCount} 个关键词待复核暂停，${copyGapCount} 个文案缺口未处理`
                  : "无待复核暂停关键词、无未处理文案缺口",
            };
          })(),
        },
      ];

      // ── 发布前素材：截图建议（多语言）。名称/副标题建议属于发布文案，
      // 不在检查单中重复（商店名称/副标题只影响 ASC，与代码无关）。──
      // 支持语言从“当前分支”的仓库重新检测并与已存语言合并：分支新增语言
      // 无需等 PR 合并即可被识别（本地工作区即当前分支）。检测失败不静默。
      let detectedLanguages: string[] = [];
      let languageDisplayNameFn: (code: string) => string = (code) => code;
      try {
        const { detectLocalizedLanguages, languageDisplayName } = await import(
          "@appilot/core/app-store-discovery"
        );
        detectedLanguages = detectLocalizedLanguages(project.localPath) || [];
        languageDisplayNameFn = languageDisplayName;
        log.warn(
          `Checklist language detection: ${detectedLanguages.length} languages detected for ${project.localPath}`,
        );
      } catch (err: any) {
        log.warn(`Checklist language detection failed: ${err.message}`);
      }
      const stored = (product.supportedLanguages || []).map((l: any) =>
        String(l?.code || ""),
      );
      // 直接取并集用于本次生成，并持久化回产品，让整个应用识别新语言。
      const languages = Array.from(new Set([...stored, ...detectedLanguages]));
      if (languages.length !== stored.length) {
        product.supportedLanguages = languages.map((code) => ({
          code,
          name: languageDisplayNameFn(code),
        }));
        project.supportedLanguages = product.supportedLanguages;
      }
      const now = new Date().toISOString();
      project.preReleaseChecklist = {
        updatedAt: now,
        checks,
      };
      s.set("projects", projects);
      notifyDataChanged("projects");
      return project.preReleaseChecklist;
    },
  );

  // 处理待处理暂停：resume 恢复跟踪 / pause 最终暂停 / remove 移除（无关词）
  // / copy-gap 列入文案素材并暂停该平台。
  ipcMain.handle(
    "projects:reviewPendingPause",
    async (
      _event,
      productId: string,
      language: string,
      keywordText: string,
      platform: string,
      action: "resume" | "pause" | "remove" | "copy-gap",
    ) => {
      const s = await getStore();
      const projects: any[] = s.get("projects") || [];
      const context = findProductContext(projects, productId);
      if (!context) throw new Error("Store product not found");
      const nextProjects = updateProjectInProjects(projects, context.project.id, (project) => {
        const keyword = (project.trackedKeywords || []).find(
          (item: any) =>
            item.language === language && item.keyword === keywordText,
        );
        if (!keyword) throw new Error("Keyword not found");
        const pending = (keyword.pendingPausePlatforms || []).filter(
          (item: string) => item !== platform,
        );
        const paused = Array.isArray(keyword.pausedPlatforms)
          ? keyword.pausedPlatforms
          : [];
        const now = new Date().toISOString();
        if (action === "resume") {
          // 恢复跟踪：同时从待处理与（历史自动）暂停中移除该平台。
          keyword.pendingPausePlatforms = pending;
          if (pending.length === 0) keyword.pendingPauseReason = null;
          keyword.pausedPlatforms = paused.filter(
            (item: string) => item !== platform,
          );
          keyword.pauseReviewedAt = now;
          return { trackedKeywords: project.trackedKeywords };
        }
        if (action === "pause" || action === "copy-gap") {
          keyword.pausedPlatforms = paused.includes(platform)
            ? paused
            : [...paused, platform];
          keyword.pausedReason =
            keyword.pendingPauseReason || keyword.pausedReason || "手动暂停";
          keyword.pendingPausePlatforms = pending;
          if (pending.length === 0) keyword.pendingPauseReason = null;
          keyword.pauseReviewedAt = now;
          if (action === "copy-gap") {
            const gaps = Array.isArray(project.copyGapKeywords)
              ? [...project.copyGapKeywords]
              : [];
            if (
              !gaps.some(
                (item: any) =>
                  item.language === language && item.keyword === keywordText,
              )
            ) {
              gaps.push({
                language,
                keyword: keywordText,
                translation: keyword.translation || "",
                reason: keyword.pendingPauseReason || "排名不佳，文案未覆盖",
                addedAt: new Date().toISOString(),
              });
            }
            return { trackedKeywords: project.trackedKeywords, copyGapKeywords: gaps };
          }
          return { trackedKeywords: project.trackedKeywords };
        }
        if (action === "remove") {
          // 无关词：从池中移除（全局），并记录删除历史。
          const removedKeywords = Array.isArray(project.removedKeywords)
            ? [...project.removedKeywords]
            : [];
          if (
            !removedKeywords.some(
              (item: any) =>
                item.language === language && item.keyword === keywordText,
            )
          ) {
            removedKeywords.push({
              language,
              keyword: keywordText,
              rationale: keyword.rationale || "",
              translation: keyword.translation || "",
              removedAt: new Date().toISOString(),
            });
          }
          return {
            trackedKeywords: (project.trackedKeywords || []).filter(
              (item: any) =>
                !(item.language === language && item.keyword === keywordText),
            ),
            removedKeywords,
          };
        }
        return { trackedKeywords: project.trackedKeywords };
      });
      s.set("projects", nextProjects);
      void schedulerTick();
      notifyDataChanged("projects");
      return nextProjects.find((project) => project.id === context.project.id) || context.project;
    },
  );

  ipcMain.handle("projects:restoreTrackedKeyword", async (_event, productId: string, language: string, keyword: string) => {
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const context = findProductContext(projects, productId);
    if (!context) throw new Error("Store product not found");
    const nextProjects = updateProjectInProjects(projects, context.project.id, (project) => {
      const removedItem = (project.removedKeywords || []).find(
        (item: any) => item.language === language && item.keyword === keyword,
      );
      if (!removedItem) throw new Error("Keyword is not in removed list");
      const trackedKeywords = [...(project.trackedKeywords || [])];
      if (!trackedKeywords.some((item: any) => item.language === language && item.keyword === keyword)) {
        trackedKeywords.push({
          language,
          keyword,
          rationale: removedItem.rationale || "",
          translation: removedItem.translation || "",
        });
      }
      const removedKeywords = (project.removedKeywords || []).filter(
        (item: any) => !(item.language === language && item.keyword === keyword),
      );
      return { trackedKeywords, removedKeywords };
    });
    s.set("projects", nextProjects);
    void schedulerTick();
    notifyDataChanged("projects");
    return nextProjects.find((project) => project.id === context.project.id) || context.project;
  });

  ipcMain.handle("projects:resumePausedKeyword", async (_event, productId: string, language: string, keyword: string) => {
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const context = findProductContext(projects, productId);
    if (!context) throw new Error("Store product not found");
    const nextProjects = updateProjectInProjects(projects, context.project.id, (project) => {
      const paused = (project.trackedKeywords || []).find(
        (item: any) => item.language === language && item.keyword === keyword,
      );
      if (!paused) throw new Error("Keyword is not paused");
      const platformKey = context.product.platform || "unknown";
      const pausedPlatforms = Array.isArray(paused.pausedPlatforms)
        ? paused.pausedPlatforms.filter((item: string) => item !== platformKey)
        : [];
      const manualPause = paused.status === "paused";
      return {
        trackedKeywords: (project.trackedKeywords || []).map((item: any) =>
          item.language === language && item.keyword === keyword
            ? {
                ...item,
                status: manualPause ? "active" : item.status,
                pausedAt: manualPause ? null : item.pausedAt,
                pausedReason: manualPause || pausedPlatforms.length === 0 ? null : item.pausedReason,
                pausedPlatforms,
              }
            : item,
        ),
      };
    });
    s.set("projects", nextProjects);
    void schedulerTick();
    notifyDataChanged("projects");
    return nextProjects.find((project) => project.id === context.project.id) || context.project;
  });

  ipcMain.handle("projects:clearRemovedKeywords", async (_event, productId: string, languages: string[]) => {
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const context = findProductContext(projects, productId);
    if (!context) throw new Error("Store product not found");
    const languageSet = new Set(Array.isArray(languages) ? languages : []);
    const nextProjects = updateProjectInProjects(projects, context.project.id, (project) => ({
      removedKeywords: (project.removedKeywords || []).filter(
        (item: any) => !languageSet.has(item.language),
      ),
    }));
    s.set("projects", nextProjects);
    void schedulerTick();
    notifyDataChanged("projects");
    return nextProjects.find((project) => project.id === context.project.id) || context.project;
  });

  ipcMain.handle("projects:generateBrief", async (_event, projectId: string, productId: string) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    productId = assertNonEmptyString(productId, "productId");
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const context = findProductContext(projects, productId);
    if (!context) throw new Error("Store product not found");
    const { project, product } = context;

    const provider = await createAiProvider(s);
    const { generateOverviewBrief } = await import("@appilot/core/ai/overview-brief");
    const { buildBriefInput } = await import("@appilot/core/overview-summary");
    const { readRepoDescription } = await import("@appilot/core/app-store-discovery");
    const { checkForRelease } = await import("@appilot/core/release-watcher");
    const { competitorDeltaSummary } = await import("@appilot/core/competitor-radar");

    const releaseResult = await checkForRelease(
      project.localPath,
      project.lastReleaseSha || null,
      resolveEffectiveCredentials(s, project.id).githubToken,
      { githubCache: githubSyncCacheEntry(s, project) ?? undefined },
    );
    const drafts = getStoreSubmissionDrafts(project)
      .filter((item: any) => item.productId === productId)
      .sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    const submissionDraft = drafts[0] || null;
    const description = readRepoDescription(project.localPath);
    const profile = await buildProjectProfileFor(project, product, undefined, description);

    const input = buildBriefInput({
      projectName: project.name,
      productName: product.trackName || project.name,
      description,
      platform: product.platform || "unknown",
      supportedLanguages: (product.supportedLanguages || []).map((l: any) => l.code),
      trackedKeywords: ensureProjectKeywordPool(project).trackedKeywords || [],
      rankSnapshots: product.rankSnapshots || [],
      releaseDraft: releaseResult.latest
        ? { name: releaseResult.latest.name, tag: releaseResult.latest.tag }
        : null,
      submissionDraft,
      submissionKeywords: project.submissionKeywords || [],
      feedbackThemes: ((s.get("feedback") || {})[projectId]?.themes || []).map((theme: any) => ({
        title: theme.title,
        evidenceCount: theme.evidenceCount,
        topQuotes: (theme.sampleQuotes || []).slice(0, 2),
      })),
      competitorDeltas: (() => {
        const competitors = (s.get("competitors") || {})[projectId] || [];
        const snapshots = (s.get("competitorSnapshots") || {})[projectId] || {};
        const deltas: { name: string; change: string }[] = [];
        for (const competitor of competitors) {
          const delta = competitorDeltaSummary(competitor, snapshots[competitor.id] || []);
          if (delta) deltas.push(delta);
        }
        return deltas;
      })(),
      profile,
    });

    const suggestions = await generateOverviewBrief(provider, input, (received) => {
      if (!_event.sender.isDestroyed()) {
        _event.sender.send("projects:briefProgress", {
          chars: received.chars,
          phase: received.phase,
        });
      }
    });
    return { suggestions, generatedAt: new Date().toISOString() };
  });

  ipcMain.handle(
    "projects:recordBriefAction",
    async (_event, projectId: string, payload: { id: string; action: string; status: string }) => {
      projectId = assertNonEmptyString(projectId, "projectId");
      const actionId = assertNonEmptyString(payload?.id, "id");
      const action = assertNonEmptyString(payload?.action, "action");
      const status = payload?.status === "ignored" ? "ignored" : "adopted";
      const s = await getStore();
      const projects: any[] = s.get("projects") || [];
      const index = projects.findIndex((p: any) => p.id === projectId);
      if (index < 0) throw new Error("Project not found");
      const project = projects[index];
      const existing = Array.isArray(project.briefActions) ? project.briefActions : [];
      const rest = existing.filter((item: any) => item.id !== actionId);
      project.briefActions = [
        { id: actionId, action, status, createdAt: new Date().toISOString() },
        ...rest,
      ].slice(0, 200);
      projects[index] = project;
      s.set("projects", projects);
      emitProjectsChanged();
      return project;
    },
  );

  ipcMain.handle("projects:collectRanks", async (event, productId: string, language?: string, storefront?: string) => {
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const context = findProductContext(projects, productId);
    if (!context) throw new Error("Store product not found");
    const { project, product } = context;
    if (!product.trackId) throw new Error("缺少 App Store Track ID，请先确认 README 中的商店链接。");

    let keywords: any[] = ensureProjectKeywordPool(project).trackedKeywords || [];
    if (typeof language === "string" && language) {
      const queryLanguages = language === "en" ? ["en"] : [language, "en"];
      keywords = keywords.filter((keyword: any) => queryLanguages.includes(keyword.language));
    }
    if (keywords.length === 0) throw new Error("还没有跟踪关键词，请先生成或添加关键词。");

    const allowedStorefronts = typeof language === "string" && language
      ? storefrontsForLanguage(language)
      : [];
    const requestedStorefront = typeof storefront === "string" && storefront
      ? storefront.toLowerCase()
      : null;

    if (requestedStorefront && allowedStorefronts.length > 0 && !allowedStorefronts.includes(requestedStorefront)) {
      throw new Error(`商店 ${requestedStorefront.toUpperCase()} 不属于语言 ${language}，请重新选择。`);
    }

    const storefronts: string[] = requestedStorefront
      ? [requestedStorefront]
      : (allowedStorefronts.length > 0 ? allowedStorefronts : ["us"]);
    if (storefronts.length === 0) storefronts.push("us");

    const { lookupApp } = await import("@appilot/core/app-store-discovery");
    const metadata = await lookupApp(product.trackId);
    const entity: "software" | "macSoftware" = metadata?.kind === "mac-software" ? "macSoftware" : "software";
    if (metadata?.kind) {
      product.kind = metadata.kind;
    }

    const targets = keywords.flatMap((keyword: any) =>
      storefronts.map((storefront: string) => ({
        keyword: keyword.keyword,
        language: keyword.language || "unknown",
        storefront,
      })),
    );

    const { collectKeywordRankings } = await import("@appilot/core/rank-collector");
    const result = await collectKeywordRankings({
      targets,
      trackId: product.trackId,
      productType: product.platform,
      entity,
      delayMs: 1000,
      onProgress: (progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send("projects:collectRanksProgress", progress);
        }
      },
    });

    // Re-read before writing: the product captured before the network call may
    // be stale (concurrent handlers can replace the whole projects array).
    const latestProjects: any[] = s.get("projects") || [];
    const latestProduct = latestProjects
      .flatMap((p: any) => p.storeProducts || [])
      .find((item: any) => item.id === productId);
    if (latestProduct) {
      if (metadata?.kind) latestProduct.kind = metadata.kind;
      const previous = Array.isArray(latestProduct.rankSnapshots)
        ? latestProduct.rankSnapshots
        : [];
      latestProduct.rankSnapshots = appendRankSnapshots(previous, result.snapshots);
      s.set("projects", latestProjects);
    }
    return latestProjects.find((item: any) => item.id === project.id) || project;
  });

}
