import { normalizeGitHubUrl } from "./git-info";
import { fetchGitHubJson } from "./gh-traffic";
import { storefrontsForLanguage } from "./storefronts";

export interface Competitor {
  id: string;
  name: string;
  trackId: string | null;
  platform: "ios" | "macos" | "unknown";
  githubUrl: string | null;
  notes: string;
  addedAt: string;
  /** 添加竞品时关联的关键词（按 (竞品, 关键词, 商店) 采集排名）。 */
  linkedKeywords?: { keyword: string; language: string }[];
}

export interface CompetitorCandidate {
  trackId: string;
  trackName: string;
  genre: string;
  averageUserRating: number | null;
  trackViewUrl: string | null;
  /** 命中该候选的商店（多商店合并搜索时标记来源）。 */
  country?: string;
}

export interface CompetitorSnapshot {
  date: string;
  /** 采集该快照的商店。 */
  country: string;
  version: string | null;
  releaseDate: string | null;
  price: number | null;
  averageUserRating: number | null;
  ratingCount: number | null;
  stars: number | null;
  recentReleases: { tag: string; publishedAt: string | null }[];
}

export interface CompetitorRankSnapshot {
  keyword: string;
  language: string;
  storefront: string;
  rank: number | null;
  checkedAt: string;
}

export function createCompetitor(input: Omit<Competitor, "id" | "addedAt">): Competitor {
  const id = input.trackId
    ? `cid-${input.trackId}`
    : `cid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { ...input, id, addedAt: new Date().toISOString() };
}

async function fetchWithTimeout(url: string, timeoutMs = 15_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function searchCompetitorCandidates(opts: {
  term: string;
  country: string;
  entity?: "software" | "macSoftware";
  excludeTrackIds?: string[];
  excludeBundleIds?: string[];
}): Promise<CompetitorCandidate[]> {
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", opts.term);
  url.searchParams.set("country", opts.country.toUpperCase());
  url.searchParams.set("entity", opts.entity || "software");
  url.searchParams.set("limit", "50");
  const res = await fetchWithTimeout(url.toString());
  if (!res.ok) throw new Error(`iTunes Search API ${res.status}`);
  const data = JSON.parse(await res.text());
  const excludedTrack = new Set(opts.excludeTrackIds || []);
  const excludedBundle = new Set(opts.excludeBundleIds || []);
  return (Array.isArray(data?.results) ? data.results : [])
    .filter(
      (r: any) =>
        !excludedTrack.has(String(r.trackId || "")) &&
        !(r.bundleId && excludedBundle.has(String(r.bundleId))),
    )
    .map((r: any) => ({
      trackId: String(r.trackId || ""),
      trackName: String(r.trackName || ""),
      genre: String(r.primaryGenreName || ""),
      averageUserRating: typeof r.averageUserRating === "number" ? r.averageUserRating : null,
      trackViewUrl: typeof r.trackViewUrl === "string" ? r.trackViewUrl : null,
      country: opts.country,
    }))
    .filter((c: CompetitorCandidate) => c.trackId);
}

/**
 * Search across several storefronts in parallel and merge by trackId,
 * keeping first-storefront order. Lets niche/local competitors surface
 * instead of only the global names iTunes ranks first in one store.
 */
export async function searchCompetitorCandidatesAcross(opts: {
  term: string;
  countries: string[];
  entity?: "software" | "macSoftware";
  excludeTrackIds?: string[];
  excludeBundleIds?: string[];
}): Promise<CompetitorCandidate[]> {
  const perCountry = await Promise.all(
    opts.countries.map((country) =>
      searchCompetitorCandidates({
        term: opts.term,
        country,
        entity: opts.entity,
        excludeTrackIds: opts.excludeTrackIds,
        excludeBundleIds: opts.excludeBundleIds,
      }).catch(() => []),
    ),
  );
  const seen = new Set<string>();
  const merged: CompetitorCandidate[] = [];
  for (const list of perCountry) {
    for (const candidate of list) {
      if (seen.has(candidate.trackId)) continue;
      seen.add(candidate.trackId);
      merged.push(candidate);
    }
  }
  return merged;
}

export async function fetchCompetitorSnapshot(
  competitor: Competitor,
  token?: string | null,
  country = "us",
): Promise<CompetitorSnapshot> {
  const snapshot: CompetitorSnapshot = {
    date: new Date().toISOString().slice(0, 10),
    country,
    version: null,
    releaseDate: null,
    price: null,
    averageUserRating: null,
    ratingCount: null,
    stars: null,
    recentReleases: [],
  };

  if (competitor.trackId) {
    try {
      const res = await fetchWithTimeout(
        `https://itunes.apple.com/lookup?id=${encodeURIComponent(competitor.trackId)}&country=${encodeURIComponent(country)}`,
      );
      if (res.ok) {
        const data = JSON.parse(await res.text());
        const app = Array.isArray(data?.results) ? data.results[0] : null;
        if (app) {
          snapshot.version = app.version ?? null;
          snapshot.releaseDate = app.currentVersionReleaseDate ?? null;
          snapshot.price = typeof app.price === "number" ? app.price : null;
          snapshot.averageUserRating = typeof app.averageUserRating === "number" ? app.averageUserRating : null;
          snapshot.ratingCount = typeof app.userRatingCount === "number" ? app.userRatingCount : null;
        }
      }
    } catch {
      // Non-fatal: keep the rest of the snapshot.
    }
  }

  if (competitor.githubUrl) {
    const repoUrl = normalizeGitHubUrl(competitor.githubUrl);
    const ownerRepo = repoUrl?.replace("https://github.com/", "") || null;
    if (ownerRepo) {
      const base = `https://api.github.com/repos/${ownerRepo}`;
      const [repoRes, releasesRes] = await Promise.all([
        fetchGitHubJson(base, token),
        fetchGitHubJson(`${base}/releases?per_page=5`, token),
      ]);
      if (repoRes.ok) snapshot.stars = repoRes.json.stargazers_count ?? null;
      if (releasesRes.ok && Array.isArray(releasesRes.json)) {
        snapshot.recentReleases = releasesRes.json.map((r: any) => ({
          tag: r.tag_name || "",
          publishedAt: r.published_at || null,
        }));
      }
    }
  }

  return snapshot;
}

/**
 * Collect the competitor's rank for every linked keyword × storefront pair
 * (per-language storefronts). Deterministic lookup against the competitor's
 * trackId — same mechanism as our own ranking.
 */
export async function collectCompetitorRankSnapshots(
  competitor: Competitor,
): Promise<CompetitorRankSnapshot[]> {
  if (!competitor.trackId || !competitor.linkedKeywords?.length) return [];
  const { searchAppStoreRank } = await import("./rank-collector");
  const productType = competitor.platform === "macos" ? "macos" : "ios";
  const checkedAt = new Date().toISOString();
  const entries: CompetitorRankSnapshot[] = [];
  for (const link of competitor.linkedKeywords) {
    const storefronts = storefrontsForLanguage(link.language) || [];
    for (const storefront of storefronts) {
      const result = await searchAppStoreRank({
        term: link.keyword,
        country: storefront,
        trackId: competitor.trackId,
        productType,
      }).catch(() => null);
      entries.push({
        keyword: link.keyword,
        language: link.language,
        storefront,
        rank: result?.rank ?? null,
        checkedAt,
      });
    }
  }
  return entries;
}

export function competitorDeltaSummary(
  competitor: Competitor,
  snapshots: CompetitorSnapshot[],
  days = 7,
): { name: string; change: string } | null {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const recent = snapshots.filter((snapshot) => snapshot.date >= cutoff);
  if (recent.length < 2) return null;
  const latest = recent[recent.length - 1];
  const previous = recent[recent.length - 2];
  const parts: string[] = [];
  if (latest.version && previous.version && latest.version !== previous.version) {
    parts.push(`v${previous.version} → v${latest.version}`);
  }
  if (latest.stars != null && previous.stars != null && latest.stars !== previous.stars) {
    const starsDelta = latest.stars - previous.stars;
    parts.push(`★${starsDelta > 0 ? "+" : ""}${starsDelta}`);
  }
  const newReleases = (latest.recentReleases || []).filter(
    (release) => release.publishedAt && release.publishedAt.slice(0, 10) >= cutoff,
  ).length;
  if (newReleases > 0) parts.push(`${newReleases} 个新 release`);
  return parts.length > 0 ? { name: competitor.name, change: parts.join("，") } : null;
}
