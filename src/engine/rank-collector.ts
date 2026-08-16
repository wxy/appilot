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

export async function searchAppStoreRank(opts: {
  term: string;
  country: string;
  trackId: string;
  productType?: string | null;
  entity?: "software" | "macSoftware";
}): Promise<{ rank: number | null; totalResults: number }> {
  const url = new URL(ITUNES_SEARCH_URL);
  url.searchParams.set("term", opts.term);
  url.searchParams.set("country", opts.country.toUpperCase());
  url.searchParams.set("entity", opts.entity || entityForProductType(opts.productType));
  url.searchParams.set("limit", "200");

  let lastStatus = 0;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetchWithTimeout(url);
    lastStatus = res.status;
    if (res.status === 429 && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      continue;
    }
    if (!res.ok) {
      throw new Error(`iTunes Search API ${res.status}`);
    }

    const data: any = await res.json();
    const results: any[] = Array.isArray(data?.results) ? data.results : [];
    const index = results.findIndex((r) => String(r.trackId) === String(opts.trackId));

    return {
      rank: index >= 0 ? index + 1 : null,
      totalResults: results.length,
    };
  }

  throw new Error(`iTunes Search API ${lastStatus}`);
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
