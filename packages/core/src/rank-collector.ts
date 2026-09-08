/**
 * RankCollector — Phase B.
 *
 * Uses the free iTunes Search API to find whether a known app appears in the
 * search results for a given keyword in a given storefront. It does not use AI;
 * ranking is a deterministic lookup against the app's trackId.
 */

import { log } from "./logger";

export interface RankTarget {
  keyword: string;
  language: string;
  storefront: string;
}

export interface RankSnapshot {
  keyword: string;
  language: string;
  storefront: string;
  rank: number | null;
  totalResults: number;
  checkedAt: string;
}

export interface RankCollectionResult {
  snapshots: RankSnapshot[];
  failed: number;
}

export interface RankProgress {
  current: number;
  total: number;
  keyword: string;
  storefront: string;
  snapshot?: RankSnapshot;
}

const ITUNES_SEARCH_URL = "https://itunes.apple.com/search";

function entityForProductType(productType?: string | null): string {
  return productType === "macos" ? "macSoftware" : "software";
}

async function fetchWithTimeout(url: URL, timeoutMs = 15_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * iTunes Search API 请求错误：message 与历史保持一致（"iTunes Search API <status>"，
 * 旧文本匹配不受影响），另附 status 字段供调用方做 403/429 等封禁/限流判定。
 */
export function itunesSearchApiError(status: number): Error & { status: number } {
  const err = new Error(`iTunes Search API ${status}`) as Error & { status: number };
  err.status = status;
  return err;
}

/**
 * 判断是否为 iTunes Search 的 403 拒绝（被拒/封禁/风控）。
 * 兼容带 status 的结构化错误（itunesSearchApiError）与仅文本的错误对象。
 */
export function isItunesSearchForbidden(err: unknown): boolean {
  if (!err) return false;
  const raw = err as {
    status?: unknown;
    response?: { status?: unknown };
    message?: unknown;
  };
  const status =
    Number(raw?.status) || Number((raw?.response as { status?: unknown } | undefined)?.status) || 0;
  if (status === 403) return true;
  const message = typeof raw?.message === "string" ? raw.message : String(err);
  return /iTunes Search API\s+403/.test(message) || /Forbidden/i.test(message);
}

// ────────────────────────────────────────────────────────────────────────────
// iTunes Search 403 熔断共享契约
//
// 键名与冷却时长由**主进程 scheduler**（src/main/scheduler.ts）与 **headless
// 执行链**（packages/headless 的 scheduler/executor）共用——两端读写同一个
// app_kv 表（同一 appilot.db），任一侧触发熔断后全端生效。统一放在本模块
// （core），避免键名/45 分钟在两处漂移。判定函数只吃 kv 原始值：
// - electron 侧经 getStore().set → kv.set(key, JSON.stringify(v)) 存入的是
//   **带 JSON 引号的 ISO 字符串**；
// - headless 直写 app_kv 时可能是裸 ISO。
// 两种存法都兼容（见 itunesSearchBlockUntilIso 的引号剥离）。
// ────────────────────────────────────────────────────────────────────────────
/** 熔断状态 kv 键：值为「熔断解除时刻」（ISO 字符串；未来时间 = 熔断中）。 */
export const ITUNES_SEARCH_BLOCK_KV_KEY = "itunesSearchBlockedUntil";
/** iTunes Search 403 后的冷却时长：45 分钟（主进程与 headless 共用，勿单侧改动）。 */
export const ITUNES_SEARCH_BLOCK_MS = 45 * 60_000;

/** 剥掉 electron 侧 JSON.stringify 产生的引号，得到可解析的 ISO 文本。 */
function blockIsoFromRaw(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let text = raw;
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === "string") text = parsed;
      else return null;
    } catch {
      text = text.slice(1, -1);
    }
  }
  const ts = new Date(text).getTime();
  return Number.isFinite(ts) ? text : null;
}

/**
 * 熔断截止（ISO）：kv 原始值解析为**未来**时刻时返回该 ISO，否则（未写入 /
 * 已过期 / 非法）返回 null。nowMs 可注入便于测试。
 */
export function itunesSearchBlockUntilIso(
  raw: unknown,
  nowMs: number = Date.now(),
): string | null {
  const iso = blockIsoFromRaw(raw);
  return iso && new Date(iso).getTime() > nowMs ? iso : null;
}

/** kv 原始值 → 是否处于 iTunes Search 403 熔断（冷却中）。 */
export function isItunesSearchBlocked(raw: unknown, nowMs: number = Date.now()): boolean {
  return itunesSearchBlockUntilIso(raw, nowMs) !== null;
}

/** 本次熔断的解除时刻 ISO（now + ITUNES_SEARCH_BLOCK_MS；写入方统一用它）。 */
export function itunesSearchBlockUntilIsoForNow(nowMs: number = Date.now()): string {
  return new Date(nowMs + ITUNES_SEARCH_BLOCK_MS).toISOString();
}

/** 本机时区 HH:mm（冷却提示文案用）。 */
export function formatItunesBlockClock(untilIso: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = new Date(untilIso);
  if (!Number.isFinite(d.getTime())) return "--:--";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 熔断中的友好错误文案（主进程手动入口 / headless 跳过提示共用）。 */
export function itunesSearchBlockFriendlyMessage(untilIso: string): string {
  return `iTunes Search 被拒绝（403），冷却至 ${formatItunesBlockClock(untilIso)}，请稍后再试`;
}

export async function searchAppStoreRank(opts: {
  term: string;
  country: string;
  trackId: string;
  productType?: string | null;
  entity?: "software" | "macSoftware";
  /** 在同一结果中顺带定位这些竞品 trackId 的排名（复用同一次搜索）。 */
  candidateTrackIds?: string[];
}): Promise<{
  rank: number | null;
  totalResults: number;
  durationMs: number;
  requestBytes: number;
  responseBytes: number;
  candidateRanks: Record<string, number | null>;
}> {
  const url = new URL(ITUNES_SEARCH_URL);
  url.searchParams.set("term", opts.term);
  url.searchParams.set("country", opts.country.toUpperCase());
  url.searchParams.set("entity", opts.entity || entityForProductType(opts.productType));
  url.searchParams.set("limit", "200");

  const startedAt = Date.now();
  const requestBytes = Buffer.byteLength(url.toString());
  let lastStatus = 0;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetchWithTimeout(url);
    lastStatus = res.status;
    if (res.status === 429 && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      continue;
    }
    if (!res.ok) {
      throw itunesSearchApiError(res.status);
    }

    const raw = await res.text();
    const data: any = JSON.parse(raw);
    const results: any[] = Array.isArray(data?.results) ? data.results : [];
    const index = results.findIndex((r) => String(r.trackId) === String(opts.trackId));

    const candidateRanks: Record<string, number | null> = {};
    for (const id of opts.candidateTrackIds || []) {
      const index = results.findIndex((r) => String(r.trackId) === String(id));
      candidateRanks[String(id)] = index >= 0 ? index + 1 : null;
    }
    return {
      rank: index >= 0 ? index + 1 : null,
      totalResults: results.length,
      durationMs: Date.now() - startedAt,
      requestBytes,
      responseBytes: raw.length,
      candidateRanks,
    };
  }

  throw itunesSearchApiError(lastStatus);
}

export async function collectKeywordRankings(opts: {
  targets: RankTarget[];
  trackId: string;
  productType?: string | null;
  entity?: "software" | "macSoftware";
  delayMs?: number;
  onProgress?: (progress: RankProgress) => void;
}): Promise<RankCollectionResult> {
  const snapshots: RankSnapshot[] = [];
  let failed = 0;
  let current = 0;

  for (const target of opts.targets) {
    current += 1;
    opts.onProgress?.({
      current,
      total: opts.targets.length,
      keyword: target.keyword,
      storefront: target.storefront,
    });

    try {
      const { rank, totalResults } = await searchAppStoreRank({
        term: target.keyword,
        country: target.storefront,
        trackId: opts.trackId,
        productType: opts.productType,
        entity: opts.entity,
      });
      const snapshot: RankSnapshot = {
        keyword: target.keyword,
        language: target.language,
        storefront: target.storefront,
        rank,
        totalResults,
        checkedAt: new Date().toISOString(),
      };
      snapshots.push(snapshot);
      opts.onProgress?.({
        current,
        total: opts.targets.length,
        keyword: target.keyword,
        storefront: target.storefront,
        snapshot,
      });
    } catch (err: any) {
      failed += 1;
      // iTunes Search 403（被拒/封禁/风控）：整批中止并向上抛——剩余目标继续打
      // API 只会让情况恶化。调用方（projects:collectRanks 等）据此触发熔断键并
      // 提示用户。其它错误照旧逐目标跳过。
      if (isItunesSearchForbidden(err)) {
        log.warn(
          `Rank lookup forbidden for "${target.keyword}" in ${target.storefront}: ${err.message}——中止后续采集（403 熔断）`,
        );
        throw err;
      }
      log.warn(
        `Rank lookup failed for "${target.keyword}" in ${target.storefront}: ${err.message}`,
      );
    }

    if (opts.delayMs && opts.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, opts.delayMs));
    }
  }

  return { snapshots, failed };
}
