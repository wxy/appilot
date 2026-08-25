import { app, dialog, ipcMain } from "electron";
import fs from "fs";
import path from "path";
import { log } from "../../engine/logger";
import { appendRankSnapshots } from "../../engine/rank-snapshots";
import { normalizeTrackedKeyword } from "../../engine/rank-keywords";
import { isStorefrontAllowedForQueryLanguage, storefrontsForLanguage } from "../../engine/storefronts";
import { createAiProvider } from "../ai-service";
import { importAscKeyFileTo } from "../asc-key-file";
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
        const { collectRepoInfo } = await import("../../engine/git-info");
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
          const { collectRepoInfo } = await import("../../engine/git-info");
          project.repo = await collectRepoInfo(candidate);
        } catch (err: any) {
          log.warn(`Repo info refresh failed after path change: ${err.message}`);
        }
      }
      if (typeof settings.githubUrl === "string" && settings.githubUrl.trim()) {
        project.repo = { ...(project.repo || {}), githubUrl: settings.githubUrl.trim() };
      } else if (settings.githubUrl === null || settings.githubUrl === "") {
        try {
          const { collectRepoInfo } = await import("../../engine/git-info");
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
      } = await import("../../engine/app-store-discovery");
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
      const { collectRepoInfo } = await import("../../engine/git-info");
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
    const { generateKeywords } = await import("../../engine/ai/keyword-suggester");
    const { readRepoDescription } = await import("../../engine/app-store-discovery");

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
    const { curateKeywords } = await import("../../engine/ai/keyword-suggester");
    const { readRepoDescription } = await import("../../engine/app-store-discovery");

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

  ipcMain.handle("projects:extractSubmissionCandidates", async (_event, productId: string, language: string) => {
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const context = findProductContext(projects, productId);
    if (!context) throw new Error("Store product not found");
    if (!language) throw new Error("Missing language");
    const { project, product } = context;
    const profile = await buildProjectProfileFor(project, product);
    const provider = await createAiProvider(s);
    const { extractSubmissionCandidates } = await import("../../engine/ai/keyword-suggester");

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
    const aiCandidates = await extractSubmissionCandidates(provider, {
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
    });
    return { candidates: [...submissionTerms, ...aiCandidates] };
  });

  ipcMain.handle("projects:saveTrackedKeywords", async (_event, productId: string, trackedKeywords: any[]) => {
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const context = findProductContext(projects, productId);
    if (!context) throw new Error("Store product not found");
    const nextProjects = updateProjectInProjects(projects, context.project.id, (_project) => ({
      trackedKeywords: trackedKeywords.map((item: any) => normalizeTrackedKeyword(item)),
    }));
    s.set("projects", nextProjects);
    void schedulerTick();
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
    return nextProjects.find((project) => project.id === context.project.id) || context.project;
  });

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
    const { generateOverviewBrief } = await import("../../engine/ai/overview-brief");
    const { buildBriefInput } = await import("../../engine/overview-summary");
    const { readRepoDescription } = await import("../../engine/app-store-discovery");
    const { checkForRelease } = await import("../../engine/release-watcher");
    const { competitorDeltaSummary } = await import("../../engine/competitor-radar");

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

    const { lookupApp } = await import("../../engine/app-store-discovery");
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

    const { collectKeywordRankings } = await import("../../engine/rank-collector");
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
