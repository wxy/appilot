/**
 * 竞品情报（P1 数据层，纯逻辑、无 electron 依赖，可 node 单测）。
 *
 * 把「按 (竞品 × 平台 × 语言 × 关键词) 采集的排名快照」+「我方关键词快照」
 * 聚合为竞品档案的“竞争面”：
 * - face = 竞品在某平台 × 某语言 × 某关键词上的竞争记录（best/latest、交集状态、
 *   领先方、长尾标记、贡献分）；
 * - 竞争指数 = Σ weight(我方名次段) × threat(该词威胁) × 长尾系数；
 * - 决策口径（产品负责人已确认）：
 *   1) 权重只按我方名次段（≤50 → 4；≤200 → 2；我方未进榜 → 1）；
 *   2) （扫描范围在调度侧限制，本模块不做采集）；
 *   3) 多平台分开统计：调用方按单一平台传入 rankEntries/ownSnapshots；
 *   4) 双方都在 200 名后的长尾词降权（贡献 × 0.2），但仍计入重叠。
 */

/** 竞品排名快照（competitorRankSnapshots 条目）。 */
export interface CompetitorRankEntry {
  keyword: string;
  language?: string;
  storefront: string;
  platform?: string | null;
  rank?: number | null;
  checkedAt?: string;
}

/** 我方排名快照（product.rankSnapshots 条目）。 */
export interface OwnRankSnapshot {
  keyword: string;
  language?: string | null;
  storefront: string;
  rank?: number | null;
  checkedAt?: string;
}

export interface FaceCell {
  storefront: string;
  own: number | null;
  theirs: number | null;
}

export type FaceOverlap = 'both' | 'selfOnly' | 'competitorOnly' | 'offChart' | 'unknown';

export interface CompetitorFace {
  platform: string;
  language: string;
  keyword: string;
  /** 窗口内该竞品最好/最新名次（null = 尚无采集到）。 */
  theirBest: number | null;
  theirLatest: number | null;
  theirLatestCheckedAt: string | null;
  sampleCount: number;
  /** 窗口内我方最好/最新名次（在该关键词上）。 */
  ownBest: number | null;
  ownLatest: number | null;
  /** 交集状态。 */
  overlap: FaceOverlap;
  /** 相对我方（theirBest - ownBest；<0 = 竞品领先）。双方 ≤200 时才有效。 */
  delta: number | null;
  /** 双方最新都在 200 名后（长尾，贡献降权）。 */
  longTail: boolean;
  /** 我方名次段权重（决策 1）。 */
  weight: number;
  /** 该词威胁值。 */
  threat: number;
  /** weight × threat × 长尾系数。 */
  contribution: number;
  /** 商店级对比（该词 × 商店，我方/竞品名次），供详情矩阵。 */
  cells: FaceCell[];
}

export interface PlatformIntel {
  platform: string;
  faceCount: number;
  /** 竞品压制我方词数：竞品 ≤200 且（我方未进榜或竞品名次更靠前）。 */
  pressuredCount: number;
  /** 竞品在榜词数（含与我方并列）。 */
  theirOnChart: number;
  /** 长尾（双方 >200）词数。 */
  longTailCount: number;
  index: number;
  faces: CompetitorFace[];
}

/** 窗口：最近 N 天的快照才算“当前竞争面”（再早的只算历史存在）。 */
export const INTEL_WINDOW_DAYS = 7;
/** 长尾降权系数（决策 4）。 */
export const LONG_TAIL_FACTOR = 0.2;
/** 我方名次段权重（决策 1）：≤50 → 4；≤200 → 2；我方未进榜/无记录 → 1。 */
export function weightOfOurRank(ourBest: number | null): number {
  if (ourBest == null) return 1;
  if (ourBest <= 50) return 4;
  if (ourBest <= 200) return 2;
  return 1;
}

const inWindow = (iso: string | undefined, now: number) =>
  Boolean(iso) && now - new Date(String(iso)).getTime() <= INTEL_WINDOW_DAYS * 86_400_000;

function bestOf(ranks: number[]): number | null {
  const list = ranks.filter((r) => typeof r === 'number' && Number.isFinite(r) && r > 0);
  if (list.length === 0) return null;
  return Math.min(...list);
}

function latestOf(entries: CompetitorRankEntry[]): { rank: number | null; checkedAt: string | null } {
  let rank: number | null = null;
  let checkedAt: string | null = null;
  for (const e of entries) {
    if (!e.checkedAt) continue;
    if (!checkedAt || e.checkedAt > checkedAt) {
      checkedAt = e.checkedAt;
      rank = typeof e.rank === 'number' && Number.isFinite(e.rank) && e.rank > 0 ? e.rank : null;
    }
  }
  return { rank, checkedAt };
}

const FACE_KEY = (platform: string, language: string, keyword: string) =>
  `${platform}\u0000${language}\u0000${keyword}`;

/**
 * 聚合单个竞品在指定平台的竞争面。
 * @param competitorId 竞品 id（仅用于标识/无副作用）
 * @param platform     当前平台（多平台分开统计：只吃该平台的快照）
 * @param rankEntries  该竞品的全部排名快照（函数按 platform/窗口过滤）
 * @param ownSnapshots 我方（该产品）全部排名快照
 * @param linkedKeywords 竞品手动关联的关键词（补“尚无采集”的 face，便于显示待采集）
 */
export function buildCompetitorIntel(opts: {
  platform: string;
  rankEntries: CompetitorRankEntry[];
  ownSnapshots: OwnRankSnapshot[];
  linkedKeywords?: Array<{ keyword: string; language?: string }>;
  now?: number;
}): PlatformIntel {
  const now = opts.now ?? Date.now();
  const platform = opts.platform;

  // 竞品侧：按 face 分组（窗口内）。
  const theirByFace = new Map<string, CompetitorRankEntry[]>();
  for (const e of opts.rankEntries || []) {
    const lang = String(e.language ?? 'en');
    if (e.platform != null && e.platform !== platform) continue; // 多平台分开
    if (!inWindow(e.checkedAt, now)) continue;
    const key = FACE_KEY(platform, lang, e.keyword);
    const list = theirByFace.get(key) || [];
    list.push(e);
    theirByFace.set(key, list);
  }

  // 我方侧：按 (language, keyword) 分组（窗口内；产品级即当前平台）。
  const ownByKw = new Map<string, OwnRankSnapshot[]>();
  for (const s of opts.ownSnapshots || []) {
    if (!inWindow(s.checkedAt, now)) continue;
    const lang = String(s.language ?? 'en');
    const key = `${lang}\u0000${s.keyword}`;
    const list = ownByKw.get(key) || [];
    list.push(s);
    ownByKw.set(key, list);
  }

  const faces = new Map<string, CompetitorFace>();
  const upsertFace = (language: string, keyword: string) => {
    const key = FACE_KEY(platform, language, keyword);
    let face = faces.get(key);
    if (!face) {
      face = {
        platform,
        language,
        keyword,
        theirBest: null,
        theirLatest: null,
        theirLatestCheckedAt: null,
        sampleCount: 0,
        ownBest: null,
        ownLatest: null,
        overlap: 'unknown',
        delta: null,
        longTail: false,
        weight: 1,
        threat: 0,
        contribution: 0,
        cells: [],
      };
      faces.set(key, face);
    }
    return face;
  };

  // 从竞品快照建 face 并填充竞品侧数据。
  for (const [key, entries] of theirByFace) {
    const [, language, keyword] = key.split('\u0000');
    const face = upsertFace(language, keyword);
    const ranks = entries
      .map((e) => (typeof e.rank === 'number' ? e.rank : NaN))
      .filter((r) => Number.isFinite(r) && r > 0);
    face.theirBest = bestOf(ranks);
    const latest = latestOf(entries);
    face.theirLatest = latest.rank;
    face.theirLatestCheckedAt = latest.checkedAt;
    face.sampleCount = entries.length;
  }
  // linkedKeywords 补“尚无采集”face。
  for (const link of opts.linkedKeywords || []) {
    if (!link || !link.keyword) continue;
    const language = String(link.language ?? 'en');
    upsertFace(language, link.keyword);
  }

  // 我方侧数据 + cells + 对比状态。
  for (const [key, face] of faces) {
    const [, language, keyword] = key.split('\u0000');
    const ownEntries = ownByKw.get(`${language}\u0000${keyword}`) || [];
    const ownRanks = ownEntries.map((s) => (typeof s.rank === 'number' ? s.rank : NaN)).filter((r) => Number.isFinite(r) && r > 0);
    face.ownBest = bestOf(ownRanks);
    // ownLatest：取我方最近一次 checkedAt 的名次。
    let ownLatest: number | null = null;
    let ownLatestAt: string | null = null;
    for (const s of ownEntries) {
      if (s.checkedAt && (!ownLatestAt || s.checkedAt > ownLatestAt)) {
        ownLatestAt = s.checkedAt;
        ownLatest = typeof s.rank === 'number' && Number.isFinite(s.rank) && s.rank > 0 ? s.rank : null;
      }
    }
    face.ownLatest = ownLatest;
    // cells：商店并集 = 我方该词的商店 ∪ 竞品该词的商店（窗口内）。
    const storefronts = new Set<string>();
    for (const s of ownEntries) storefronts.add(s.storefront);
    for (const e of theirByFace.get(key) || []) storefronts.add(e.storefront);
    face.cells = [...storefronts].sort().map((sf) => {
      const own = ownEntries
        .filter((s) => s.storefront === sf)
        .map((s) => (typeof s.rank === 'number' ? s.rank : NaN))
        .filter((r) => Number.isFinite(r) && r > 0);
      const theirs = (theirByFace.get(key) || [])
        .filter((e) => e.storefront === sf)
        .map((e) => (typeof e.rank === 'number' ? e.rank : NaN))
        .filter((r) => Number.isFinite(r) && r > 0);
      return {
        storefront: sf,
        own: bestOf(own),
        theirs: bestOf(theirs),
      };
    });
    // 状态判定：进榜 = 窗口内最好名次 ≤ 200。
    const ourChart = face.ownBest != null && face.ownBest <= 200;
    const theirChart = face.theirBest != null && face.theirBest <= 200;
    face.overlap = theirChart
      ? ourChart
        ? 'both'
        : 'competitorOnly'
      : ourChart
        ? 'selfOnly'
        : face.sampleCount > 0
          ? 'offChart' // 竞品有记录但都在 200 外（含双方长尾）
          : 'unknown';
    face.delta =
      face.ownBest != null && face.theirBest != null && face.ownBest <= 200 && face.theirBest <= 200
        ? face.theirBest - face.ownBest
        : null;
    face.longTail =
      face.ownLatest != null &&
      face.ownLatest > 200 &&
      face.theirLatest != null &&
      face.theirLatest > 200;
    face.weight = weightOfOurRank(face.ownBest);
    face.threat =
      face.overlap === 'both' && face.delta != null && face.delta < 0
        ? 1.5
        : face.overlap === 'both'
          ? 0.6
          : face.overlap === 'competitorOnly'
            ? 1.0
            : 0;
    face.contribution = face.weight * face.threat * (face.longTail ? LONG_TAIL_FACTOR : 1);
  }

  const list = [...faces.values()];
  let pressuredCount = 0;
  let theirOnChart = 0;
  let longTailCount = 0;
  let index = 0;
  for (const f of list) {
    index += f.contribution;
    if (f.longTail) longTailCount += 1;
    const theirLead =
      f.theirBest != null &&
      f.theirBest <= 200 &&
      (f.ownBest == null || f.ownBest > 200 || f.theirBest < f.ownBest);
    if (f.theirBest != null && f.theirBest <= 200) theirOnChart += 1;
    if (theirLead) pressuredCount += 1;
  }
  return {
    platform,
    faceCount: list.length,
    pressuredCount,
    theirOnChart,
    longTailCount,
    index: Math.round(index * 10) / 10,
    faces: list.sort((a, b) => b.contribution - a.contribution || a.keyword.localeCompare(b.keyword)),
  };
}

/** 某日（UTC）起点毫秒。 */
function startOfUtcDay(ms: number): number {
  const d = new Date(ms);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * 竞争指数随时间的日历史（每天用“截至当天”的 7 天滑动窗口重算，buildCompetitorIntel
 * 内部按窗口过滤）：供竞品行内 sparkline / 趋势。
 */
export function competitorIndexHistory(opts: {
  platform: string;
  rankEntries: CompetitorRankEntry[];
  ownSnapshots: OwnRankSnapshot[];
  linkedKeywords?: Array<{ keyword: string; language?: string }>;
  days?: number;
  now?: number;
}): Array<{ day: string; index: number; pressuredCount: number; faceCount: number }> {
  const now = opts.now ?? Date.now();
  const days = Math.min(Math.max(opts.days ?? 14, 1), 30);
  const base = startOfUtcDay(now);
  const out: Array<{ day: string; index: number; pressuredCount: number; faceCount: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = base - i * 86_400_000;
    const endOfDay = dayStart + 86_400_000 - 1;
    const intel = buildCompetitorIntel({
      platform: opts.platform,
      rankEntries: opts.rankEntries,
      ownSnapshots: opts.ownSnapshots,
      linkedKeywords: opts.linkedKeywords,
      now: endOfDay,
    });
    out.push({
      day: new Date(dayStart).toISOString().slice(0, 10),
      index: intel.index,
      pressuredCount: intel.pressuredCount,
      faceCount: intel.faceCount,
    });
  }
  return out;
}
