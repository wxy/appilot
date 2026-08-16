import { ipcMain, shell, safeStorage, dialog } from "electron";
import path from "path";
import { log } from "../engine/logger";
import { isStorefrontAllowedForQueryLanguage, storefrontsForLanguage } from "../engine/storefronts";

// electron-store v10+ is ESM-only. Use dynamic import for CJS compat.
let store: any = null;

/**
 * Phase 0: encrypt the AI API key at rest using Electron safeStorage
 * (macOS Keychain / Windows DPAPI). Falls back to plaintext if unavailable.
 */
function encryptApiKey(key: string): string {
  if (!key) return "";
  if (!safeStorage.isEncryptionAvailable()) return key;
  return safeStorage.encryptString(key).toString("base64");
}

function decryptApiKey(stored: string): string {
  if (!stored) return "";
  if (!safeStorage.isEncryptionAvailable()) return stored;
  try {
    return safeStorage.decryptString(Buffer.from(stored, "base64"));
  } catch {
    return stored; // legacy plaintext value written before encryption
  }
}

async function getStore() {
  if (!store) {
    try {
      const mod = await import("electron-store");
      store = new mod.default({
        defaults: {
          aiProviderUrl: "https://api.openai.com/v1",
          aiApiKey: "",
          aiModel: "gpt-4o",
        },
      });
    } catch (err: any) {
      log.error(`Failed to load electron-store: ${err.message}`);
      throw err;
    }
  }
  return store;
}

function normalizeLocalPath(localPath: unknown): string {
  if (typeof localPath !== "string" || !localPath.trim()) return "";
  try {
    return path.resolve(localPath);
  } catch {
    return localPath.trim();
  }
}

/** Keep only the most recent project for each local path. */
function dedupeProjects(projects: any[]): any[] {
  const byPath = new Map<string, any>();
  for (const project of projects) {
    const key = normalizeLocalPath(project?.localPath) || `id:${project?.id ?? Math.random()}`;
    byPath.set(key, project);
  }
  return [...byPath.values()];
}

function sanitizeRankSnapshots(project: any): any {
  const snapshots = Array.isArray(project?.rankSnapshots) ? project.rankSnapshots : [];
  const cleaned = snapshots.filter((snapshot: any) => {
    return isStorefrontAllowedForQueryLanguage(snapshot?.language || "", snapshot?.storefront || "");
  });
  return cleaned.length === snapshots.length ? project : { ...project, rankSnapshots: cleaned };
}

export function registerIpcHandlers() {
  // ── Shell ──
  ipcMain.handle("shell:openExternal", (_event, url: string) => {
    return shell.openExternal(url);
  });

  // ── Project selector + local repo folder picker (Phase A) ──
  ipcMain.handle("dialog:selectFolder", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择应用源码目录",
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("projects:list", async () => {
    const s = await getStore();
    const raw: any[] = s.get("projects") || [];
    const projects = dedupeProjects(raw);
    const cleaned = projects.map(sanitizeRankSnapshots);
    if (projects.length !== raw.length || cleaned.some((project, index) => project !== projects[index])) {
      s.set("projects", cleaned);
    }
    return cleaned;
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
      trackedKeywords: { language: string; keyword: string; rationale: string }[];
      submissionKeywords: { language: string; text: string }[];
      removedKeywords: { language: string; keyword: string }[];
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
      } = await import("../engine/app-store-discovery");
      project.productType = detectApplePlatform(localPath);
      const languages = detectLocalizedLanguages(localPath);
      project.supportedLanguages = languages.map((code) => ({ code, name: languageDisplayName(code) }));
      const discovery = discoverAppStoreLinks(localPath);
      if (discovery) {
        project.trackId = discovery.trackId;
        project.storeLinks = localizedStoreLinks(discovery.links);
        const meta = await lookupApp(discovery.trackId);
        if (meta) {
          project.bundleId = meta.bundleId;
          project.trackName = meta.trackName;
          project.artworkUrl = meta.artworkUrl;
        }
      }
    } catch (err: any) {
      log.warn(`Project analysis failed for ${localPath}: ${err.message}`);
    }

    if (existingIndex >= 0) {
      projects[existingIndex] = project;
    } else {
      projects.push(project);
    }
    s.set("projects", projects);
    return project;
  });

  ipcMain.handle("projects:remove", async (_event, id: string) => {
    const s = await getStore();
    const projects: any[] = (s.get("projects") || []).filter((p: any) => p.id !== id);
    s.set("projects", projects);
    return true;
  });

  ipcMain.handle("projects:generateKeywords", async (_event, projectId: string, language: string) => {
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const project = projects.find((p: any) => p.id === projectId);
    if (!project) throw new Error("Project not found");
    if (!language) throw new Error("Missing language");

    const { AIProvider } = await import("../engine/ai/ai-provider");
    const provider = new AIProvider({
      baseURL: s.get("aiProviderUrl"),
      apiKey: decryptApiKey(s.get("aiApiKey")),
      model: s.get("aiModel"),
    });
    const { generateKeywords } = await import("../engine/ai/keyword-suggester");
    const { readRepoDescription } = await import("../engine/app-store-discovery");

    const description = readRepoDescription(project.localPath);
    const result = await generateKeywords(provider, {
      name: project.trackName || project.name,
      description,
      productType: project.productType || "unknown",
      language,
      uiLanguage: "zh-Hans",
    });
    return result;
  });

  ipcMain.handle("projects:saveTrackedKeywords", async (_event, projectId: string, trackedKeywords: any[]) => {
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const project = projects.find((p: any) => p.id === projectId);
    if (!project) throw new Error("Project not found");
    project.trackedKeywords = trackedKeywords;
    s.set("projects", projects);
    return project;
  });

  ipcMain.handle("projects:saveSubmissionKeywords", async (_event, projectId: string, submissionKeywords: any[]) => {
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const project = projects.find((p: any) => p.id === projectId);
    if (!project) throw new Error("Project not found");
    project.submissionKeywords = submissionKeywords;
    s.set("projects", projects);
    return project;
  });

  ipcMain.handle("projects:removeTrackedKeyword", async (_event, projectId: string, language: string, keyword: string) => {
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const project = projects.find((p: any) => p.id === projectId);
    if (!project) throw new Error("Project not found");

    project.trackedKeywords = (project.trackedKeywords || []).filter(
      (item: any) => !(item.language === language && item.keyword === keyword),
    );
    const removed = Array.isArray(project.removedKeywords) ? project.removedKeywords : [];
    if (!removed.some((item: any) => item.language === language && item.keyword === keyword)) {
      removed.push({ language, keyword });
    }
    project.removedKeywords = removed;
    s.set("projects", projects);
    return project;
  });

  ipcMain.handle("projects:collectRanks", async (event, projectId: string, language?: string, storefront?: string) => {
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const project = projects.find((p: any) => p.id === projectId);
    if (!project) throw new Error("Project not found");
    if (!project.trackId) throw new Error("缺少 App Store Track ID，请先确认 README 中的商店链接。");

    let keywords: any[] = project.trackedKeywords || [];
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

    const { lookupApp } = await import("../engine/app-store-discovery");
    const metadata = await lookupApp(project.trackId);
    const entity: "software" | "macSoftware" = metadata?.kind === "mac-software" ? "macSoftware" : "software";
    if (metadata?.kind) {
      project.kind = metadata.kind;
    }

    const targets = keywords.flatMap((keyword: any) =>
      storefronts.map((storefront: string) => ({
        keyword: keyword.keyword,
        language: keyword.language || "unknown",
        storefront,
      })),
    );

    const { collectKeywordRankings } = await import("../engine/rank-collector");
    const result = await collectKeywordRankings({
      targets,
      trackId: project.trackId,
      productType: project.productType,
      entity,
      delayMs: 1000,
      onProgress: (progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send("projects:collectRanksProgress", progress);
        }
      },
    });

    const previous = Array.isArray(project.rankSnapshots) ? project.rankSnapshots : [];
    project.rankSnapshots = [...previous, ...result.snapshots].slice(-5000);
    s.set("projects", projects);
    return project;
  });

  ipcMain.handle("repo:checkRelease", async (_event, projectId: string) => {
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const project = projects.find((item: any) => item.id === projectId);
    if (!project) throw new Error("Project not found");

    const { checkForRelease } = await import("../engine/release-watcher");
    const result = await checkForRelease(project.localPath, project.lastReleaseTag || null);
    if (!result.latest) {
      return { release: null, review: null, isNew: false };
    }

    let review = project.lastReleaseReview || null;
    if (result.isNew || !review || review.releaseTag !== result.latest.tag) {
      const { AIProvider } = await import("../engine/ai/ai-provider");
      const provider = new AIProvider({
        baseURL: s.get("aiProviderUrl"),
        apiKey: decryptApiKey(s.get("aiApiKey")),
        model: s.get("aiModel"),
      });
      const { reviewRelease } = await import("../engine/ai/release-reviewer");
      const { readRepoDescription } = await import("../engine/app-store-discovery");
      const generated = await reviewRelease(provider, {
        name: project.trackName || project.name,
        description: readRepoDescription(project.localPath),
        release: result.latest,
      });
      review = { ...generated, releaseTag: result.latest.tag };
    }

    project.lastReleaseTag = result.latest.tag;
    project.lastReleaseReview = review;
    s.set("projects", projects);
    return {
      release: result.latest,
      review,
      isNew: result.isNew,
    };
  });

  // ── AI Config ──
  ipcMain.handle("ai:getConfig", async () => {
    const s = await getStore();
    return {
      providerUrl: s.get("aiProviderUrl"),
      apiKey: decryptApiKey(s.get("aiApiKey")),
      model: s.get("aiModel"),
    };
  });

  ipcMain.handle("ai:saveConfig", async (_event, config: { providerUrl: string; apiKey: string; model: string }) => {
    const s = await getStore();
    s.set("aiProviderUrl", config.providerUrl);
    s.set("aiApiKey", encryptApiKey(config.apiKey));
    s.set("aiModel", config.model);
    return true;
  });

  ipcMain.handle("ai:testConnection", async (_event, config: { providerUrl: string; apiKey: string; model: string }) => {
    const { AIProvider } = await import("../engine/ai/ai-provider");
    const provider = new AIProvider({
      baseURL: config.providerUrl,
      apiKey: config.apiKey,
      model: config.model,
    });
    return provider.validateConnection();
  });

  // ── AI Engine (Task 0.7) ──
  ipcMain.handle("ai:analyzeProduct", async (_event, repoUrl: string) => {
    const s = await getStore();
    const { AIProvider } = await import("../engine/ai/ai-provider");
    const provider = new AIProvider({
      baseURL: s.get("aiProviderUrl"),
      apiKey: decryptApiKey(s.get("aiApiKey")),
      model: s.get("aiModel"),
    });
    try {
      const { RepoAnalyzer } = await import("../engine/repo-analyzer");
      const { AIEngine } = await import("../engine/ai/ai-engine");
      const engine = new AIEngine(new RepoAnalyzer(), provider);
      const result = await engine.analyzeProduct(repoUrl);
      if (provider.totalUsage) trackAiUsage(provider.totalUsage.totalTokens, provider.totalUsage.estimatedCost);
      return result;
    } catch (err: any) {
      log.error(`analyzeProduct failed: ${err.message}`, { repoUrl, errorCode: err.code });
      throw err;
    }
  });

  ipcMain.handle("ai:generateTweet", async (_event, repoUrl: string, stage: string) => {
    const s = await getStore();
    const { AIProvider } = await import("../engine/ai/ai-provider");
    const provider = new AIProvider({
      baseURL: s.get("aiProviderUrl"),
      apiKey: decryptApiKey(s.get("aiApiKey")),
      model: s.get("aiModel"),
    });
    try {
      const { RepoAnalyzer } = await import("../engine/repo-analyzer");
      const { AIEngine } = await import("../engine/ai/ai-engine");
      const engine = new AIEngine(new RepoAnalyzer(), provider);
      const result = await engine.generateTweet(repoUrl, stage as any);
      if (provider.totalUsage) trackAiUsage(provider.totalUsage.totalTokens, provider.totalUsage.estimatedCost);
      return result;
    } catch (err: any) {
      log.error(`generateTweet failed: ${err.message}`, { repoUrl, stage, errorCode: err.code });
      throw err;
    }
  });

  // ── Analytics / Stats (Task 0.13/0.14) ──
  ipcMain.handle("stats:save", async (_event, entry: { views: number; likes: number; comments: number; note: string; permalink: string }) => {
    const s = await getStore();
    const entries: any[] = s.get("stats") || [];
    entries.push({ ...entry, date: new Date().toISOString() });
    s.set("stats", entries);
    return entries;
  });

  ipcMain.handle("stats:list", async () => {
    const s = await getStore();
    return s.get("stats") || [];
  });

  ipcMain.handle("stats:aiUsage", async () => {
    const s = await getStore();
    return s.get("aiUsage") || { calls: 0, totalTokens: 0, estimatedCost: 0 };
  });

  // Track AI usage after each call
  const trackAiUsage = async (tokens: number, cost: number) => {
    const s = await getStore();
    const usage: any = s.get("aiUsage") || { calls: 0, totalTokens: 0, estimatedCost: 0 };
    usage.calls += 1;
    usage.totalTokens += tokens;
    usage.estimatedCost += cost;
    s.set("aiUsage", usage);
  };

  // ── Content Store / Drafts (Task 0.10/0.12) ──
  ipcMain.handle("draft:save", async (_event, content: string) => {
    const s = await getStore();
    s.set("draft", { content, savedAt: new Date().toISOString() });
    return true;
  });

  ipcMain.handle("draft:load", async () => {
    const s = await getStore();
    return s.get("draft") || null;
  });

}
