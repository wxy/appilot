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
