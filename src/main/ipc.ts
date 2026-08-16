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

function migrateLegacyStoreProducts(project: any): any {
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

function findProductContext(projects: any[], productId: string): { project: any; product: any } | null {
  for (const project of projects) {
    const product = (project.storeProducts || []).find((item: any) => item.id === productId);
    if (product) return { project, product };
  }
  return null;
}

function updateProductInProjects(projects: any[], productId: string, updater: (product: any) => any): any[] {
  return projects.map((project) => {
    const index = (project.storeProducts || []).findIndex((item: any) => item.id === productId);
    if (index < 0) return project;
    const storeProducts = [...(project.storeProducts || [])];
    storeProducts[index] = updater(storeProducts[index]);
    return { ...project, storeProducts };
  });
}

function recordReleaseHistory(project: any, release: any, review: any): any[] {
  const history = Array.isArray(project.releaseHistory) ? project.releaseHistory : [];
  let entry = history.find((item: any) => item.tag === release.tag);
  if (!entry) {
    entry = {
      tag: release.tag,
      name: release.name || release.tag,
      publishedAt: release.publishedAt,
      status: "pending",
      reviewedAt: new Date().toISOString(),
      actionAt: null,
      review,
    };
    history.unshift(entry);
  } else {
    entry.review = review;
    entry.reviewedAt = entry.reviewedAt || new Date().toISOString();
  }
  project.releaseHistory = history.slice(0, 20);
  return project.releaseHistory;
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

interface ScheduledTaskBase {
  id: string;
  intervalMinutes: number;
  nextRunAt: string;
  lastRunAt?: string | null;
  firstRunAt?: string | null;
  executionCount: number;
  lastStatus?: "success" | "failed";
  enabled: boolean;
}

interface RankScheduledTask extends ScheduledTaskBase {
  kind: "rank";
  productId: string;
  keyword: string;
  queryLanguage: string;
  storefront: string;
}

interface ReleaseScheduledTask extends ScheduledTaskBase {
  kind: "release";
  projectId: string;
}

type ScheduledTask = RankScheduledTask | ReleaseScheduledTask;

let schedulerTimer: NodeJS.Timeout | null = null;
let schedulerRunning = false;
let overdueScattered = false;
const rankEntityCache = new Map<string, "software" | "macSoftware">();

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function rankTaskId(productId: string, keyword: string, queryLanguage: string, storefront: string): string {
  return `${productId}:${queryLanguage}:${storefront}:${keyword}`;
}

function taskSeed(task: Pick<RankScheduledTask, "productId" | "keyword" | "queryLanguage" | "storefront">): string {
  return [task.productId, task.queryLanguage, task.storefront, task.keyword].join(":");
}

function nextRunAt(seed: string, intervalMinutes: number, now = new Date()): string {
  const slot = hashString(seed) % intervalMinutes;
  const candidate = new Date(now);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + slot + 1);
  return candidate.toISOString();
}

async function resolveRankEntity(product: any): Promise<"software" | "macSoftware"> {
  const cached = rankEntityCache.get(product.trackId);
  if (cached) return cached;
  const { lookupApp } = await import("../engine/app-store-discovery");
  const metadata = await lookupApp(product.trackId);
  const entity: "software" | "macSoftware" = metadata?.kind === "mac-software" ? "macSoftware" : "software";
  rankEntityCache.set(product.trackId, entity);
  return entity;
}

async function reconcileRankTasks(store: any): Promise<void> {
  const projects: any[] = (store.get("projects") || []).map(migrateLegacyStoreProducts);
  store.set("projects", projects);
  const existing: ScheduledTask[] = store.get("scheduledTasks") || [];
  const activeKeys = new Set<string>();
  const desiredTasks = new Map<string, ScheduledTask>();

  for (const project of projects) {
    const storeProducts: any[] = project.storeProducts || [];
    for (const product of storeProducts) {
    if (!product.trackId) continue;
    const tracked: any[] = product.trackedKeywords || [];
    const supportedLanguages: { code: string }[] = product.supportedLanguages || [];

    for (const localization of supportedLanguages) {
      const localizationCode = localization.code;
      const storefronts = storefrontsForLanguage(localizationCode);
      const queryLanguages = localizationCode === "en" ? ["en"] : [localizationCode, "en"];

      for (const keyword of tracked) {
        if (!queryLanguages.includes(keyword.language)) continue;
        for (const storefront of storefronts) {
          const id = rankTaskId(product.id, keyword.keyword, keyword.language, storefront);
          activeKeys.add(id);
          const previous = existing.find((task) => task.id === id);
          desiredTasks.set(id, {
            id,
            kind: "rank",
            productId: product.id,
            keyword: keyword.keyword,
            queryLanguage: keyword.language,
            storefront,
            intervalMinutes: previous?.intervalMinutes || 24 * 60,
            nextRunAt: previous?.nextRunAt || nextRunAt(taskSeed({ productId: product.id, keyword: keyword.keyword, queryLanguage: keyword.language, storefront }), 24 * 60),
            lastRunAt: previous?.lastRunAt ?? null,
            firstRunAt: previous?.firstRunAt ?? null,
            executionCount: previous?.executionCount || 0,
            lastStatus: previous?.lastStatus,
            enabled: previous?.enabled ?? true,
          });
        }
      }
    }
    }
  }

  const next = existing
    .filter((task) => task.kind !== "rank" || activeKeys.has(task.id))
    .map((task) => (task.kind === "rank" ? desiredTasks.get(task.id) || task : task));
  for (const task of desiredTasks.values()) {
    if (!next.some((existingTask) => existingTask.id === task.id)) {
      next.push(task);
    }
  }

  store.set("scheduledTasks", next);
}

async function runRankTask(store: any, task: RankScheduledTask): Promise<void> {
  const projects: any[] = store.get("projects") || [];
  let product: any = null;
  let project: any = null;
  for (const candidateProject of projects) {
    const candidate = (candidateProject.storeProducts || []).find(
      (item: any) => item.id === task.productId,
    );
    if (candidate) {
      project = candidateProject;
      product = candidate;
      break;
    }
  }
  if (!project || !product?.trackId) return;

  const isActive = (product.trackedKeywords || []).some(
    (keyword: any) => keyword.keyword === task.keyword && keyword.language === task.queryLanguage,
  );
  if (!isActive) {
    task.enabled = false;
    task.lastStatus = "failed";
    return;
  }

  const { searchAppStoreRank } = await import("../engine/rank-collector");
  const entity = await resolveRankEntity(product);
  try {
    const result = await searchAppStoreRank({
      term: task.keyword,
      country: task.storefront,
      trackId: product.trackId,
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
    const previous = Array.isArray(product.rankSnapshots) ? product.rankSnapshots : [];
    product.rankSnapshots = [...previous, snapshot].slice(-5000);
    task.lastStatus = "success";
  } catch (err: any) {
    log.warn(`Scheduled rank task failed for "${task.keyword}" in ${task.storefront}: ${err.message}`);
    task.lastStatus = "failed";
  }

  task.lastRunAt = new Date().toISOString();
  task.executionCount += 1;
  task.firstRunAt = task.firstRunAt || task.lastRunAt;
  task.nextRunAt = nextRunAt(
    taskSeed(task),
    task.lastStatus === "failed" ? 30 : task.intervalMinutes,
  );
  store.set("projects", projects);
}

async function reconcileReleaseTasks(store: any): Promise<void> {
  const projects: any[] = (store.get("projects") || []).map(migrateLegacyStoreProducts);
  store.set("projects", projects);
  const existing: ScheduledTask[] = store.get("scheduledTasks") || [];
  const activeKeys = new Set<string>();
  const desiredTasks = new Map<string, ReleaseScheduledTask>();

  for (const project of projects) {
    const id = `${project.id}:release`;
    activeKeys.add(id);
    const previous = existing.find((task) => task.id === id);
    desiredTasks.set(id, {
      id,
      kind: "release",
      projectId: project.id,
      intervalMinutes: previous?.intervalMinutes || 60,
      nextRunAt: previous?.nextRunAt || nextRunAt(id, 60),
      lastRunAt: previous?.lastRunAt ?? null,
      firstRunAt: previous?.firstRunAt ?? null,
      executionCount: previous?.executionCount || 0,
      lastStatus: previous?.lastStatus,
      enabled: previous?.enabled ?? true,
    });
  }

  const next = existing
    .filter((task) => task.kind !== "release" || activeKeys.has(task.id))
    .map((task) => (task.kind === "release" ? desiredTasks.get(task.id) || task : task));
  for (const task of desiredTasks.values()) {
    if (!next.some((existingTask) => existingTask.id === task.id)) {
      next.push(task);
    }
  }
  store.set("scheduledTasks", next);
}

async function runReleaseTask(store: any, task: ReleaseScheduledTask): Promise<void> {
  const projects: any[] = store.get("projects") || [];
  const project = projects.find((item: any) => item.id === task.projectId);
  if (!project) {
    task.enabled = false;
    return;
  }

  const { checkForRelease } = await import("../engine/release-watcher");
  const result = await checkForRelease(project.localPath, project.lastReleaseTag || null);
  if (!result.latest) {
    task.lastStatus = "success";
    task.lastRunAt = new Date().toISOString();
    task.nextRunAt = nextRunAt(`${project.id}:release`, task.intervalMinutes);
    return;
  }

  let review = project.lastReleaseReview || null;
  if (result.isNew || !review || review.releaseTag !== result.latest.tag) {
    const { AIProvider } = await import("../engine/ai/ai-provider");
    const provider = new AIProvider({
      baseURL: store.get("aiProviderUrl"),
      apiKey: decryptApiKey(store.get("aiApiKey")),
      model: store.get("aiModel"),
    });
    const { reviewRelease } = await import("../engine/ai/release-reviewer");
    const { readRepoDescription } = await import("../engine/app-store-discovery");
    const keywords: string[] = Array.from(
      new Set(
        (project.storeProducts || []).flatMap((product: any) =>
          (product.trackedKeywords || []).map((keyword: any) => keyword.keyword),
        ),
      ),
    );
    const recentRankings = (project.storeProducts || []).flatMap((product: any) =>
      (product.rankSnapshots || []).slice(-20).map((snapshot: any) => ({
        keyword: snapshot.keyword,
        storefront: snapshot.storefront,
        rank: snapshot.rank,
        checkedAt: snapshot.checkedAt,
      })),
    );
    try {
      review = {
        ...(await reviewRelease(provider, {
          name: project.name,
          description: readRepoDescription(project.localPath),
          keywords,
          recentRankings,
          release: result.latest,
        })),
        releaseTag: result.latest.tag,
      };
      project.lastReleaseTag = result.latest.tag;
      project.lastReleaseReview = review;
      recordReleaseHistory(project, result.latest, review);
      task.lastStatus = "success";
    } catch (err: any) {
      log.warn(`Scheduled release review failed for ${project.id}: ${err.message}`);
      task.lastStatus = "failed";
    }
  } else {
    task.lastStatus = "success";
  }

  task.lastRunAt = new Date().toISOString();
  task.executionCount += 1;
  task.firstRunAt = task.firstRunAt || task.lastRunAt;
  task.nextRunAt = nextRunAt(
    `${project.id}:release`,
    task.lastStatus === "failed" ? 30 : task.intervalMinutes,
  );
  store.set("projects", projects);
}

async function schedulerTick(): Promise<void> {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    const store = await getStore();
    await reconcileRankTasks(store);
    await reconcileReleaseTasks(store);

    const now = Date.now();
    const tasks: ScheduledTask[] = store.get("scheduledTasks") || [];
    const due = tasks
      .filter((task) => task.enabled && new Date(task.nextRunAt).getTime() <= now)
      .slice(0, 4);

    for (const task of due) {
      if (task.kind === "rank") {
        await runRankTask(store, task);
      } else {
        await runReleaseTask(store, task);
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    store.set("scheduledTasks", tasks);
  } catch (err: any) {
    log.error(`Task scheduler tick failed: ${err.message}`);
  } finally {
    schedulerRunning = false;
  }
}

async function scatterOverdueTasks(store: any): Promise<void> {
  const now = Date.now();
  const tasks: ScheduledTask[] = store.get("scheduledTasks") || [];
  let changed = false;
  for (const task of tasks) {
    if (task.enabled && new Date(task.nextRunAt).getTime() <= now) {
      task.nextRunAt = nextRunAt(task.id, 120);
      changed = true;
    }
  }
  if (changed) {
    store.set("scheduledTasks", tasks);
  }
}

export function startTaskScheduler(): void {
  if (schedulerTimer) return;
  void (async () => {
    const store = await getStore();
    if (!overdueScattered) {
      await scatterOverdueTasks(store);
      overdueScattered = true;
    }
    schedulerTimer = setInterval(() => {
      void schedulerTick();
    }, 60_000);
    await schedulerTick();
  })();
}

export function registerIpcHandlers() {
  // ── Shell ──
  ipcMain.handle("shell:openExternal", (_event, url: string) => {
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("Only http/https URLs can be opened");
    }
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
    const migrated = projects.map(migrateLegacyStoreProducts);
    const cleaned = migrated.map(sanitizeRankSnapshots);
    if (
      projects.length !== raw.length ||
      migrated.some((project, index) => project !== projects[index]) ||
      cleaned.some((project, index) => project !== migrated[index])
    ) {
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
      } = await import("../engine/app-store-discovery");
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

    if (existingIndex >= 0) {
      projects[existingIndex] = project;
    } else {
      projects.push(project);
    }
    s.set("projects", projects);
    void schedulerTick();
    return project;
  });

  ipcMain.handle("projects:remove", async (_event, id: string) => {
    const s = await getStore();
    const projects: any[] = (s.get("projects") || []).filter((p: any) => p.id !== id);
    s.set("projects", projects);
    void schedulerTick();
    return true;
  });

  ipcMain.handle("projects:generateKeywords", async (_event, productId: string, language: string) => {
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const context = findProductContext(projects, productId);
    if (!context) throw new Error("Store product not found");
    if (!language) throw new Error("Missing language");

    const { AIProvider } = await import("../engine/ai/ai-provider");
    const provider = new AIProvider({
      baseURL: s.get("aiProviderUrl"),
      apiKey: decryptApiKey(s.get("aiApiKey")),
      model: s.get("aiModel"),
    });
    const { generateKeywords } = await import("../engine/ai/keyword-suggester");
    const { readRepoDescription } = await import("../engine/app-store-discovery");

    const description = readRepoDescription(context.project.localPath);
    const result = await generateKeywords(provider, {
      name: context.product.trackName || context.project.name,
      description,
      productType: context.product.platform || "unknown",
      language,
      uiLanguage: "zh-Hans",
    });
    return result;
  });

  ipcMain.handle("projects:saveTrackedKeywords", async (_event, productId: string, trackedKeywords: any[]) => {
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const context = findProductContext(projects, productId);
    if (!context) throw new Error("Store product not found");
    const nextProjects = updateProductInProjects(projects, productId, (product) => ({
      ...product,
      trackedKeywords,
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
    const nextProjects = updateProductInProjects(projects, productId, (product) => ({
      ...product,
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
    const nextProjects = updateProductInProjects(projects, productId, (product) => {
      const removedKeyword = (product.trackedKeywords || []).find(
        (item: any) => item.language === language && item.keyword === keyword,
      );
      const trackedKeywords = (product.trackedKeywords || []).filter(
        (item: any) => !(item.language === language && item.keyword === keyword),
      );
      const removedKeywords = Array.isArray(product.removedKeywords) ? [...product.removedKeywords] : [];
      if (!removedKeywords.some((item: any) => item.language === language && item.keyword === keyword)) {
        removedKeywords.push({
          language,
          keyword,
          rationale: removedKeyword?.rationale || "",
          translation: removedKeyword?.translation || "",
          removedAt: new Date().toISOString(),
        });
      }
      return { ...product, trackedKeywords, removedKeywords };
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
    const nextProjects = updateProductInProjects(projects, productId, (product) => {
      const removedItem = (product.removedKeywords || []).find(
        (item: any) => item.language === language && item.keyword === keyword,
      );
      if (!removedItem) throw new Error("Keyword is not in removed list");
      const trackedKeywords = [...(product.trackedKeywords || [])];
      if (!trackedKeywords.some((item: any) => item.language === language && item.keyword === keyword)) {
        trackedKeywords.push({
          language,
          keyword,
          rationale: removedItem.rationale || "",
          translation: removedItem.translation || "",
        });
      }
      const removedKeywords = (product.removedKeywords || []).filter(
        (item: any) => !(item.language === language && item.keyword === keyword),
      );
      return { ...product, trackedKeywords, removedKeywords };
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
    const nextProjects = updateProductInProjects(projects, productId, (product) => ({
      ...product,
      removedKeywords: (product.removedKeywords || []).filter(
        (item: any) => !languageSet.has(item.language),
      ),
    }));
    s.set("projects", nextProjects);
    void schedulerTick();
    return nextProjects.find((project) => project.id === context.project.id) || context.project;
  });

  ipcMain.handle("projects:collectRanks", async (event, productId: string, language?: string, storefront?: string) => {
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const context = findProductContext(projects, productId);
    if (!context) throw new Error("Store product not found");
    const { project, product } = context;
    if (!product.trackId) throw new Error("缺少 App Store Track ID，请先确认 README 中的商店链接。");

    let keywords: any[] = product.trackedKeywords || [];
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

    const { collectKeywordRankings } = await import("../engine/rank-collector");
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

    const previous = Array.isArray(product.rankSnapshots) ? product.rankSnapshots : [];
    product.rankSnapshots = [...previous, ...result.snapshots].slice(-5000);
    const nextProjects = updateProductInProjects(projects, productId, (item) => ({ ...item, rankSnapshots: product.rankSnapshots }));
    s.set("projects", nextProjects);
    return nextProjects.find((item) => item.id === project.id) || project;
  });

  ipcMain.handle("scheduler:status", async () => {
    const s = await getStore();
    const tasks: ScheduledTask[] = s.get("scheduledTasks") || [];
    const now = Date.now();
    const nextTask = tasks
      .filter((task) => task.enabled)
      .sort((a, b) => new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime())[0];
    return {
      enabled: Boolean(schedulerTimer),
      total: tasks.length,
      due: tasks.filter((task) => task.enabled && new Date(task.nextRunAt).getTime() <= now).length,
      failed: tasks.filter((task) => task.lastStatus === "failed").length,
      nextDueAt: nextTask?.nextRunAt || null,
    };
  });

  ipcMain.handle("scheduler:list", async () => {
    const s = await getStore();
    const projects: any[] = (s.get("projects") || []).map(migrateLegacyStoreProducts);
    const tasks: ScheduledTask[] = s.get("scheduledTasks") || [];
    return {
      running: schedulerRunning,
      tasks: tasks.map((task) => {
        const context =
          task.kind === "rank"
            ? findProductContext(projects, task.productId)
            : null;
        const project =
          task.kind === "release"
            ? projects.find((item: any) => item.id === task.projectId)
            : context?.project || null;
        return {
          ...task,
          projectName: project?.name || "已删除项目",
          productName:
            task.kind === "release"
              ? "仓库级"
              : context?.product.trackName || context?.project.name || "未知产品",
          platform:
            task.kind === "release"
              ? "仓库"
              : context?.product.platform || "unknown",
        };
      }),
    };
  });

  ipcMain.handle("scheduler:runDue", async () => {
    await schedulerTick();
    return true;
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
        name: project.name,
        description: readRepoDescription(project.localPath),
        keywords: Array.from(
          new Set(
            (project.storeProducts || []).flatMap((product: any) =>
              (product.trackedKeywords || []).map((keyword: any) => keyword.keyword),
            ),
          ),
        ),
        recentRankings: (project.storeProducts || []).flatMap((product: any) =>
          (product.rankSnapshots || []).slice(-20).map((snapshot: any) => ({
            keyword: snapshot.keyword,
            storefront: snapshot.storefront,
            rank: snapshot.rank,
            checkedAt: snapshot.checkedAt,
          })),
        ),
        release: result.latest,
      });
      review = { ...generated, releaseTag: result.latest.tag };
    }

    project.lastReleaseTag = result.latest.tag;
    project.lastReleaseReview = review;
    const history = recordReleaseHistory(project, result.latest, review);
    s.set("projects", projects);
    return {
      release: result.latest,
      review,
      isNew: result.isNew,
      history,
    };
  });

  ipcMain.handle("repo:setReleaseStatus", async (_event, projectId: string, tag: string, status: "accepted" | "ignored") => {
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const project = projects.find((item: any) => item.id === projectId);
    if (!project) throw new Error("Project not found");
    const history = Array.isArray(project.releaseHistory) ? project.releaseHistory : [];
    const entry = history.find((item: any) => item.tag === tag);
    if (!entry) throw new Error("Release history not found");
    entry.status = status;
    entry.actionAt = new Date().toISOString();
    s.set("projects", projects);
    return entry;
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
