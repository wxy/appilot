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

interface ScheduledTask {
  id: string;
  kind: "rank";
  projectId: string;
  keyword: string;
  queryLanguage: string;
  storefront: string;
  intervalMinutes: number;
  nextRunAt: string;
  lastRunAt?: string | null;
  lastStatus?: "success" | "failed";
  enabled: boolean;
}

let schedulerTimer: NodeJS.Timeout | null = null;
let schedulerRunning = false;
const rankEntityCache = new Map<string, "software" | "macSoftware">();

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function rankTaskId(projectId: string, keyword: string, queryLanguage: string, storefront: string): string {
  return `${projectId}:${queryLanguage}:${storefront}:${keyword}`;
}

function taskSeed(task: { projectId: string; keyword: string; queryLanguage: string; storefront: string }): string {
  return [task.projectId, task.queryLanguage, task.storefront, task.keyword].join(":");
}

function nextRunAt(seed: string, intervalMinutes: number, now = new Date()): string {
  const slot = hashString(seed) % intervalMinutes;
  const candidate = new Date(now);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + slot + 1);
  return candidate.toISOString();
}

async function resolveRankEntity(project: any): Promise<"software" | "macSoftware"> {
  const cached = rankEntityCache.get(project.trackId);
  if (cached) return cached;
  const { lookupApp } = await import("../engine/app-store-discovery");
  const metadata = await lookupApp(project.trackId);
  const entity: "software" | "macSoftware" = metadata?.kind === "mac-software" ? "macSoftware" : "software";
  rankEntityCache.set(project.trackId, entity);
  return entity;
}

async function reconcileRankTasks(store: any): Promise<void> {
  const projects: any[] = store.get("projects") || [];
  const existing: ScheduledTask[] = store.get("scheduledTasks") || [];
  const activeKeys = new Set<string>();
  const desiredTasks = new Map<string, ScheduledTask>();

  for (const project of projects) {
    if (!project.trackId) continue;
    const tracked: any[] = project.trackedKeywords || [];
    const supportedLanguages: { code: string }[] = project.supportedLanguages || [];

    for (const localization of supportedLanguages) {
      const localizationCode = localization.code;
      const storefronts = storefrontsForLanguage(localizationCode);
      const queryLanguages = localizationCode === "en" ? ["en"] : [localizationCode, "en"];

      for (const keyword of tracked) {
        if (!queryLanguages.includes(keyword.language)) continue;
        for (const storefront of storefronts) {
          const id = rankTaskId(project.id, keyword.keyword, keyword.language, storefront);
          activeKeys.add(id);
          const previous = existing.find((task) => task.id === id);
          desiredTasks.set(id, {
            id,
            kind: "rank",
            projectId: project.id,
            keyword: keyword.keyword,
            queryLanguage: keyword.language,
            storefront,
            intervalMinutes: previous?.intervalMinutes || 24 * 60,
            nextRunAt: previous?.nextRunAt || nextRunAt(taskSeed({ projectId: project.id, keyword: keyword.keyword, queryLanguage: keyword.language, storefront }), 24 * 60),
            lastRunAt: previous?.lastRunAt ?? null,
            lastStatus: previous?.lastStatus,
            enabled: previous?.enabled ?? true,
          });
        }
      }
    }
  }

  const next = existing
    .filter((task) => activeKeys.has(task.id))
    .map((task) => desiredTasks.get(task.id) || task);
  for (const task of desiredTasks.values()) {
    if (!next.some((existingTask) => existingTask.id === task.id)) {
      next.push(task);
    }
  }

  store.set("scheduledTasks", next);
}

async function runRankTask(store: any, task: ScheduledTask): Promise<void> {
  const projects: any[] = store.get("projects") || [];
  const project = projects.find((item: any) => item.id === task.projectId);
  if (!project?.trackId) return;

  const isActive = (project.trackedKeywords || []).some(
    (keyword: any) => keyword.keyword === task.keyword && keyword.language === task.queryLanguage,
  );
  if (!isActive) {
    task.enabled = false;
    task.lastStatus = "failed";
    return;
  }

  const { searchAppStoreRank } = await import("../engine/rank-collector");
  const entity = await resolveRankEntity(project);
  try {
    const result = await searchAppStoreRank({
      term: task.keyword,
      country: task.storefront,
      trackId: project.trackId,
      entity,
    });
    const snapshot = {
      keyword: task.keyword,
      language: task.queryLanguage,
      storefront: task.storefront,
      rank: result.rank,
      totalResults: result.totalResults,
      checkedAt: new Date().toISOString(),
    };
    const previous = Array.isArray(project.rankSnapshots) ? project.rankSnapshots : [];
    project.rankSnapshots = [...previous, snapshot].slice(-5000);
    task.lastStatus = "success";
  } catch (err: any) {
    log.warn(`Scheduled rank task failed for "${task.keyword}" in ${task.storefront}: ${err.message}`);
    task.lastStatus = "failed";
  }

  task.lastRunAt = new Date().toISOString();
  task.nextRunAt = nextRunAt(taskSeed(task), task.intervalMinutes);
  store.set("projects", projects);
}

async function schedulerTick(): Promise<void> {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    const store = await getStore();
    await reconcileRankTasks(store);

    const now = Date.now();
    const tasks: ScheduledTask[] = store.get("scheduledTasks") || [];
    const due = tasks
      .filter((task) => task.enabled && task.kind === "rank" && new Date(task.nextRunAt).getTime() <= now)
      .slice(0, 4);

    for (const task of due) {
      await runRankTask(store, task);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    store.set("scheduledTasks", tasks);
  } catch (err: any) {
    log.error(`Task scheduler tick failed: ${err.message}`);
  } finally {
    schedulerRunning = false;
  }
}

export function startTaskScheduler(): void {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(() => {
    void schedulerTick();
  }, 60_000);
  void schedulerTick();
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
      trackedKeywords: { language: string; keyword: string; rationale: string; translation: string }[];
      submissionKeywords: { language: string; text: string }[];
      removedKeywords: { language: string; keyword: string; rationale: string; translation: string; removedAt: string }[];
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

    const removedKeyword = (project.trackedKeywords || []).find(
      (item: any) => item.language === language && item.keyword === keyword,
    );
    project.trackedKeywords = (project.trackedKeywords || []).filter(
      (item: any) => !(item.language === language && item.keyword === keyword),
    );
    const removed = Array.isArray(project.removedKeywords) ? project.removedKeywords : [];
    if (!removed.some((item: any) => item.language === language && item.keyword === keyword)) {
      removed.push({
        language,
        keyword,
        rationale: removedKeyword?.rationale || "",
        translation: removedKeyword?.translation || "",
        removedAt: new Date().toISOString(),
      });
    }
    project.removedKeywords = removed;
    s.set("projects", projects);
    return project;
  });

  ipcMain.handle("projects:restoreTrackedKeyword", async (_event, projectId: string, language: string, keyword: string) => {
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const project = projects.find((p: any) => p.id === projectId);
    if (!project) throw new Error("Project not found");

    const removedItem = (project.removedKeywords || []).find(
      (item: any) => item.language === language && item.keyword === keyword,
    );
    if (!removedItem) throw new Error("Keyword is not in removed list");

    const tracked = project.trackedKeywords || [];
    if (!tracked.some((item: any) => item.language === language && item.keyword === keyword)) {
      tracked.push({
        language,
        keyword,
        rationale: removedItem.rationale || "",
        translation: removedItem.translation || "",
      });
    }
    project.trackedKeywords = tracked;
    project.removedKeywords = (project.removedKeywords || []).filter(
      (item: any) => !(item.language === language && item.keyword === keyword),
    );
    s.set("projects", projects);
    return project;
  });

  ipcMain.handle("projects:clearRemovedKeywords", async (_event, projectId: string, languages: string[]) => {
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const project = projects.find((p: any) => p.id === projectId);
    if (!project) throw new Error("Project not found");
    const languageSet = new Set(Array.isArray(languages) ? languages : []);
    project.removedKeywords = (project.removedKeywords || []).filter(
      (item: any) => !languageSet.has(item.language),
    );
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

  ipcMain.handle("scheduler:status", async () => {
    const s = await getStore();
    const tasks: ScheduledTask[] = s.get("scheduledTasks") || [];
    const now = Date.now();
    return {
      enabled: Boolean(schedulerTimer),
      total: tasks.length,
      due: tasks.filter((task) => task.enabled && new Date(task.nextRunAt).getTime() <= now).length,
      failed: tasks.filter((task) => task.lastStatus === "failed").length,
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
