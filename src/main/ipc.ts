import { app, ipcMain, shell, safeStorage, dialog } from "electron";
import fs from "fs";
import path from "path";
import { log } from "../engine/logger";
import { isStorefrontAllowedForQueryLanguage, storefrontsForLanguage } from "../engine/storefronts";
import { createStoreSubmissionDraft, submissionDraftId } from "../engine/store-submission";
import type { StoreSubmissionDraft } from "../engine/store-submission";
import { appendRankSnapshots } from "../engine/rank-snapshots";
import {
  enrichKeywordFromSnapshots,
  evaluatePause,
  normalizeTrackedKeyword,
} from "../engine/rank-keywords";
import { emitProjectsChanged } from "./project-events";

// electron-store v10+ is ESM-only. Use dynamic import for CJS compat.
let store: any = null;

/**
 * Phase 0: encrypt the AI API key at rest using Electron safeStorage
 * (macOS Keychain / Windows DPAPI). Falls back to plaintext if unavailable.
 */
function decryptApiKey(stored: string): string {
  if (!stored) return "";
  if (!safeStorage.isEncryptionAvailable()) return stored;
  // Peel off encryption layers one at a time. A legacy double-encrypted value
  // decrypts first to another base64 blob, then to the real key. Plaintext
  // (legacy or keychain-unavailable) values are returned as-is.
  let current = stored;
  for (let layer = 0; layer < 3; layer++) {
    if (!looksLikeEncryptedBlob(current)) return current;
    try {
      current = safeStorage.decryptString(Buffer.from(current, "base64"));
    } catch {
      return current;
    }
  }
  return current;
}

/** True when the value looks like an encrypted blob rather than a real key
 *  (printable ASCII). Real API keys virtually always contain a hyphen (e.g.
 *  "sk-…"), which strict base64 rejects — so only genuine ciphertext blobs
 *  (pure base64 of non-printable bytes) are treated as encrypted. */
function looksLikeEncryptedBlob(value: string): boolean {
  if (!value || !safeStorage.isEncryptionAvailable()) return false;
  if (value.length < 32) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  let buf: Buffer;
  try {
    buf = Buffer.from(value, "base64");
  } catch {
    return false;
  }
  if (buf.length < 24) return false;
  if (buf.toString("base64") !== value) return false;
  let printable = 0;
  for (const byte of buf) {
    if (byte >= 32 && byte <= 126) printable++;
  }
  return printable / buf.length < 0.8;
}

function encryptApiKey(key: string): string {
  if (!key) return "";
  if (!safeStorage.isEncryptionAvailable()) return key;
  if (looksLikeEncryptedBlob(key)) {
    log.warn("API key appears already encrypted; storing as-is to avoid double encryption");
    return key;
  }
  return safeStorage.encryptString(key).toString("base64");
}

export async function getStore() {
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

function assertNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function assertStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${name} must be an array of strings`);
  }
  return [...new Set(value as string[])];
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

function getStoreSubmissionDrafts(project: any): StoreSubmissionDraft[] {
  return Array.isArray(project.storeSubmissionDrafts) ? project.storeSubmissionDrafts : [];
}

function upsertStoreSubmissionDraft(project: any, draft: StoreSubmissionDraft): StoreSubmissionDraft[] {
  const drafts = getStoreSubmissionDrafts(project);
  const index = drafts.findIndex((item) => item.id === draft.id);
  const next = index >= 0
    ? drafts.map((item) => item.id === draft.id ? draft : item)
    : [draft, ...drafts];
  project.storeSubmissionDrafts = next.slice(0, 100);
  return project.storeSubmissionDrafts;
}

function findStoreSubmissionDraft(
  project: any,
  productId: string,
  releaseTag: string,
): StoreSubmissionDraft | null {
  return getStoreSubmissionDrafts(project).find(
    (item) => item.id === submissionDraftId(project.id, productId, releaseTag),
  ) || null;
}

function isProductPostRelease(project: any, product: any): boolean {
  const hasPublishedDraft = getStoreSubmissionDrafts(project).some(
    (draft) =>
      draft.productId === product.id &&
      (draft.githubDraftStatus === "published" || draft.storeStatus === "released"),
  );
  if (hasPublishedDraft) return true;

  // Legacy projects from before StoreSubmissionDraft existed may have release history
  // but no published draft record. Treat them as already post-release.
  return Array.isArray(project.releaseHistory) && project.releaseHistory.length > 0;
}

async function generateStoreSubmissionDraft(
  store: any,
  project: any,
  product: any,
  release: any,
  existingDraft: StoreSubmissionDraft | null,
  onProgress?: (event: any) => void,
  sourceLanguage?: string,
): Promise<StoreSubmissionDraft> {
  const { AIProvider } = await import("../engine/ai/ai-provider");
  const { generateStoreSubmissionContent } = await import("../engine/ai/release-reviewer");
  const { readRepoDescription } = await import("../engine/app-store-discovery");

  const provider = new AIProvider({
    baseURL: store.get("aiProviderUrl"),
    apiKey: decryptApiKey(store.get("aiApiKey")),
    model: store.get("aiModel"),
  });

  const trackedKeywords: string[] = Array.from(
    new Set<string>(
      (product.trackedKeywords || []).map((keyword: any) => String(keyword?.keyword || "").trim()),
    ),
  ).filter(Boolean);
  const recentRankings = (product.rankSnapshots || []).slice(-20).map((snapshot: any) => ({
    keyword: snapshot.keyword,
    storefront: snapshot.storefront,
    rank: snapshot.rank,
    checkedAt: snapshot.checkedAt,
  }));
  const detectedLanguages = (product.supportedLanguages || [])
    .map((item: any) => String(item?.code || "").trim())
    .filter((code: string) => Boolean(code));
  const language = sourceLanguage || detectedLanguages[0] || "en";
  const previousDrafts = getStoreSubmissionDrafts(project)
    .filter((item) => item.productId === product.id && item.releaseTag !== release.tag)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const previousDraft = previousDrafts[0] || null;
  const previousLocalization = previousDraft?.localizations?.find(
    (item) => item.language === language,
  ) || previousDraft?.localizations?.[0] || undefined;

  onProgress?.({
    kind: "phase",
    phase: "read_readme",
    status: "started",
  });
  const description = readRepoDescription(project.localPath);
  onProgress?.({
    kind: "phase",
    phase: "read_readme",
    status: "completed",
    bytes: description.length || 0,
  });

  onProgress?.({
    kind: "phase",
    phase: "read_previous",
    status: "started",
  });
  const previousDescription = previousDraft?.description || "";
  onProgress?.({
    kind: "phase",
    phase: "read_previous",
    status: "completed",
    bytes: previousDescription.length || 0,
  });

  const content = await generateStoreSubmissionContent(
    provider,
    {
      name: product.trackName || project.name,
      description,
      language,
      trackedKeywords,
      currentSubmissionKeywords: product.submissionKeywords || [],
      recentRankings,
      release,
      reviewFeedback: existingDraft?.reviewFeedback || "",
      baseLocalization: existingDraft?.localizations?.[0],
      previousDescription,
      previousLocalization,
    },
    onProgress,
  );

  return createStoreSubmissionDraft({
    projectId: project.id,
    productId: product.id,
    release,
    content,
    existing: existingDraft,
  });
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
  consecutiveFailures?: number;
}

interface RankScheduledTask extends ScheduledTaskBase {
  kind: "rank";
  productId: string;
  keyword: string;
  queryLanguage: string;
  storefront: string;
}

type ScheduledTask = RankScheduledTask;

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
    if (!isProductPostRelease(project, product)) continue;
    let tracked: any[] = (product.trackedKeywords || []).map((item: any) => normalizeTrackedKeyword(item));
    const snapshots = Array.isArray(product.rankSnapshots) ? product.rankSnapshots : [];
    tracked = tracked.map((keyword) => evaluatePause(enrichKeywordFromSnapshots(keyword, snapshots), snapshots));
    if (JSON.stringify(tracked) !== JSON.stringify(product.trackedKeywords)) {
      product.trackedKeywords = tracked;
    }
    const supportedLanguages: { code: string }[] = product.supportedLanguages || [];

    for (const localization of supportedLanguages) {
      const localizationCode = localization.code;
      const storefronts = storefrontsForLanguage(localizationCode);
      const queryLanguages = localizationCode === "en" ? ["en"] : [localizationCode, "en"];

      for (const keyword of tracked) {
        if (keyword.status === "paused") continue;
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
            consecutiveFailures: previous?.consecutiveFailures || 0,
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
    (keyword: any) =>
      keyword.keyword === task.keyword &&
      keyword.language === task.queryLanguage &&
      keyword.status !== "paused",
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
    product.rankSnapshots = appendRankSnapshots(previous, [snapshot]);
    product.trackedKeywords = (product.trackedKeywords || []).map((keyword: any) =>
      enrichKeywordFromSnapshots(keyword, product.rankSnapshots),
    );
    task.consecutiveFailures = 0;
    task.lastStatus = "success";
  } catch (err: any) {
    log.warn(`Scheduled rank task failed for "${task.keyword}" in ${task.storefront}: ${err.message}`);
    task.consecutiveFailures = (task.consecutiveFailures || 0) + 1;
    task.lastStatus = "failed";
    if (task.consecutiveFailures >= 5) {
      task.enabled = false;
    }
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

async function schedulerTick(): Promise<void> {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    const store = await getStore();
    await reconcileRankTasks(store);

    const now = Date.now();
    const tasks: ScheduledTask[] = store.get("scheduledTasks") || [];
    const due = tasks
      .filter((task) => task.enabled && new Date(task.nextRunAt).getTime() <= now)
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
  ipcMain.handle("app:getVersion", () => app.getVersion());

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
    emitProjectsChanged();
    return project;
  });

  ipcMain.handle("projects:remove", async (_event, id: string) => {
    const s = await getStore();
    const projects: any[] = (s.get("projects") || []).filter((p: any) => p.id !== id);
    s.set("projects", projects);
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

    const { AIProvider } = await import("../engine/ai/ai-provider");
    const provider = new AIProvider({
      baseURL: s.get("aiProviderUrl"),
      apiKey: decryptApiKey(s.get("aiApiKey")),
      model: s.get("aiModel"),
    });
    const { curateKeywords } = await import("../engine/ai/keyword-suggester");
    const { readRepoDescription } = await import("../engine/app-store-discovery");

    const drafts = getStoreSubmissionDrafts(project)
      .filter((draft) => draft.productId === productId)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    const latest = drafts[0];
    const loc = latest?.localizations?.find((item: any) => item.language === language)
      || latest?.localizations?.[0];
    const submission = (product.submissionKeywords || []).find((item: any) => item.language === language);
    const submissionKeywords = (submission?.text || "")
      .split(",")
      .map((item: string) => item.trim())
      .filter(Boolean);
    const existingKeywords = (product.trackedKeywords || [])
      .filter((item: any) => item.language === language)
      .map((item: any) => ({
        keyword: item.keyword,
        language: item.language,
        bestRank: item.bestRank ?? null,
        lastSeenAt: item.lastSeenAt ?? null,
        status: item.status || "active",
      }));
    const removedKeywords = (product.removedKeywords || [])
      .filter((item: any) => item.language === language)
      .map((item: any) => item.keyword);

    return curateKeywords(provider, {
      name: product.trackName || project.name,
      subtitle: loc?.subtitle || "",
      description: readRepoDescription(project.localPath),
      language,
      uiLanguage: "zh-Hans",
      existingKeywords,
      submissionKeywords,
      removedKeywords,
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

  ipcMain.handle("projects:saveTrackedKeywords", async (_event, productId: string, trackedKeywords: any[]) => {
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const context = findProductContext(projects, productId);
    if (!context) throw new Error("Store product not found");
    const nextProjects = updateProductInProjects(projects, productId, (product) => ({
      ...product,
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

  ipcMain.handle("projects:resumePausedKeyword", async (_event, productId: string, language: string, keyword: string) => {
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const context = findProductContext(projects, productId);
    if (!context) throw new Error("Store product not found");
    const nextProjects = updateProductInProjects(projects, productId, (product) => {
      const paused = (product.trackedKeywords || []).find(
        (item: any) => item.language === language && item.keyword === keyword,
      );
      if (!paused || paused.status !== "paused") throw new Error("Keyword is not paused");
      return {
        ...product,
        trackedKeywords: (product.trackedKeywords || []).map((item: any) =>
          item.language === language && item.keyword === keyword
            ? { ...item, status: "active", pausedAt: null, pausedReason: null }
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
    product.rankSnapshots = appendRankSnapshots(previous, result.snapshots);
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
        const context = findProductContext(projects, task.productId);
        const project = context?.project || null;
        return {
          ...task,
          projectName: project?.name || "已删除项目",
          productName: context?.product.trackName || context?.project.name || "未知产品",
          platform: context?.product.platform || "unknown",
        };
      }),
    };
  });

  ipcMain.handle("scheduler:runDue", async () => {
    await schedulerTick();
    return true;
  });

  ipcMain.handle("release:list", async (_event, projectId: string) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const project = projects.find((item: any) => item.id === projectId);
    if (!project) throw new Error("Project not found");

    const { checkForRelease } = await import("../engine/release-watcher");
    const result = await checkForRelease(project.localPath, project.lastReleaseTag || null);
    return {
      releases: result.releases.map((release) => ({
        ...release,
        submissionDrafts: (project.storeProducts || []).map((product: any) =>
          findStoreSubmissionDraft(project, product.id, release.tag),
        ),
      })),
      latestDraft: result.releases.find((release) => release.draft) || null,
    };
  });

  ipcMain.handle(
    "release:context",
    async (_event, projectId: string, productId: string, releaseTag: string) => {
      projectId = assertNonEmptyString(projectId, "projectId");
      productId = assertNonEmptyString(productId, "productId");
      releaseTag = assertNonEmptyString(releaseTag, "releaseTag");
      const s = await getStore();
      const projects: any[] = s.get("projects") || [];
      const project = projects.find((item: any) => item.id === projectId);
      if (!project) throw new Error("Project not found");
      const product = (project.storeProducts || []).find((item: any) => item.id === productId);
      if (!product) throw new Error("Store product not found");

      const { checkForRelease } = await import("../engine/release-watcher");
      const { readFullReadme } = await import("../engine/app-store-discovery");
      const result = await checkForRelease(project.localPath, project.lastReleaseTag || null);
      const release = result.releases.find((item) => item.tag === releaseTag) || null;
      if (!release) throw new Error("Release not found");

      const draftSummaries = getStoreSubmissionDrafts(project)
        .filter((item) => item.productId === productId)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .map((draft) => ({
          releaseTag: draft.releaseTag,
          updatedAt: draft.updatedAt,
          appVersion: draft.appVersion || "",
          summary: draft.summary || "",
          localizations: draft.localizations || [],
          promotionalText: draft.promotionalText || "",
          description: draft.description || "",
          whatsNew: draft.whatsNew || "",
          submissionKeywords: draft.submissionKeywords || [],
          githubDraftStatus: draft.githubDraftStatus || "",
          storeStatus: draft.storeStatus || "",
        }));
      const previous = draftSummaries.find((item) => item.releaseTag !== releaseTag) || null;
      const readme = readFullReadme(project.localPath);
      let readmeModifiedAt = "";
      try {
        readmeModifiedAt = fs.statSync(path.join(project.localPath, "README.md")).mtime.toISOString();
      } catch {
        readmeModifiedAt = release.publishedAt || "";
      }

      return {
        readme,
        readmeModifiedAt,
        drafts: draftSummaries,
        previousDescription: previous?.description || "",
        previousUpdatedAt: previous?.updatedAt || "",
        release,
      };
    },
  );

  ipcMain.handle(
    "release:get",
    async (
      _event,
      projectId: string,
      productId: string,
      releaseTag: string,
      force = false,
      language?: string,
    ) => {
      projectId = assertNonEmptyString(projectId, "projectId");
      productId = assertNonEmptyString(productId, "productId");
      releaseTag = assertNonEmptyString(releaseTag, "releaseTag");
      if (language !== undefined) {
        language = assertNonEmptyString(language, "language");
      }
      const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const project = projects.find((item: any) => item.id === projectId);
    if (!project) throw new Error("Project not found");
    const product = (project.storeProducts || []).find((item: any) => item.id === productId);
    if (!product) throw new Error("Store product not found");

    const { checkForRelease } = await import("../engine/release-watcher");
    _event.sender.send("release:generateProgress", {
      kind: "phase",
      phase: "read_draft",
      status: "started",
    });
    const result = await checkForRelease(project.localPath, project.lastReleaseTag || null);
    const release = result.releases.find((item) => item.tag === releaseTag) || null;
    _event.sender.send("release:generateProgress", {
      kind: "phase",
      phase: "read_draft",
      status: "completed",
      bytes: release?.body?.length || 0,
    });
    if (!release) return { release: null, draft: null, actionable: false };

    const existing = findStoreSubmissionDraft(project, productId, releaseTag);
    if (release.draft) {
      if (force) {
        const draft = await generateStoreSubmissionDraft(
          s,
          project,
          product,
          release,
          existing,
          (progress) => {
            if (!_event.sender.isDestroyed()) {
              _event.sender.send("release:generateProgress", progress);
            }
          },
          language,
        );
        upsertStoreSubmissionDraft(project, draft);
        s.set("projects", projects);
        return { release, draft, actionable: true };
      }
      return { release, draft: existing, actionable: Boolean(existing) };
    }

    if (existing) {
      existing.githubDraftStatus = "published";
      existing.storeStatus = existing.storeStatus === "released" ? existing.storeStatus : "released";
      existing.updatedAt = new Date().toISOString();
      upsertStoreSubmissionDraft(project, existing);
      s.set("projects", projects);
      return { release, draft: existing, actionable: false };
    }

    return { release, draft: null, actionable: false };
    },
  );

  ipcMain.handle(
    "release:translate",
    async (
      _event,
      projectId: string,
      productId: string,
      releaseTag: string,
      targetLanguages: string[],
      sourceLanguage?: string,
    ) => {
      projectId = assertNonEmptyString(projectId, "projectId");
      productId = assertNonEmptyString(productId, "productId");
      releaseTag = assertNonEmptyString(releaseTag, "releaseTag");
      targetLanguages = assertStringArray(targetLanguages, "targetLanguages");
      const s = await getStore();
      const projects: any[] = s.get("projects") || [];
      const project = projects.find((item: any) => item.id === projectId);
      if (!project) throw new Error("Project not found");
      const product = (project.storeProducts || []).find((item: any) => item.id === productId);
      if (!product) throw new Error("Store product not found");
      const draft = findStoreSubmissionDraft(project, productId, releaseTag);
      if (!draft) throw new Error("Submission draft not found");

      const { checkForRelease } = await import("../engine/release-watcher");
      const { AIProvider } = await import("../engine/ai/ai-provider");
      const { translateStoreSubmissionContent } = await import("../engine/ai/release-reviewer");
      const { readRepoDescription } = await import("../engine/app-store-discovery");
      _event.sender.send("release:generateProgress", {
        kind: "phase",
        phase: "read_draft",
        status: "started",
      });
      const result = await checkForRelease(project.localPath, project.lastReleaseTag || null);
      const release = result.releases.find((item) => item.tag === releaseTag) || null;
      if (!release) throw new Error("Release not found");
      _event.sender.send("release:generateProgress", {
        kind: "phase",
        phase: "read_draft",
        status: "completed",
        bytes: release.body.length || 0,
      });

      const provider = new AIProvider({
        baseURL: s.get("aiProviderUrl"),
        apiKey: decryptApiKey(s.get("aiApiKey")),
        model: s.get("aiModel"),
      });
      const source = draft.localizations.find((item: any) => item.language === sourceLanguage)
        || draft.localizations[0];
      if (!source) throw new Error("Source localization not found");

      const trackedKeywords: string[] = Array.from(
        new Set<string>(
          (product.trackedKeywords || []).map((keyword: any) => String(keyword?.keyword || "").trim()),
        ),
      ).filter(Boolean);
      const recentRankings = (product.rankSnapshots || []).slice(-20).map((snapshot: any) => ({
        keyword: snapshot.keyword,
        storefront: snapshot.storefront,
        rank: snapshot.rank,
        checkedAt: snapshot.checkedAt,
      }));

      _event.sender.send("release:generateProgress", {
        kind: "phase",
        phase: "read_readme",
        status: "started",
      });
      const description = readRepoDescription(project.localPath);
      _event.sender.send("release:generateProgress", {
        kind: "phase",
        phase: "read_readme",
        status: "completed",
        bytes: description.length || 0,
      });

      const translations = await translateStoreSubmissionContent(
        provider,
        {
          name: product.trackName || project.name,
          description,
          trackedKeywords,
          currentSubmissionKeywords: product.submissionKeywords || [],
          recentRankings,
          release,
          reviewFeedback: draft.reviewFeedback || "",
        },
        source,
        targetLanguages,
        (progress) => {
          if (!_event.sender.isDestroyed()) {
            _event.sender.send("release:generateProgress", progress);
          }
        },
      );

      const latestProjects: any[] = s.get("projects") || [];
      const latestProject = latestProjects.find((item: any) => item.id === projectId);
      const latestDraft = latestProject
        ? findStoreSubmissionDraft(latestProject, productId, releaseTag)
        : null;
      if (!latestDraft) throw new Error("Submission draft not found");

      const localizationMap = new Map(
        latestDraft.localizations.map((item: any) => [item.language, item]),
      );
      for (const translation of translations) {
        localizationMap.set(translation.language, translation);
      }
      latestDraft.localizations = [...localizationMap.values()];
      latestDraft.submissionKeywords = latestDraft.localizations.map((item: any) => ({
        language: item.language,
        text: item.keywords,
      }));
      latestDraft.updatedAt = new Date().toISOString();
      upsertStoreSubmissionDraft(latestProject, latestDraft);
      s.set("projects", latestProjects);
      return latestDraft;
    },
  );

  ipcMain.handle("release:saveDraft", async (_event, projectId: string, draft: StoreSubmissionDraft) => {
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const project = projects.find((item: any) => item.id === projectId);
    if (!project) throw new Error("Project not found");
    if (!draft?.id || draft.projectId !== projectId) throw new Error("Invalid submission draft");

    draft.updatedAt = new Date().toISOString();
    upsertStoreSubmissionDraft(project, draft);
    const context = findProductContext(projects, draft.productId);
    if (context) {
      context.product.submissionKeywords = (draft.localizations || []).map((item) => ({
        language: item.language,
        text: item.keywords,
      }));
    }
    s.set("projects", projects);
    return draft;
  });

  // ── AI Config ──
  ipcMain.handle("ai:getConfig", async () => {
    const s = await getStore();
    const stored = s.get("aiApiKey") || "";
    const apiKey = decryptApiKey(stored);
    return {
      providerUrl: s.get("aiProviderUrl"),
      apiKey,
      apiKeyBroken: Boolean(
        stored &&
        apiKey &&
        looksLikeEncryptedBlob(stored) &&
        looksLikeEncryptedBlob(apiKey),
      ),
      model: s.get("aiModel"),
    };
  });

  ipcMain.handle("ai:saveConfig", async (_event, config: { providerUrl: string; apiKey: string; model: string }) => {
    const s = await getStore();
    s.set("aiProviderUrl", config.providerUrl);
    s.set("aiModel", config.model);
    const currentStored = s.get("aiApiKey") || "";
    const apiKey = config.apiKey || "";
    if (apiKey && apiKey !== currentStored) {
      s.set("aiApiKey", encryptApiKey(apiKey));
    }
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

  ipcMain.handle("ai:listModels", async (_event, config: { providerUrl: string; apiKey: string }) => {
    const providerUrl = String(config?.providerUrl || "").trim().replace(/\/+$/, "");
    if (!providerUrl) return { models: [], error: "缺少供应商 URL" };
    const apiKey = String(config?.apiKey || "").trim();
    try {
      const res = await fetch(`${providerUrl}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        return {
          models: [],
          error: `模型列表请求失败（${res.status}）：${detail.slice(0, 200) || res.statusText}`,
        };
      }
      const data: any = await res.json();
      const models = (Array.isArray(data?.data) ? data.data : [])
        .map((item: any) => String(item?.id || "").trim())
        .filter(Boolean)
        .sort((a: string, b: string) => a.localeCompare(b));
      return { models, error: "" };
    } catch (err: any) {
      return { models: [], error: err?.message || String(err) };
    }
  });

  // ── Analytics / Stats (Task 0.13/0.14) ──
  ipcMain.handle("stats:aiUsage", async () => {
    const s = await getStore();
    return s.get("aiUsage") || { calls: 0, totalTokens: 0, estimatedCost: 0 };
  });

}
