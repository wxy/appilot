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

// ── 全局请求节奏（2026-09-17 排查教训）──
// iTunes Search 无官方配额，实测约 20 req/min 以上开始 429，持续 ~45 req/min
// 五分钟即升级为 403 封禁。采集实例在 daemon 里最高 10 并发派发，无节流时
// 波峰 50 req/min——这是今天 403 反复触发的根因。所有走 /search 的调用
// （rank 采集、竞品雷达、手动采集）经同一 FIFO 节拍器串行放行，
// 最小间隔 3.2s ≈ 18.7 req/min，低于实测阈值并留余量。
const ITUNES_SEARCH_MIN_INTERVAL_MS = 3_200;
let itunesSearchMinIntervalMs = ITUNES_SEARCH_MIN_INTERVAL_MS;
let paceTail: Promise<void> = Promise.resolve();
let lastSearchStartedAt = 0;
/** 测试/特殊场景注入：调整全局最小间隔（毫秒；0 = 关闭节拍）。 */
export function setItunesSearchPacingForTests(intervalMs: number): void {
  itunesSearchMinIntervalMs = intervalMs;
}

/** 全局节拍：调用方在发起 /search 请求前 await（含竞品雷达的直连搜索）。 */
export async function paceItunesSearch(): Promise<void> {
  const run = paceTail.then(async () => {
    const waitMs = lastSearchStartedAt + itunesSearchMinIntervalMs - Date.now();
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastSearchStartedAt = Date.now();
  });
  paceTail = run.catch(() => {});
  await run;
}

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
// （core），避免键名/冷却时长在两处漂移。判定函数只吃 kv 原始值。
//
// 存储格式（2026-09-17 起支持级别化冷却，兼容旧值）：
// - 旧格式：ISO 字符串（electron 侧经 JSON.stringify 存入带引号；headless 裸 ISO）；
// - 新格式：{"until":"<ISO>","level":N}（kv 文本或 store.get 反序列化后的对象）。
//   level=冷却倍率：同一冷却解除后短时间内（复发窗口）再次 403 → 级别 +1、
//   冷却翻倍——否则「解除即全速重试 → 又 403 → 再延 45 分钟」无限滚动。
// ────────────────────────────────────────────────────────────────────────────
/** 熔断状态 kv 键：值为「熔断解除时刻」（ISO 字符串；未来时间 = 熔断中）。 */
export const ITUNES_SEARCH_BLOCK_KV_KEY = "itunesSearchBlockedUntil";
/** iTunes Search 403 基础冷却：45 分钟（level=1；主进程与 headless 共用，勿单侧改动）。 */
export const ITUNES_SEARCH_BLOCK_MS = 45 * 60_000;
/** 冷却最高级别（level × 45min；4 级 = 3 小时封顶）。 */
export const ITUNES_SEARCH_BLOCK_MAX_LEVEL = 4;
/** 复发窗口：解除后这么短的时间内再次 403 视为「上游惩罚未解除」→ 升一级。 */
export const ITUNES_SEARCH_RECURRENCE_WINDOW_MS = 15 * 60_000;

export interface ItunesSearchBlockState {
  untilIso: string;
  /** 冷却倍率（1 = 基础 45 分钟；复发逐级翻倍）。 */
  level: number;
}

/** 剥掉 electron 侧 JSON.stringify 产生的引号，得到可解析文本。 */
function blockTextFromRaw(raw: unknown): string | null {
  if (typeof raw === "string" && raw.length > 0) {
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
    return text;
  }
  return null;
}

/** kv/store 原始值 → 上一次熔断（**含已解除**；复发升级判定用）。无记录返回 null。 */
export function lastItunesSearchBlockFromRaw(raw: unknown): ItunesSearchBlockState | null {
  // 新格式对象（electron store.get 反序列化后的形态）。
  if (raw && typeof raw === "object") {
    const obj = raw as { until?: unknown; level?: unknown };
    if (typeof obj.until === "string" && Number.isFinite(new Date(obj.until).getTime())) {
      return {
        untilIso: obj.until,
        level: Math.min(Math.max(1, Math.floor(Number(obj.level) || 1)), ITUNES_SEARCH_BLOCK_MAX_LEVEL),
      };
    }
    return null;
  }
  const text = blockTextFromRaw(raw);
  if (!text) return null;
  // 新格式文本（headless kv.get 的形态）：{"until":"...","level":N}
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && typeof parsed.until === "string") {
      return lastItunesSearchBlockFromRaw(parsed);
    }
  } catch {
    /* 旧格式：裸 ISO 文本 */
  }
  const ts = new Date(text).getTime();
  return Number.isFinite(ts) ? { untilIso: text, level: 1 } : null;
}

/** kv/store 原始值 → 当前生效的熔断（未来时刻才返回；已解除/非法返回 null）。 */
export function itunesSearchBlockStateFromRaw(
  raw: unknown,
  nowMs: number = Date.now(),
): ItunesSearchBlockState | null {
  const state = lastItunesSearchBlockFromRaw(raw);
  return state && new Date(state.untilIso).getTime() > nowMs ? state : null;
}

/**
 * 计算一次新熔断：距上次解除 ≤ 复发窗口 → 级别 +1（冷却翻倍），否则回到 1 级。
 * 返回 level 化的持久化状态（electron store.set 直接存对象；headless 需自行
 * JSON.stringify 后写 kv）与文案所需的 until/时长。
 */
export function computeItunesSearchBlock(
  prevRaw: unknown,
  nowMs: number = Date.now(),
): {
  state: { until: string; level: number };
  untilIso: string;
  durationMs: number;
  escalated: boolean;
} {
  const prev = lastItunesSearchBlockFromRaw(prevRaw);
  let level = 1;
  let escalated = false;
  if (prev) {
    const sinceExpiryMs = nowMs - new Date(prev.untilIso).getTime();
    if (sinceExpiryMs >= 0 && sinceExpiryMs <= ITUNES_SEARCH_RECURRENCE_WINDOW_MS) {
      level = Math.min(prev.level + 1, ITUNES_SEARCH_BLOCK_MAX_LEVEL);
      escalated = level > 1;
    }
  }
  const durationMs = ITUNES_SEARCH_BLOCK_MS * level;
  const untilIso = new Date(nowMs + durationMs).toISOString();
  // 持久化形态：{ until, level }（解析端 lastItunesSearchBlockFromRaw 的对象分支与此对应）。
  return { state: { until: untilIso, level }, untilIso, durationMs, escalated };
}

/** kv 原始值 → 是否处于 iTunes Search 403 熔断（冷却中）。 */
export function isItunesSearchBlocked(raw: unknown, nowMs: number = Date.now()): boolean {
  return itunesSearchBlockStateFromRaw(raw, nowMs) !== null;
}

/** 兼容旧签名：当前生效熔断的解除时刻 ISO（未熔断返回 null）。 */
export function itunesSearchBlockUntilIso(
  raw: unknown,
  nowMs: number = Date.now(),
): string | null {
  return itunesSearchBlockStateFromRaw(raw, nowMs)?.untilIso ?? null;
}

/** 兼容旧签名：以基础 45 分钟计算「现在触发」的解除时刻（降级路径用）。 */
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
    // 每次尝试（含 429 重试）都过全局节拍，避免并发调用方挤在同一毫秒。
    await paceItunesSearch();
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
