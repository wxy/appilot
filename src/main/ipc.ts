import { app, ipcMain, shell, safeStorage, dialog } from "electron";
import crypto from "crypto";
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

/**
 * Project credentials (GitHub / App Store Connect) — Phase 1 of project
 * settings. Global defaults + optional per-project overrides, encrypted via
 * safeStorage. Effective value = project override ?? global default.
 */
function resolveEffectiveCredentials(s: any, projectId: string) {
  const global = s.get("globalCredentials") || {};
  const override = (s.get("projectCredentials") || {})[projectId] || {};
  const pick = (key: string): string => {
    const hasOverride = override[key] !== undefined && override[key] !== "";
    return hasOverride ? decryptApiKey(override[key]) : decryptApiKey(global[key]);
  };
  return {
    githubToken: pick("githubToken"),
    ascIssuerId: pick("ascIssuerId"),
    ascKeyId: pick("ascKeyId"),
    ascPrivateKeyPath: pick("ascPrivateKeyPath"),
  };
}

function ascJwt(issuerId: string, keyId: string, privateKeyPem: string): string {
  const header = { alg: "ES256", kid: keyId, typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: issuerId, exp: now + 1200, aud: "appstoreconnect-v1" };
  const b64 = (value: any) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${b64(header)}.${b64(payload)}`;
  const signer = crypto.createSign("sha256");
  signer.update(unsigned);
  return `${unsigned}.${signer.sign(privateKeyPem, "base64url")}`;
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

/**
 * Single factory for real AI providers (not testConnection): persists every
 * completed request's token usage (incl. cached input) into the aiUsage store
 * so the UI can show total tokens + cache hits instead of billing amounts.
 */
async function createAiProvider(s: any) {
  const { AIProvider } = await import("../engine/ai/ai-provider");
  return new AIProvider({
    baseURL: s.get("aiProviderUrl"),
    apiKey: decryptApiKey(s.get("aiApiKey")),
    model: s.get("aiModel"),
    onUsage: (usage) => {
      const prev = s.get("aiUsage") || {};
      s.set("aiUsage", {
        calls: (prev.calls || 0) + 1,
        promptTokens: (prev.promptTokens || 0) + usage.promptTokens,
        completionTokens: (prev.completionTokens || 0) + usage.completionTokens,
        cachedTokens: (prev.cachedTokens || 0) + usage.cachedTokens,
        totalTokens: (prev.totalTokens || 0) + usage.totalTokens,
        estimatedCost: (prev.estimatedCost || 0) + usage.estimatedCost,
      });
    },
  });
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

/**
 * Plan A — shared keyword pool: a product's keywords are one set queried
 * across language × platform × storefront. The pool lives at the project
 * level; per-platform keyword copies from older data are merged once here.
 */
function ensureProjectKeywordPool(project: any): any {
  if (!project) return project;
  if (!Array.isArray(project.trackedKeywords)) {
    const byKey = new Map<string, any>();
    const order: string[] = [];
    for (const product of project.storeProducts || []) {
      for (const keyword of product.trackedKeywords || []) {
        if (!keyword || !keyword.keyword) continue;
        const key = `${keyword.language}\u0000${keyword.keyword}`;
        if (!byKey.has(key)) {
          byKey.set(key, normalizeTrackedKeyword(keyword));
          order.push(key);
        }
      }
    }
    project.trackedKeywords = order.map((key) => byKey.get(key));
  }
  if (!Array.isArray(project.submissionKeywords)) {
    const byLang = new Map<string, string>();
    for (const product of project.storeProducts || []) {
      for (const item of product.submissionKeywords || []) {
        if (item?.language && item.text && !byLang.has(item.language)) {
          byLang.set(item.language, item.text);
        }
      }
    }
    project.submissionKeywords = [...byLang].map(([language, text]) => ({ language, text }));
  }
  if (!Array.isArray(project.removedKeywords)) {
    const byKey = new Map<string, any>();
    for (const product of project.storeProducts || []) {
      for (const item of product.removedKeywords || []) {
        if (!item || !item.keyword) continue;
        const key = `${item.language}\u0000${item.keyword}`;
        if (!byKey.has(key)) byKey.set(key, item);
      }
    }
    project.removedKeywords = [...byKey.values()];
  }
  return project;
}

function findProductContext(projects: any[], productId: string): { project: any; product: any } | null {
  for (const project of projects) {
    const product = (project.storeProducts || []).find((item: any) => item.id === productId);
    if (product) return { project: ensureProjectKeywordPool(project), product };
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

function updateProjectInProjects(projects: any[], projectId: string, updater: (project: any) => any): any[] {
  return projects.map((project) =>
    project.id === projectId ? { ...project, ...updater(project) } : project,
  );
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

/** Build the stable project-profile context block shared by AI tasks. */
async function buildProjectProfileFor(
  project: any,
  product: any,
  subtitle?: string,
  description?: string,
) {
  const [{ buildProjectProfile }, { readRepoDescription, readFullReadme }] = await Promise.all([
    import("../engine/project-profile"),
    import("../engine/app-store-discovery"),
  ]);
  const drafts = getStoreSubmissionDrafts(project)
    .filter((item: any) => item.productId === product.id)
    .sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const releaseHistory = drafts.map((item: any) => ({
    tag: String(item.releaseTag || ""),
    name: item.appVersion ? `v${String(item.appVersion).replace(/^v/i, "")}` : null,
    summary: String(item.summary || ""),
    publishedAt: String(item.updatedAt || ""),
  })).filter((item: any) => item.tag);
  return buildProjectProfile({
    name: product.trackName || project.name,
    subtitle: subtitle ?? drafts[0]?.localizations?.[0]?.subtitle ?? null,
    platform: product.platform || null,
    supportedLanguages: (product.supportedLanguages || []).map((l: any) => l.code),
    description: description ?? readRepoDescription(project.localPath),
    readme: readFullReadme(project.localPath),
    storeLinks: product.storeLinks || [],
    trackedKeywords: ensureProjectKeywordPool(project).trackedKeywords || [],
    releaseHistory,
  });
}

/** Minimal release view reconstructed from a saved draft when git no longer
 *  surfaces the candidate (e.g. material is empty after generation). */
function synthesizeReleaseFromDraft(draft: any): any {
  return {
    id: `draft-release-${draft.releaseTag}`,
    tag: draft.releaseTag,
    name: draft.appVersion ? `v${String(draft.appVersion).replace(/^v/i, "")}` : draft.releaseTag,
    publishedAt: draft.updatedAt || new Date().toISOString(),
    url: "",
    body: draft.summary || "",
    material: null,
    source: "git-tag",
    draft: true,
    commitSha: null,
  };
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

function isProductPostRelease(project: any, product: any): boolean {
  // A recognized App Store product (trackId resolved) is live; track its keywords.
  if (product?.trackId) return true;
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
  appVersionOverride?: string,
  onChars?: (received: { chars: number; phase: "reasoning" | "content" }) => void,
  includedChanges?: string[],
): Promise<StoreSubmissionDraft> {
  const { generateStoreSubmissionContent } = await import("../engine/ai/release-reviewer");
  const { readRepoDescription } = await import("../engine/app-store-discovery");

  const provider = await createAiProvider(store);

  ensureProjectKeywordPool(project);
  const trackedKeywords: string[] = Array.from(
    new Set<string>(
      (project.trackedKeywords || []).map((keyword: any) => String(keyword?.keyword || "").trim()),
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

  const profile = await buildProjectProfileFor(project, product, undefined, description);
  const content = await generateStoreSubmissionContent(
    provider,
    {
      name: product.trackName || project.name,
      description,
      language,
      trackedKeywords,
      currentSubmissionKeywords: project.submissionKeywords || [],
      recentRankings,
      release,
      reviewFeedback: existingDraft?.reviewFeedback || "",
      baseLocalization: existingDraft?.localizations?.[0],
      previousDescription,
      previousLocalization,
      profile,
      includedChanges,
    },
    onProgress,
    onChars,
  );

  const draft = createStoreSubmissionDraft({
    projectId: project.id,
    productId: product.id,
    release,
    content,
    existing: existingDraft,
  });
  if (appVersionOverride && appVersionOverride.trim()) {
    draft.appVersion = appVersionOverride.trim();
  }
  return draft;
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
  lastDurationMs?: number;
}

type ScheduledTask = RankScheduledTask;

interface RunningTaskInfo {
  keyword: string;
  language: string;
  storefront: string;
  startedAt: string;
}

let schedulerTimer: NodeJS.Timeout | null = null;
let schedulerRunning = false;
let overdueScattered = false;
/** How many rank tasks one scheduler tick may execute (throughput vs load). */
const MAX_RANK_TASKS_PER_TICK = 8;
/** What the scheduler is executing right now (for the timeline UI). */
let nowRunningTask: RunningTaskInfo | null = null;
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
  for (const project of projects) ensureProjectKeywordPool(project);
  store.set("projects", projects);
  const existing: ScheduledTask[] = store.get("scheduledTasks") || [];
  const activeKeys = new Set<string>();
  const desiredTasks = new Map<string, ScheduledTask>();

  for (const project of projects) {
    const pool: any[] = (project.trackedKeywords || []).map((item: any) =>
      normalizeTrackedKeyword(item),
    );
    const poolBefore = JSON.stringify(pool);
    const storeProducts: any[] = project.storeProducts || [];
    for (const product of storeProducts) {
      if (!product.trackId) continue;
      if (!isProductPostRelease(project, product)) continue;
      const snapshots = Array.isArray(product.rankSnapshots) ? product.rankSnapshots : [];
      const platformKey = product.platform || "unknown";

      // The shared pool is queried per platform; auto-pause is evaluated per
      // platform (stored in pausedPlatforms) while a manual pause is global.
      for (const localization of product.supportedLanguages || []) {
        const localizationCode = localization.code;
        const queryLanguages = localizationCode === "en" ? ["en"] : [localizationCode, "en"];
        for (const keyword of pool) {
          if (keyword.status === "paused") continue;
          const evaluated = evaluatePause(
            enrichKeywordFromSnapshots(keyword, snapshots),
            snapshots,
          );
          const platforms = Array.isArray(keyword.pausedPlatforms)
            ? keyword.pausedPlatforms
            : [];
          if (evaluated.status === "paused" && !platforms.includes(platformKey)) {
            keyword.pausedPlatforms = [...platforms, platformKey];
            keyword.pausedReason = evaluated.pausedReason || null;
          } else if (evaluated.status !== "paused" && platforms.includes(platformKey)) {
            keyword.pausedPlatforms = platforms.filter((item: string) => item !== platformKey);
          }
          if ((keyword.pausedPlatforms || []).includes(platformKey)) continue;
          if (!queryLanguages.includes(keyword.language)) continue;
          for (const storefront of storefrontsForLanguage(localizationCode)) {
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
    if (JSON.stringify(pool) !== poolBefore) {
      project.trackedKeywords = pool;
    }
  }

  const next = existing
    // Only rank tasks are runnable; drop stale task kinds (e.g. legacy release
    // tasks with no executor) instead of letting them linger forever overdue.
    .filter((task) => task.kind === "rank" && activeKeys.has(task.id))
    .map((task) => desiredTasks.get(task.id) || task);
  for (const task of desiredTasks.values()) {
    if (!next.some((existingTask) => existingTask.id === task.id)) {
      next.push(task);
    }
  }

  store.set("scheduledTasks", next);
  store.set("projects", projects);
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

  const pool = ensureProjectKeywordPool(project).trackedKeywords || [];
  const isActive = pool.some(
    (keyword: any) =>
      keyword.keyword === task.keyword &&
      keyword.language === task.queryLanguage &&
      keyword.status !== "paused" &&
      !(keyword.pausedPlatforms || []).includes(product.platform || "unknown"),
  );
  if (!isActive) {
    task.enabled = false;
    task.lastStatus = "failed";
    return;
  }

  const { searchAppStoreRank } = await import("../engine/rank-collector");
  const entity = await resolveRankEntity(product);
  const startedAt = Date.now();
  nowRunningTask = {
    keyword: task.keyword,
    language: task.queryLanguage,
    storefront: task.storefront,
    startedAt: new Date().toISOString(),
  };
  let durationMs = 0;
  let requestBytes = 0;
  let responseBytes = 0;
  let rank: number | null = null;
  let status: "success" | "failed" = "success";
  try {
    const result = await searchAppStoreRank({
      term: task.keyword,
      country: task.storefront,
      trackId: product.trackId,
      entity,
    });
    durationMs = result.durationMs;
    requestBytes = result.requestBytes;
    responseBytes = result.responseBytes;
    rank = result.rank;
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
    task.consecutiveFailures = 0;
    task.lastStatus = "success";
  } catch (err: any) {
    status = "failed";
    durationMs = Date.now() - startedAt;
    log.warn(`Scheduled rank task failed for "${task.keyword}" in ${task.storefront}: ${err.message}`);
    task.consecutiveFailures = (task.consecutiveFailures || 0) + 1;
    task.lastStatus = "failed";
    if (task.consecutiveFailures >= 5) {
      task.enabled = false;
    }
  } finally {
    nowRunningTask = null;
  }

  task.lastRunAt = new Date().toISOString();
  task.executionCount += 1;
  task.lastDurationMs = durationMs;
  const executions: any[] = Array.isArray(store.get("rankExecutions"))
    ? store.get("rankExecutions")
    : [];
  executions.push({
    ts: new Date().toISOString(),
    productId: task.productId,
    keyword: task.keyword,
    language: task.queryLanguage,
    storefront: task.storefront,
    status,
    rank,
    durationMs,
    requestBytes,
    responseBytes,
  });
  store.set("rankExecutions", executions.slice(-5000));
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
    // Oldest-overdue first: array order is per-project, so an early project can
    // otherwise starve every later project (GloWalk sat enabled but untouched
    // behind ai-pulse's larger task list).
    const due = tasks
      .filter(
        (task) =>
          task.kind === "rank" &&
          task.enabled &&
          new Date(task.nextRunAt).getTime() <= now,
      )
      .sort((a, b) => new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime())
      .slice(0, MAX_RANK_TASKS_PER_TICK);

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

  ipcMain.handle("shell:revealInFolder", (_event, localPath: string) => {
    const normalized = normalizeLocalPath(localPath);
    if (!normalized || !fs.existsSync(normalized)) return false;
    shell.showItemInFolder(normalized);
    return true;
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
        const { collectRepoInfo } = await import("../engine/git-info");
        project.repo = await collectRepoInfo(project.localPath || "");
        repoChanged = true;
      } catch (err: any) {
        log.warn(`Repo info refresh failed for ${project.localPath}: ${err.message}`);
      }
    }
    if (repoChanged) s.set("projects", cleaned);
    return cleaned.map((project) => {
      const creds = resolveEffectiveCredentials(s, project.id);
      return {
        ...project,
        hasGithubToken: Boolean(creds.githubToken),
        hasAscKey: Boolean(
          creds.ascIssuerId && creds.ascKeyId && creds.ascPrivateKeyPath,
        ),
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
          const { collectRepoInfo } = await import("../engine/git-info");
          project.repo = await collectRepoInfo(candidate);
        } catch (err: any) {
          log.warn(`Repo info refresh failed after path change: ${err.message}`);
        }
      }
      if (typeof settings.githubUrl === "string" && settings.githubUrl.trim()) {
        project.repo = { ...(project.repo || {}), githubUrl: settings.githubUrl.trim() };
      } else if (settings.githubUrl === null || settings.githubUrl === "") {
        try {
          const { collectRepoInfo } = await import("../engine/git-info");
          project.repo = await collectRepoInfo(project.localPath || "");
        } catch (err: any) {
          log.warn(`Repo info refresh failed while clearing github url: ${err.message}`);
        }
      }

      projects[index] = project;
      s.set("projects", projects);
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
    return {
      hasGithubToken: Boolean(eff.githubToken),
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
      ascPrivateKeyPath: eff.ascPrivateKeyPath || "",
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
        ascIssuerId?: string;
        ascKeyId?: string;
        ascPrivateKeyPath?: string;
      },
    ) => {
      const s = await getStore();
      const scope = creds.scope === "project" ? "project" : "global";
      if (scope === "project") projectId = assertNonEmptyString(projectId, "projectId");
      const setField = (entry: Record<string, string>, key: string, value?: string) => {
        if (value === undefined) return;
        if (value.trim() === "") delete entry[key];
        else if (key === "ascPrivateKeyPath") entry[key] = value.trim();
        else entry[key] = encryptApiKey(value);
      };
      if (scope === "global") {
        const entry: Record<string, string> = { ...(s.get("globalCredentials") || {}) };
        setField(entry, "githubToken", creds.githubToken);
        setField(entry, "ascIssuerId", creds.ascIssuerId);
        setField(entry, "ascKeyId", creds.ascKeyId);
        setField(entry, "ascPrivateKeyPath", creds.ascPrivateKeyPath);
        s.set("globalCredentials", entry);
      } else {
        const all: Record<string, Record<string, string>> = s.get("projectCredentials") || {};
        const entry: Record<string, string> = { ...(all[projectId] || {}) };
        setField(entry, "githubToken", creds.githubToken);
        setField(entry, "ascIssuerId", creds.ascIssuerId);
        setField(entry, "ascKeyId", creds.ascKeyId);
        setField(entry, "ascPrivateKeyPath", creds.ascPrivateKeyPath);
        if (Object.keys(entry).length === 0) delete all[projectId];
        else all[projectId] = entry;
        s.set("projectCredentials", all);
      }
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
        return { ok: false, error: "ASC Key 信息不完整（Issuer / Key ID / .p8 文件）" };
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
        if (!res.ok) return { ok: false, error: `ASC API ${res.status}` };
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

    try {
      const { collectRepoInfo } = await import("../engine/git-info");
      (project as any).repo = await collectRepoInfo(localPath);
    } catch (err: any) {
      log.warn(`Repo info collection failed for ${localPath}: ${err.message}`);
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
    const all = s.get("projects") || [];
    const removed = all.find((p: any) => p.id === id);
    const projects: any[] = (s.get("projects") || []).filter((p: any) => p.id !== id);
    s.set("projects", projects);
    // Remove scheduled tasks that belonged to the deleted project's products.
    if (removed) {
      const removedProductIds = new Set(
        (removed.storeProducts || []).map((product: any) => product.id),
      );
      const tasks = (s.get("scheduledTasks") || []).filter(
        (task: any) => !removedProductIds.has(task.productId),
      );
      s.set("scheduledTasks", tasks);
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
    const { generateKeywords } = await import("../engine/ai/keyword-suggester");
    const { readRepoDescription } = await import("../engine/app-store-discovery");

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
    const { curateKeywords } = await import("../engine/ai/keyword-suggester");
    const { readRepoDescription } = await import("../engine/app-store-discovery");

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
    const { extractSubmissionCandidates } = await import("../engine/ai/keyword-suggester");

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
    const { generateOverviewBrief } = await import("../engine/ai/overview-brief");
    const { buildBriefInput } = await import("../engine/overview-summary");
    const { readRepoDescription } = await import("../engine/app-store-discovery");
    const { checkForRelease } = await import("../engine/release-watcher");

    const releaseResult = await checkForRelease(project.localPath, project.lastReleaseSha || null);
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
    const now = Date.now();
    const executions: any[] = s.get("rankExecutions") || [];
    const dayMs = 24 * 60 * 60 * 1000;
    const recent = executions.filter(
      (entry) => new Date(entry.ts).getTime() >= now - dayMs,
    );
    const success = recent.filter((entry) => entry.status === "success");
    const enabled = tasks.filter((task) => task.enabled);
    const overdue = enabled.filter(
      (task) => new Date(task.nextRunAt).getTime() <= now,
    ).length;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const executedToday = executions.filter(
      (entry) => new Date(entry.ts).getTime() >= todayStart.getTime(),
    ).length;
    const totalExecuted = tasks.reduce(
      (sum, task) => sum + (task.executionCount || 0),
      0,
    );
    const avgDurationMs = recent.length
      ? Math.round(
          recent.reduce((sum, entry) => sum + (entry.durationMs || 0), 0) /
            recent.length,
        )
      : 0;
    const successRate = recent.length
      ? Math.round((success.length / recent.length) * 100)
      : null;
    const hitRate = success.length
      ? Math.round(
          (success.filter((entry) => entry.rank != null).length / success.length) *
            100,
        )
      : null;
    const nextDue = enabled
      .map((task) => new Date(task.nextRunAt).getTime())
      .sort((a, b) => a - b)[0];

    // 24 hourly buckets of past executions + 24 hourly buckets of scheduled runs.
    const hourStart = (ts: number) => {
      const d = new Date(ts);
      d.setMinutes(0, 0, 0);
      return d.getTime();
    };
    const recentTimeline: { hour: number; success: number; failed: number }[] = [];
    for (let i = 23; i >= 0; i--) {
      const start = hourStart(now) - i * 60 * 60 * 1000;
      const end = start + 60 * 60 * 1000;
      const inHour = recent.filter((entry) => {
        const ts = new Date(entry.ts).getTime();
        return ts >= start && ts < end;
      });
      recentTimeline.push({
        hour: start,
        success: inHour.filter((entry) => entry.status === "success").length,
        failed: inHour.filter((entry) => entry.status === "failed").length,
      });
    }
    const upcomingTimeline: { hour: number; count: number }[] = [];
    for (let i = 0; i < 24; i++) {
      const start = hourStart(now) + i * 60 * 60 * 1000;
      const end = start + 60 * 60 * 1000;
      upcomingTimeline.push({
        hour: start,
        count: enabled.filter((task) => {
          const ts = new Date(task.nextRunAt).getTime();
          return ts >= start && ts < end;
        }).length,
      });
    }

    return {
      running: schedulerRunning,
      nowRunning: nowRunningTask,
      overview: {
        total: tasks.length,
        pending: enabled.length,
        overdue,
        executedToday,
        totalExecuted,
        avgDurationMs,
        densityPerHour: Math.round((recent.length / 24) * 10) / 10,
        successRate,
        hitRate,
        requestBytes: recent.reduce((sum, entry) => sum + (entry.requestBytes || 0), 0),
        responseBytes: recent.reduce((sum, entry) => sum + (entry.responseBytes || 0), 0),
        nextDueAt: nextDue ? new Date(nextDue).toISOString() : null,
      },
      timeline: { recent: recentTimeline, upcoming: upcomingTimeline },
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
    const result = await checkForRelease(project.localPath, project.lastReleaseSha || null, undefined, {
      sync: true,
    });
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
      if (!project) return null;
      const product = (project.storeProducts || []).find((item: any) => item.id === productId);
      // Navigation can race project/product switches; a missing product is a
      // transient state, not an error worth surfacing in the handler.
      if (!product) return null;

      const { checkForRelease } = await import("../engine/release-watcher");
      const { readFullReadme, readRepoDescription } = await import("../engine/app-store-discovery");
      const result = await checkForRelease(project.localPath, project.lastReleaseSha || null, undefined, {
        sync: true,
      });
      let release = result.releases.find((item) => item.tag === releaseTag) || null;
      if (!release) {
        const saved = findStoreSubmissionDraft(project, productId, releaseTag);
        if (saved) release = synthesizeReleaseFromDraft(saved);
      }
      if (!release) return null;

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
        description: readRepoDescription(project.localPath),
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
      includeShas?: string[],
      appVersion?: string,
      includedChanges?: string[],
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
    const result = await checkForRelease(project.localPath, project.lastReleaseSha || null, undefined, {
      sync: true,
    });
    let release = result.releases.find((item) => item.tag === releaseTag) || null;
    if (!release) {
      const saved = findStoreSubmissionDraft(project, productId, releaseTag);
      if (saved) release = synthesizeReleaseFromDraft(saved);
    }
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
        // Respect the user's include/exclude checklist: only the checked
        // commits are fed to the AI as release material.
        let generationRelease = release;
        if (Array.isArray(includeShas) && release.material) {
          const { filterMaterial, materialToBody } = await import("../engine/release-watcher");
          const filtered = filterMaterial(release.material, includeShas);
          generationRelease = { ...release, material: filtered, body: materialToBody(filtered) };
        }
        const draft = await generateStoreSubmissionDraft(
          s,
          project,
          product,
          generationRelease,
          existing,
          (progress) => {
            if (!_event.sender.isDestroyed()) {
              _event.sender.send("release:generateProgress", progress);
            }
          },
          language,
          appVersion,
          (received) => {
            if (!_event.sender.isDestroyed()) {
              _event.sender.send("release:generateProgress", { kind: "chars", ...received });
            }
          },
          includedChanges,
        );
        // Remember the tag (+ its commit) we generated for: name@sha identity
        // so a moved tag redefines the boundary and triggers regeneration.
        // Remember the HEAD we generated from: what's-new always covers
        // everything committed after this point.
        project.lastReleaseSha = release.commitSha || null;
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

      const { translateStoreSubmissionContent } = await import("../engine/ai/release-reviewer");
      const { readRepoDescription } = await import("../engine/app-store-discovery");

      const provider = await createAiProvider(s);
      const source = draft.localizations.find((item: any) => item.language === sourceLanguage)
        || draft.localizations[0];
      if (!source) throw new Error("Source localization not found");

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

      const profile = await buildProjectProfileFor(project, product, undefined, description);
      const translations = await translateStoreSubmissionContent(
        provider,
        {
          name: product.trackName || project.name,
          profile,
        },
        source,
        targetLanguages,
        (progress) => {
          if (!_event.sender.isDestroyed()) {
            _event.sender.send("release:generateProgress", progress);
          }
        },
        (received) => {
          if (!_event.sender.isDestroyed()) {
            _event.sender.send("release:generateProgress", { kind: "chars", ...received });
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
      ensureProjectKeywordPool(context.project).submissionKeywords = (draft.localizations || []).map((item) => ({
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
    return (
      s.get("aiUsage") || {
        calls: 0,
        promptTokens: 0,
        completionTokens: 0,
        cachedTokens: 0,
        totalTokens: 0,
        estimatedCost: 0,
      }
    );
  });

}
