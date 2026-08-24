import type { TrafficSnapshot } from "../../engine/gh-traffic";
import type { RankSnapshot } from "../stores/project";

export interface TrendPoint {
  date: string;
  bestRank: number | null;
  views: number;
  uniqueViews: number;
  clones: number;
  uniqueClones: number;
  assetDownloads: number;
  releaseTags: string[];
}

export interface TrendSeriesInput {
  trafficSnapshots: TrafficSnapshot[];
  rankSnapshots: RankSnapshot[];
  releases: { tag: string; publishedAt: string | null }[];
  rangeDays: number;
  now?: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export function buildTrendSeries(input: TrendSeriesInput): TrendPoint[] {
  const now = input.now || new Date();
  const start = new Date(now.getTime() - (input.rangeDays - 1) * DAY_MS);
  const byDay = new Map<string, TrendPoint>();
  const seed = (date: string): TrendPoint => ({
    date,
    bestRank: null,
    views: 0,
    uniqueViews: 0,
    clones: 0,
    uniqueClones: 0,
    assetDownloads: 0,
    releaseTags: [],
  });

  for (const snapshot of input.trafficSnapshots) {
    if (snapshot.date < dayKey(start.toISOString()) || snapshot.date > dayKey(now.toISOString())) continue;
    const point = byDay.get(snapshot.date) || seed(snapshot.date);
    point.views += snapshot.views || 0;
    point.uniqueViews += snapshot.uniqueViews || 0;
    point.clones += snapshot.clones || 0;
    point.uniqueClones += snapshot.uniqueClones || 0;
    point.assetDownloads += (snapshot.assetDownloads || []).reduce(
      (sum, asset) => sum + (asset.downloadCount || 0),
      0,
    );
    byDay.set(snapshot.date, point);
  }

  const rankByDay = new Map<string, number>();
  for (const rank of input.rankSnapshots) {
    if (rank.rank == null || rank.rank <= 0) continue;
    const date = dayKey(rank.checkedAt);
    const current = rankByDay.get(date);
    if (current == null || rank.rank < current) rankByDay.set(date, rank.rank);
  }
  for (const [date, rank] of rankByDay) {
    const point = byDay.get(date) || seed(date);
    point.bestRank = rank;
    byDay.set(date, point);
  }

  for (const release of input.releases) {
    if (!release.publishedAt) continue;
    const date = dayKey(release.publishedAt);
    if (date < dayKey(start.toISOString()) || date > dayKey(now.toISOString())) continue;
    const point = byDay.get(date) || seed(date);
    point.releaseTags.push(release.tag);
    byDay.set(date, point);
  }

  const result: TrendPoint[] = [];
  for (let i = 0; i < input.rangeDays; i++) {
    const date = dayKey(new Date(start.getTime() + i * DAY_MS).toISOString());
    result.push(byDay.get(date) || seed(date));
  }
  return result;
}
