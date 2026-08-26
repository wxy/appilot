/**
 * Pure helpers for the tracking-keyword matrix view.
 *
 * `language: "en"` is treated as GLOBAL keywords: they are tracked in every
 * storefront and shown in every language view with a "全局" badge.
 */

export function trackingLanguageOptions(
  supported: { code: string; name: string }[],
): { code: string; label: string }[] {
  const options = supported.map((language) =>
    language.code === "en"
      ? { code: "en", label: "英文" }
      : { code: language.code, label: language.name },
  );
  if (!supported.some((language) => language.code === "en")) {
    options.push({ code: "en", label: "英文" });
  }
  return [
    ...options.filter((option) => option.code === "en"),
    ...options.filter((option) => option.code !== "en"),
  ];
}

export function matrixFilterKeywords<T extends { language: string }>(
  keywords: T[],
  viewLang: string,
): T[] {
  return keywords.filter((keyword) => keyword.language === viewLang || keyword.language === "en");
}

export const STALE_MS = 36 * 60 * 60 * 1000;

export interface MatrixSnapshot {
  keyword: string;
  storefront: string;
  rank: number | null;
  totalResults: number;
  checkedAt: string;
}

export interface MatrixCell {
  rank: number | null; // null = 未查询
  beyond200: boolean; // 已查询但不在前 200
  delta: number | null;
  trend: "none" | "new" | "lost" | "up" | "down" | "same";
  checkedAt: string | null;
  totalResults: number | null;
}

export function matrixCellState(
  snapshots: MatrixSnapshot[],
  keyword: string,
  storefront: string,
): MatrixCell {
  const list = snapshots
    .filter((snapshot) => snapshot.keyword === keyword && snapshot.storefront === storefront)
    .sort((a, b) => new Date(a.checkedAt).getTime() - new Date(b.checkedAt).getTime());
  const latest = list[list.length - 1];
  if (!latest) {
    return {
      rank: null,
      beyond200: false,
      delta: null,
      trend: "none",
      checkedAt: null,
      totalResults: null,
    };
  }
  const previous = list[list.length - 2];
  let delta: number | null = null;
  let trend: MatrixCell["trend"] = "same";
  if (previous?.rank == null && latest.rank != null) trend = "new";
  else if (previous?.rank != null && latest.rank == null) trend = "lost";
  else if (previous?.rank != null && latest.rank != null) {
    delta = previous.rank - latest.rank;
    if (delta > 0) trend = "up";
    else if (delta < 0) trend = "down";
  }
  return {
    rank: latest.rank,
    beyond200: latest.rank == null,
    delta,
    trend,
    checkedAt: latest.checkedAt,
    totalResults: latest.totalResults,
  };
}

export function matrixColumnMeta(
  snapshots: { storefront: string; checkedAt: string }[],
  storefront: string,
): { lastCheckedAt: string | null; stale: boolean } {
  const times = snapshots
    .filter((snapshot) => snapshot.storefront === storefront)
    .map((snapshot) => new Date(snapshot.checkedAt).getTime());
  if (times.length === 0) return { lastCheckedAt: null, stale: false };
  const last = Math.max(...times);
  return {
    lastCheckedAt: new Date(last).toISOString(),
    stale: Date.now() - last > STALE_MS,
  };
}

export function matrixRowGroups<T extends { keyword: string }>(
  rows: T[],
  columns: { storefront: string }[],
  snapshots: MatrixSnapshot[],
): { ranked: { row: T; bestRank: number }[]; unranked: T[] } {
  const ranked: { row: T; bestRank: number }[] = [];
  const unranked: T[] = [];
  for (const row of rows) {
    let best = Number.POSITIVE_INFINITY;
    for (const column of columns) {
      const cell = matrixCellState(snapshots, row.keyword, column.storefront);
      if (cell.rank != null && cell.rank < best) best = cell.rank;
    }
    if (best === Number.POSITIVE_INFINITY) unranked.push(row);
    else ranked.push({ row, bestRank: best });
  }
  ranked.sort((a, b) => a.bestRank - b.bestRank);
  return { ranked, unranked };
}
