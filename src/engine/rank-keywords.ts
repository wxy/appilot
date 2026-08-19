/**
 * Tracking keyword rules: field normalization, in-rank metadata, and
 * automatic pausing after consecutive missed checks.
 */

import type { RankSnapshotLike } from "./rank-snapshots";

export type KeywordStatus = "active" | "paused";
export type KeywordSource = "ai" | "submission" | "name" | "subtitle" | "manual";

export interface TrackedKeywordLike {
  language: string;
  keyword: string;
  rationale?: string;
  translation?: string;
  status?: KeywordStatus;
  source?: KeywordSource;
  addedAt?: string;
  bestRank?: number | null;
  lastSeenAt?: string | null;
  pausedAt?: string | null;
  pausedReason?: string | null;
}

export const PAUSE_CONSECUTIVE_MISSES = 10;

export function normalizeTrackedKeyword(item: any, now = new Date().toISOString()): TrackedKeywordLike {
  return {
    language: item.language || "unknown",
    keyword: item.keyword,
    rationale: item.rationale || "",
    translation: item.translation || "",
    status: item.status === "paused" ? "paused" : "active",
    source: (["ai", "submission", "name", "subtitle", "manual"] as const).includes(item.source)
      ? item.source
      : "manual",
    addedAt: item.addedAt || now,
    bestRank: typeof item.bestRank === "number" ? item.bestRank : null,
    lastSeenAt: item.lastSeenAt || null,
    pausedAt: item.pausedAt || null,
    pausedReason: item.pausedReason || null,
  };
}

export function enrichKeywordFromSnapshots<T extends TrackedKeywordLike>(
  keyword: T,
  snapshots: RankSnapshotLike[],
): T {
  let best: number | null = null;
  let lastSeen: string | null = null;
  for (const snapshot of snapshots) {
    if (snapshot.keyword !== keyword.keyword || snapshot.language !== keyword.language) continue;
    if (snapshot.rank == null) continue;
    if (best === null || snapshot.rank < best) best = snapshot.rank;
    if (lastSeen === null || new Date(snapshot.checkedAt).getTime() > new Date(lastSeen).getTime()) {
      lastSeen = snapshot.checkedAt;
    }
  }
  return { ...keyword, bestRank: best, lastSeenAt: lastSeen };
}

export function evaluatePause<T extends TrackedKeywordLike>(
  keyword: T,
  snapshots: RankSnapshotLike[],
  consecutive = PAUSE_CONSECUTIVE_MISSES,
): T {
  const own = snapshots
    .filter((s) => s.keyword === keyword.keyword && s.language === keyword.language)
    .sort((a, b) => new Date(a.checkedAt).getTime() - new Date(b.checkedAt).getTime());
  const byStorefront = new Map<string, RankSnapshotLike[]>();
  for (const snapshot of own) {
    const list = byStorefront.get(snapshot.storefront) || [];
    list.push(snapshot);
    byStorefront.set(snapshot.storefront, list);
  }
  const mature = [...byStorefront.values()].filter((list) => list.length >= consecutive);
  if (mature.length === 0) return keyword;
  const allMissed = mature.every((list) => list.slice(-consecutive).every((s) => s.rank == null));
  if (!allMissed) return keyword;
  return {
    ...keyword,
    status: "paused",
    pausedAt: keyword.pausedAt || new Date().toISOString(),
    pausedReason: `连续 ${consecutive} 次未在榜（${mature.map((l) => l[l.length - 1].storefront).join("、")}）`,
  };
}
