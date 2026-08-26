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

export function MetricBlock({
  to,
  label,
  value,
  sub,
  warn,
  highlight,
}: {
  to: string;
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
  highlight?: boolean;
}) {
  return (
    <Link
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
    </Link>
  );
}
