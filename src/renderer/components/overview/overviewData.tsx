import { Link } from "react-router-dom";
import type { RankSnapshot } from "../../stores/project";
import { STALE_MS } from "../../lib/matrix";
import { cn } from "../../lib/utils";
import { ValueFlash } from "../ui/ValueFlash";

export interface OverviewRankRow {
  keyword: string;
  language: string;
  bestRank: number;
  storefront: string;
  trend: "up" | "down" | "same" | "new";
  delta: number | null;
  checkedAt: string | null;
  stale: boolean;
}

/**
 * Per-keyword rank summary across every storefront: the best *current* rank
 * (latest snapshot per storefront), the storefront it was achieved in, and
 * the trend vs. that storefront's previous snapshot.
 */
export function overviewRankRows(
  keywords: { keyword: string; language: string }[],
  snapshots: RankSnapshot[],
): OverviewRankRow[] {
  const rows: OverviewRankRow[] = [];
  for (const keyword of keywords) {
    const own = snapshots
      .filter((s) => s.keyword === keyword.keyword && s.language === keyword.language)
      .sort((a, b) => new Date(a.checkedAt).getTime() - new Date(b.checkedAt).getTime());
    const byStorefront = new Map<string, RankSnapshot[]>();
    for (const snapshot of own) {
      const list = byStorefront.get(snapshot.storefront) || [];
      list.push(snapshot);
      byStorefront.set(snapshot.storefront, list);
    }
    let bestRank: number | null = null;
    let bestStorefront = "";
    let bestTrend: OverviewRankRow["trend"] = "same";
    let bestDelta: number | null = null;
    let bestCheckedAt: string | null = null;
    for (const [storefront, list] of byStorefront) {
      const latest = list[list.length - 1];
      if (latest.rank == null) continue;
      if (bestRank !== null && latest.rank >= bestRank) continue;
      const previous = list[list.length - 2];
      bestRank = latest.rank;
      bestStorefront = storefront;
      bestCheckedAt = latest.checkedAt;
      if (!previous || previous.rank == null) {
        bestTrend = "new";
        bestDelta = null;
      } else {
        bestDelta = previous.rank - latest.rank;
        bestTrend = bestDelta > 0 ? "up" : bestDelta < 0 ? "down" : "same";
      }
    }
    if (bestRank !== null) {
      rows.push({
        keyword: keyword.keyword,
        language: keyword.language,
        bestRank,
        storefront: bestStorefront,
        trend: bestTrend,
        delta: bestDelta,
        checkedAt: bestCheckedAt,
        stale: bestCheckedAt ? Date.now() - new Date(bestCheckedAt).getTime() > STALE_MS : true,
      });
    }
  }
  rows.sort((a, b) => a.bestRank - b.bestRank);
  return rows;
}

export const OVERVIEW_CHART_DAYS = 14;
export const OVERVIEW_CHART_COLORS = ["#f59e0b", "#3b82f6", "#10b981", "#8b5cf6", "#ef4444"];

function localDayKey(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Best rank per day (last 14 days) for the top ranked keywords, as chart series. */
export function overviewTrendData(
  rows: OverviewRankRow[],
  snapshots: RankSnapshot[],
  days = OVERVIEW_CHART_DAYS,
): { series: { key: string; label: string }[]; data: Record<string, string | number>[] } {
  const top = rows.slice(0, OVERVIEW_CHART_COLORS.length);
  const series = top.map((row) => ({
    key: `${row.language}\u0000${row.keyword}`,
    label: row.keyword,
  }));
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const byDay = new Map<string, Record<string, string | number>>();
  for (const row of top) {
    const key = `${row.language}\u0000${row.keyword}`;
    const bestPerDay = new Map<string, number>();
    for (const snapshot of snapshots) {
      if (
        snapshot.keyword !== row.keyword ||
        snapshot.language !== row.language ||
        snapshot.rank == null ||
        new Date(snapshot.checkedAt).getTime() < cutoff
      ) {
        continue;
      }
      const day = localDayKey(snapshot.checkedAt);
      const current = bestPerDay.get(day);
      if (current === undefined || snapshot.rank < current) bestPerDay.set(day, snapshot.rank);
    }
    for (const [day, rank] of bestPerDay) {
      const point = byDay.get(day) || { day };
      point[key] = rank;
      byDay.set(day, point);
    }
  }
  const data = [...byDay.values()].sort((a, b) => String(a.day).localeCompare(String(b.day)));
  return { series, data };
}

/* ── 竞品概览聚合（OverviewContent「竞品概览」卡的数据契约） ── */

/** 单个已跟踪竞品在本平台的竞争面摘要（卡片只取前三展示，合计对整表求和）。 */
export interface CompetitorOverviewEntry {
  name: string;
  /** 竞争指数（intel.index，越大威胁越高；无采集为 0）。 */
  index: number;
  /** 压制我方词数（intel.pressuredCount：竞品 ≤200 且领先或我方未进榜）。 */
  pressuredCount: number;
}

/** OverviewContent「竞品概览」卡入参；DSH 等无竞品数据的宿主不传（null）。 */
export interface CompetitorSummary {
  /** 全部已跟踪竞品（按指数降序）；卡片 slice(0,3) 展示 TOP3。 */
  top: CompetitorOverviewEntry[];
  /** 跟踪竞品总数。 */
  totalTracked: number;
  /** 事件计数：竞品词新进榜（≤200）。 */
  gained: number;
  /** 事件计数：竞品词跌出榜。 */
  dropped: number;
  /** 停滞/长期未刷新竞品数；宿主无快照时间信号可给 0（卡片据此隐藏）。 */
  stale: number;
}

/** competitors:overview 单条结果的最小形状（聚合只消费这三个字段）。 */
export interface CompetitorOverviewProfile {
  competitor?: { name?: string | null } | null;
  intel?: { index?: number; pressuredCount?: number } | null;
  events?: Array<{ kind?: string }> | null;
}

/**
 * 把 `competitors:overview` 返回的 profiles（[{ competitor, intel,
 * indexHistory, events }]）聚合成 CompetitorSummary：top 全表按 intel.index
 * 降序（卡片取前三）、gained/dropped 由 events 的 kind 计数、totalTracked =
 * profiles.length、压我方词合计 = Σ intel.pressuredCount（卡片侧对 top 求和）。
 * 无竞品/空数组 → null。纯函数（无 window/IPC 依赖），Electron OverviewPage
 * 取数后调用；其它宿主（如 DSH）可复用同一聚合。
 *
 * 注：intel/events 只携带 7/14 天窗口内的数据，无法可靠判定「快照 ≥10 天未
 * 更新」的停滞竞品数，故 stale 置 0；需要时由宿主另行补充。
 */
export function aggregateCompetitorOverview(
  profiles: CompetitorOverviewProfile[] | null | undefined,
): CompetitorSummary | null {
  if (!Array.isArray(profiles) || profiles.length === 0) return null;
  const top: CompetitorOverviewEntry[] = profiles.map((profile) => ({
    name: profile?.competitor?.name || "未命名竞品",
    index: profile?.intel?.index ?? 0,
    pressuredCount: profile?.intel?.pressuredCount ?? 0,
  }));
  top.sort((a, b) => b.index - a.index || b.pressuredCount - a.pressuredCount);
  let gained = 0;
  let dropped = 0;
  for (const profile of profiles) {
    for (const event of profile?.events || []) {
      if (event?.kind === "gained") gained += 1;
      else if (event?.kind === "dropped") dropped += 1;
    }
  }
  return { top, totalTracked: profiles.length, gained, dropped, stale: 0 };
}

/* ── 能力②：竞品优势聚合（我方占优商店 + 优势/劣势关键词，纯函数可单测） ── */

/** 单个词 × 商店的对比 cell（≤200 在榜口径：双方都在榜才比较谁名次靠前）。 */
export interface CompetitorAdvantageCell {
  storefront?: string | null;
  own?: number | null;
  theirs?: number | null;
}

/** 单个竞品在某 (语言 × 关键词) 的竞争面。 */
export interface CompetitorAdvantageFace {
  language?: string | null;
  keyword?: string | null;
  ownBest?: number | null;
  theirBest?: number | null;
  cells?: CompetitorAdvantageCell[] | null;
}

/** computeCompetitorAdvantage 的入参 = competitors:overview 单条 profile 的形状。 */
export interface CompetitorAdvantageProfile {
  competitor?: { name?: string | null } | null;
  intel?: { faces?: CompetitorAdvantageFace[] | null } | null;
}

export interface CompetitorAdvantageStorefront {
  /** 商店代码（us/cn…，展示用 storefrontDisplayName）。 */
  storefront: string;
  /** 我方在该店名次领先的竞品数（N）。 */
  leading: number;
  /** 该店名次压制我方的竞品数。 */
  trailing: number;
  /** 该店有可比数据的竞品总数（M，显示为 领先于 N/M）。 */
  compared: number;
}

export interface CompetitorAdvantageKeyword {
  keyword: string;
  language: string;
  /** 我方名次更靠前的竞品数。 */
  wins: number;
  /** 压制我方（名次比我们靠前）的竞品数。 */
  losses: number;
}

export interface CompetitorAdvantage {
  /** 是否有任何可比对数据（任一 商店×竞品 或 词×竞品 比较存在）。 */
  hasData: boolean;
  /** 我方占优商店（leading > trailing），按净领先降序。 */
  dominantStorefronts: CompetitorAdvantageStorefront[];
  /** 我方名次优于多数竞品的关键词，按净优势降序。 */
  advantageKeywords: CompetitorAdvantageKeyword[];
  /** 被多数竞品压制/对方占优的关键词，按净劣势降序。 */
  disadvantageKeywords: CompetitorAdvantageKeyword[];
}

/* ── ②发布卡：文案（storeSubmissionDrafts）行 ── */

export type SubmissionDraftStatus = "current" | "published" | "draft";

/** ②发布卡的一条「文案」：label + 更新时间 + 状态 + 语言进度分子（纯 props）。 */
export interface SubmissionDraftRow {
  /** 稳定 key（draft.id；缺失回退 projectId:tag）。 */
  key: string;
  /** 关联的发布 tag（跳转去发布页的口径）。 */
  tag: string;
  /** 展示 label：有 appVersion → v{version}，否则用 releaseTag。 */
  label: string;
  /** 文案最近更新时间（ISO；无 → null，排序置底）。 */
  updatedAt: string | null;
  /** 状态：当前（正在准备的发布候选）/ 已发布 / 草案。 */
  status: SubmissionDraftStatus;
  /** 已生成的 localizations 数（语言进度分子；0 = 未生成文案）。 */
  languageCount: number;
}

/** submissionDraftRows 的判定上下文（宿主从 release:list 结果提供）。 */
export interface SubmissionDraftContext {
  /** 当前发布周期候选的 tag（release:list 的 latestDraft.tag）；判定「当前」。 */
  currentTag?: string | null;
  /** 已真实发布的 tag 列表；判定「已发布」。比对忽略前导 v 与大小写。 */
  publishedTags?: Array<string | null | undefined> | null;
}

/** tag 归一化：去空白/小写/去前导 v（v1.0.0 ≡ 1.0.0）。 */
function normalizeDraftTag(tag: string | null | undefined): string {
  return String(tag || "").trim().toLowerCase().replace(/^v/, "");
}

/**
 * 把 project.storeSubmissionDrafts（或 blob 注入的草稿列表）聚合成 ②发布卡的
 * 纯 props 行：按 updatedAt 倒序；status 由 ctx（release:list 的 currentTag /
 * publishedTags）判定 当前/已发布/草案。无草稿 → []。纯函数（无 window/IPC）。
 */
export function submissionDraftRows(
  rawDrafts: any[] | null | undefined,
  ctx?: SubmissionDraftContext | null,
): SubmissionDraftRow[] {
  if (!Array.isArray(rawDrafts) || rawDrafts.length === 0) return [];
  const current = normalizeDraftTag(ctx?.currentTag);
  const published = new Set<string>();
  for (const tag of ctx?.publishedTags || []) {
    const key = normalizeDraftTag(tag);
    if (key) published.add(key);
  }
  const rows: SubmissionDraftRow[] = [];
  const seen = new Set<string>();
  for (const draft of rawDrafts) {
    if (!draft || typeof draft !== "object") continue;
    const tag = String(draft.releaseTag || draft.tag || "").trim();
    const version = String(draft.appVersion || "").trim().replace(/^v/i, "");
    if (!tag && !version) continue;
    const key = draft.id || `${draft.projectId || "p"}:${tag || version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const norm = normalizeDraftTag(tag);
    const status: SubmissionDraftStatus =
      current && norm === current
        ? "current"
        : published.has(norm)
          ? "published"
          : "draft";
    rows.push({
      key,
      tag,
      label: version ? `v${version}` : tag,
      updatedAt:
        typeof draft.updatedAt === "string" && draft.updatedAt ? draft.updatedAt : null,
      status,
      languageCount: Array.isArray(draft.localizations) ? draft.localizations.length : 0,
    });
  }
  rows.sort((a, b) => {
    if (!a.updatedAt) return 1;
    if (!b.updatedAt) return -1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
  return rows;
}

/* ── ①开发卡：GitHub 活跃格子图数据（activityData.commits 的近 N 周窗口） ── */

/** 格子图的一天（date 为本地 YYYY-MM-DD）。 */
export interface ActivityGridDay {
  date: string;
  count: number;
}

/** 格子图的一周列（周一开头；6 列 = 近 6 周）。 */
export interface ActivityGridColumn {
  weekStart: string;
  days: ActivityGridDay[];
}

/** activityGridColumns 的产物（纯数据，渲染交给组件）。 */
export interface ActivityGrid {
  /** 近 N 个完整周（本周列最后）。 */
  columns: ActivityGridColumn[];
  /** 最早活跃日距今的天数（窗口内无提交 → null，调用方据此退化为柱状图）。 */
  spanDays: number | null;
  /** 窗口内提交总数。 */
  total: number;
}

function activityLocalDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function activityLocalMonday(now: Date): Date {
  const dow = now.getDay();
  const daysToMonday = dow === 0 ? 6 : dow - 1;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysToMonday);
}

function activityDayDiffFrom(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const at = Date.UTC(ay, am - 1, ad);
  const bt = Date.UTC(by, bm - 1, bd);
  return Math.round((at - bt) / 86_400_000);
}

/**
 * activityData.commits（键 = 本地 YYYY-MM-DD，值 = 当日提交数）→ GitHub 风格
 * 格子图列数据：从本周周一起往前共 weeks 个完整周（周一→周日逐日取数，未来
 * 日期按 0 计）。commits 缺失/无有效键 → null（调用方显示「无活跃数据」）。
 *
 * 展示判定由调用方做：spanDays ≥ 28（≥4 周覆盖）→ 格子图；否则只剩近几天 →
 * 近 7 天柱状图。纯函数，无 window/Date.now 之外副作用。
 */
export function activityGridColumns(
  commits: Record<string, number> | null | undefined,
  weeks = 6,
): ActivityGrid | null {
  if (!commits || typeof commits !== "object") return null;
  const counts = new Map<string, number>();
  let hasKey = false;
  for (const raw of Object.keys(commits)) {
    const key = raw.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    const count = Math.max(0, Number(commits[raw]) || 0);
    if (count <= 0) continue;
    counts.set(key, (counts.get(key) || 0) + count);
    hasKey = true;
  }
  if (!hasKey) return null;

  const now = new Date();
  const today = activityLocalDayKey(now);
  const monday = activityLocalMonday(now);
  const weekCount = Math.max(1, Math.min(12, weeks));
  const columns: ActivityGridColumn[] = [];
  let total = 0;
  let earliest: string | null = null;
  for (let w = weekCount - 1; w >= 0; w -= 1) {
    const weekStart = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - w * 7);
    const days: ActivityGridDay[] = [];
    for (let d = 0; d < 7; d += 1) {
      const date = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + d);
      const key = activityLocalDayKey(date);
      const count = key <= today ? counts.get(key) || 0 : 0;
      if (count > 0) {
        total += count;
        if (!earliest || key < earliest) earliest = key;
      }
      days.push({ date: key, count });
    }
    columns.push({ weekStart: activityLocalDayKey(weekStart), days });
  }
  return {
    columns,
    spanDays: earliest && earliest <= today ? activityDayDiffFrom(today, earliest) : null,
    total,
  };
}

/* ── ①开发卡：GitHub 活跃热力图（旧 ProjectActivityCard 的近 4 个月格子图，原样迁移） ── */

/** 热力图标注用的发布（tag + 发布 ISO 时间；只取日期部分命中格子）。 */
export interface ActivityHeatmapRelease {
  tag: string;
  publishedAt: string | null;
}

/** 热力图的一天（date 为本地 YYYY-MM-DD）。 */
export interface ActivityHeatmapDay {
  date: string;
  count: number;
  /** 当天发布 tag（无 → null；命中即用黄框标格）。 */
  releaseTag: string | null;
  /** 统计窗口起点前的对齐填充日（渲染为不可见）。 */
  preRange: boolean;
  /** 今天之后（当前周内未来日，渲染为不可见）。 */
  future: boolean;
}

/** 热力图的一周列（周一起始，7 天）。 */
export interface ActivityHeatmapWeek {
  weekStart: string;
  days: ActivityHeatmapDay[];
}

/** activityHeatmap 的产物（纯数据，渲染交给组件）。 */
export interface ActivityHeatmap {
  /** 周列：自窗口起点所在周一起、到本周止，覆盖近 rangeDays 天并保证整周对齐。 */
  weeks: ActivityHeatmapWeek[];
  /** 统计窗口起点（本地 YYYY-MM-DD；其前的 preRange 天仅作对齐）。 */
  rangeStart: string;
  /** 窗口内提交总数。 */
  total: number;
  /** 窗口内最近一个有提交的日期（无 → null）。 */
  lastCommitDay: string | null;
  /** 窗口内的发布日标记数。 */
  releaseCount: number;
}

function heatmapDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function heatmapCalendarDay(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

/**
 * activityData.commits（本地 YYYY-MM-DD → 当日提交数）+ 发布列表 → GitHub 风格
 * 近 rangeDays 天热力图，语义与旧 ProjectActivityCard 完全一致（原样迁移）：
 * - 统计窗口为「今天往前 rangeDays-1 天」；网格从窗口起点所在周的周一开始按周
 *   列排布（与 GitHub 对齐），起点前的天标 preRange、当前周今天之后的天标
 *   future，两者渲染不可见，保证列对齐；横向列数固定为铺满宽度所需。
 * - 每天按提交数着色（0 灰 / 1–5 / 6–20 / 21–50 / 50+ 四档加深）；命中发布的
 *   日期带上 releaseTag（组件侧用黄框标注）。
 * - 无任何有效提交键 → null（调用方显示「无活跃数据」）。
 * 纯函数（无 window/IPC；now 仅测试注入），组件只负责渲染。
 */
export function activityHeatmap(
  commits: Record<string, number> | null | undefined,
  releases?: ActivityHeatmapRelease[] | null,
  rangeDays = 120,
  now = new Date(),
): ActivityHeatmap | null {
  if (!commits || typeof commits !== "object") return null;
  const counts = new Map<string, number>();
  for (const raw of Object.keys(commits)) {
    const key = raw.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    const count = Math.max(0, Number(commits[raw]) || 0);
    if (count <= 0) continue;
    counts.set(key, (counts.get(key) || 0) + count);
  }
  if (counts.size === 0) return null;

  const days = Math.max(7, Math.min(365, Math.round(rangeDays)));
  const todayKey = heatmapDayKey(now);
  const rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  const rangeStartKey = heatmapDayKey(rangeStart);
  // 窗口起点所在周的周一（可能早于 rangeStart 几天 → 对齐填充）。
  const dow = rangeStart.getDay();
  const gridStart = new Date(
    rangeStart.getFullYear(),
    rangeStart.getMonth(),
    rangeStart.getDate() - (dow === 0 ? 6 : dow - 1),
  );
  // 今天所在周的周一：周列自 gridStart 至该周（含），保证本周完整 7 天。
  const todayDow = now.getDay();
  const currentMonday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - (todayDow === 0 ? 6 : todayDow - 1),
  );
  const weekCount =
    Math.round((heatmapCalendarDay(currentMonday) - heatmapCalendarDay(gridStart)) / 7) + 1;

  const releaseByDay = new Map<string, string>();
  for (const release of releases || []) {
    if (!release || !release.tag || !release.publishedAt) continue;
    const day = String(release.publishedAt).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) releaseByDay.set(day, release.tag);
  }

  const weeks: ActivityHeatmapWeek[] = [];
  let total = 0;
  let lastCommitDay: string | null = null;
  let releaseCount = 0;
  for (let w = 0; w < weekCount; w += 1) {
    const weekStart = new Date(
      gridStart.getFullYear(),
      gridStart.getMonth(),
      gridStart.getDate() + w * 7,
    );
    const daysInWeek: ActivityHeatmapDay[] = [];
    for (let d = 0; d < 7; d += 1) {
      const date = new Date(
        weekStart.getFullYear(),
        weekStart.getMonth(),
        weekStart.getDate() + d,
      );
      const key = heatmapDayKey(date);
      const preRange = key < rangeStartKey;
      const future = key > todayKey;
      const count = preRange || future ? 0 : counts.get(key) || 0;
      if (count > 0) {
        total += count;
        if (!lastCommitDay || key > lastCommitDay) lastCommitDay = key;
      }
      const releaseTag = preRange || future ? null : releaseByDay.get(key) || null;
      if (releaseTag) releaseCount += 1;
      daysInWeek.push({ date: key, count, releaseTag, preRange, future });
    }
    weeks.push({ weekStart: heatmapDayKey(weekStart), days: daysInWeek });
  }
  return {
    weeks,
    rangeStart: rangeStartKey,
    total,
    lastCommitDay,
    releaseCount,
  };
}

/** ≤200 在榜口径下的单方判定：返回值是「我方对某竞品」的胜负。 */
function onChart(rank: number | null | undefined): rank is number {
  return typeof rank === "number" && Number.isFinite(rank) && rank > 0 && rank <= 200;
}

/**
 * 能力②纯函数：跨全部竞品 profiles（competitors:overview 结果）聚合出——
 * 1) 我方占优商店：按商店逐 cell 对比（双方 ≤200 才比高低；我方不在榜而竞品在榜记
 *    该店被压），竞品级取多数胜负，输出 leading > trailing 的商店列表；
 * 2) 优势/劣势关键词：按 (语言 × 关键词) 聚合「我方名次比多少竞品靠前 / 被多少竞品
 *    压制」，各自列出领先多数竞品的词（wins > losses）与被多数压制的词
 *    （losses > wins）。
 *
 * 约定：竞品不在榜（theirBest/theirs >200 或无采集）不构成对我方的压制，也不计为我方
 * 「优势」——只把有真实名次的比较计入，避免用竞品缺数据来夸大我方优势。
 *
 * 无竞品/空数组 → null（与 aggregateCompetitorOverview 同约定）；有竞品但无任何可比
 * 数据 → { hasData:false, …空数组 }。纯函数，无 window/IPC 依赖。
 */
export function computeCompetitorAdvantage(
  profiles: CompetitorAdvantageProfile[] | null | undefined,
): CompetitorAdvantage | null {
  if (!Array.isArray(profiles) || profiles.length === 0) return null;

  // 词级：keywordKey(language, keyword) → { wins, losses }（跨竞品累加）。
  const keywordStats = new Map<string, { language: string; keyword: string; wins: number; losses: number }>();
  // 商店级：storefront → per-competitor wins/losses。
  const storefrontByCompetitor = new Map<string, Map<string, { wins: number; losses: number }>>();

  for (const profile of profiles) {
    const faces = profile?.intel?.faces;
    if (!Array.isArray(faces)) continue;
    for (const face of faces) {
      const keyword = face?.keyword;
      if (!keyword) continue;
      const language = String(face?.language ?? "");
      const ownBest = face?.ownBest ?? null;
      const theirBest = face?.theirBest ?? null;

      // 词级判定（face 级 best 名次；双方都要有采集判定基础）。
      if (onChart(theirBest)) {
        const stats = keywordStats.get(`${language}\u0000${keyword}`) || {
          language,
          keyword,
          wins: 0,
          losses: 0,
        };
        if (!onChart(ownBest) || ownBest > theirBest) stats.losses += 1;
        else if (ownBest < theirBest) stats.wins += 1;
        keywordStats.set(`${language}\u0000${keyword}`, stats);
      }

      // 商店级判定（cell 级名次）。
      const cells = Array.isArray(face?.cells) ? face.cells : [];
      for (const cell of cells) {
        const storefront = cell?.storefront;
        if (!storefront) continue;
        const own = cell?.own ?? null;
        const theirs = cell?.theirs ?? null;
        let win = false;
        let loss = false;
        if (onChart(own) && onChart(theirs)) {
          win = own < theirs;
          loss = theirs < own;
        } else if (onChart(theirs) && !onChart(own)) {
          // 竞品在榜而我方不在榜 → 该词/该店被压。
          loss = true;
        }
        if (!win && !loss) continue;
        const per = storefrontByCompetitor.get(storefront) || new Map<string, { wins: number; losses: number }>();
        const acc = per.get(profile?.competitor?.name || "") || { wins: 0, losses: 0 };
        if (win) acc.wins += 1;
        if (loss) acc.losses += 1;
        per.set(profile?.competitor?.name || "", acc);
        storefrontByCompetitor.set(storefront, per);
      }
    }
  }

  const dominantStorefronts: CompetitorAdvantageStorefront[] = [];
  for (const [storefront, per] of storefrontByCompetitor) {
    let leading = 0;
    let trailing = 0;
    let compared = 0;
    for (const acc of per.values()) {
      if (acc.wins + acc.losses === 0) continue;
      compared += 1;
      if (acc.wins > acc.losses) leading += 1;
      else if (acc.losses > acc.wins) trailing += 1;
    }
    if (compared === 0) continue;
    if (leading > 0 && leading > trailing) {
      dominantStorefronts.push({ storefront, leading, trailing, compared });
    }
  }
  dominantStorefronts.sort(
    (a, b) =>
      (b.leading - b.trailing) - (a.leading - a.trailing) ||
      b.leading - a.leading ||
      a.storefront.localeCompare(b.storefront),
  );

  const advantageKeywords: CompetitorAdvantageKeyword[] = [];
  const disadvantageKeywords: CompetitorAdvantageKeyword[] = [];
  for (const stats of keywordStats.values()) {
    if (stats.wins > stats.losses && stats.wins > 0) advantageKeywords.push({ ...stats });
    else if (stats.losses > stats.wins && stats.losses > 0) disadvantageKeywords.push({ ...stats });
  }
  const byMarginDesc = (a: CompetitorAdvantageKeyword, b: CompetitorAdvantageKeyword) =>
    Math.abs(b.wins - b.losses) - Math.abs(a.wins - a.losses) ||
    (a.losses > a.wins ? b.losses - a.losses : b.wins - a.wins) ||
    a.keyword.localeCompare(b.keyword);
  advantageKeywords.sort(byMarginDesc);
  disadvantageKeywords.sort(byMarginDesc);

  const hasData = storefrontByCompetitor.size > 0 || keywordStats.size > 0;
  return { hasData, dominantStorefronts, advantageKeywords, disadvantageKeywords };
}

export function MetricBlock({
  to,
  label,
  value,
  sub,
  warn,
  highlight,
  LinkComponent = Link,
}: {
  to: string;
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
  highlight?: boolean;
  /** Link 注入：Electron 用 react-router；DSH（无 Router 上下文）传占位实现。 */
  LinkComponent?: React.ComponentType<{ to: string; className?: string; title?: string; children?: React.ReactNode; [k: string]: any }>;
}) {
  return (
    <LinkComponent
      to={to}
      title={`查看${label}`}
      className={cn(
        "block rounded-2xl border px-4 py-3 bg-white dark:bg-zinc-900 shadow-sm transition-colors hover:border-amber-500/50",
        warn
          ? "border-amber-300/70 dark:border-amber-500/30"
          : "border-zinc-200 dark:border-zinc-800",
      )}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        {label}
      </p>
      <ValueFlash
        value={value}
        mode="text"
        className={cn(
          "mt-1 text-xl font-mono font-semibold leading-none",
          highlight || warn
            ? "text-amber-600 dark:text-amber-400"
            : "text-zinc-900 dark:text-zinc-100",
        )}
      >
        {value}
      </ValueFlash>
      {sub && <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500 truncate">{sub}</p>}
    </LinkComponent>
  );
}
