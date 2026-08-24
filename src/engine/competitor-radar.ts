import { normalizeGitHubUrl } from "./git-info";
import { fetchGitHubJson } from "./gh-traffic";

export interface Competitor {
  id: string;
  name: string;
  trackId: string | null;
  platform: "ios" | "macos" | "unknown";
  githubUrl: string | null;
  notes: string;
  addedAt: string;
}

export interface CompetitorCandidate {
  trackId: string;
  trackName: string;
  genre: string;
  averageUserRating: number | null;
}

export interface CompetitorSnapshot {
  date: string;
  version: string | null;
  releaseDate: string | null;
  price: number | null;
  averageUserRating: number | null;
  ratingCount: number | null;
  stars: number | null;
  recentReleases: { tag: string; publishedAt: string | null }[];
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
}): Promise<CompetitorCandidate[]> {
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", opts.term);
  url.searchParams.set("country", opts.country.toUpperCase());
  url.searchParams.set("entity", opts.entity || "software");
  url.searchParams.set("limit", "50");
  const res = await fetchWithTimeout(url.toString());
  if (!res.ok) throw new Error(`iTunes Search API ${res.status}`);
  const data = JSON.parse(await res.text());
  return (Array.isArray(data?.results) ? data.results : [])
    .map((r: any) => ({
      trackId: String(r.trackId || ""),
      trackName: String(r.trackName || ""),
      genre: String(r.primaryGenreName || ""),
      averageUserRating: typeof r.averageUserRating === "number" ? r.averageUserRating : null,
    }))
    .filter((c: CompetitorCandidate) => c.trackId);
}

export async function fetchCompetitorSnapshot(
  competitor: Competitor,
  token?: string | null,
): Promise<CompetitorSnapshot> {
  const snapshot: CompetitorSnapshot = {
    date: new Date().toISOString().slice(0, 10),
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
      const res = await fetchWithTimeout(`https://itunes.apple.com/lookup?id=${encodeURIComponent(competitor.trackId)}`);
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
