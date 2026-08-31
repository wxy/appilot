/**
 * Rank snapshot storage helpers: dedupe and time-window pruning.
 */

export interface RankSnapshotLike {
  keyword: string;
  language: string;
  storefront: string;
  rank: number | null;
  totalResults: number;
  checkedAt: string;
}

export const RANK_SNAPSHOT_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
export const RANK_SNAPSHOT_MAX_PER_KEY = 120;

export function appendRankSnapshots<T extends RankSnapshotLike>(existing: T[], incoming: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const snapshot of existing) byKey.set(snapshotKey(snapshot), snapshot);
  for (const snapshot of incoming) byKey.set(snapshotKey(snapshot), snapshot);

  const now = Date.now();
  const perKey = new Map<string, T[]>();
  for (const snapshot of byKey.values()) {
    if (now - new Date(snapshot.checkedAt).getTime() > RANK_SNAPSHOT_WINDOW_MS) continue;
    const key = `${snapshot.keyword}\u0000${snapshot.language}\u0000${snapshot.storefront}`;
    const list = perKey.get(key) || [];
    list.push(snapshot);
    perKey.set(key, list);
  }
  const result: T[] = [];
  for (const list of perKey.values()) {
    list.sort((a, b) => new Date(a.checkedAt).getTime() - new Date(b.checkedAt).getTime());
    result.push(...list.slice(-RANK_SNAPSHOT_MAX_PER_KEY));
  }
  return result;
}

function snapshotKey(snapshot: RankSnapshotLike): string {
  return `${snapshot.keyword}\u0000${snapshot.language}\u0000${snapshot.storefront}\u0000${snapshot.checkedAt}`;
}
