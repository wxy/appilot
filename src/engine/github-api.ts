import crypto from "crypto";
import { getRemoteUrl, normalizeGitHubUrl } from "./git-info";
import { log } from "./logger";

export interface ReleasePullRequest {
  number: number;
  title: string | null;
  /** Filled when the PR was fetched from GitHub (token or public repo). */
  body?: string;
  url?: string | null;
  viaToken?: boolean;
  /** Commit count reported by the PR API (merged PR list). */
  commits?: number;
  /** merged_at from the PR API; used to bound the release range. */
  mergedAt?: string | null;
  /** Commit shas belonging to this PR, intersected with the local material later. */
  commitShas?: string[];
}

export interface GitHubReleaseInfo {
  name: string | null;
  body: string;
  publishedAt: string | null;
  url: string | null;
  /** True when the announcement was fetched with the saved GitHub token
   *  (private repositories, or draft releases the account can see). */
  viaToken?: boolean;
}

export interface GitHubReleaseItem {
  id: number;
  /** tag_name; null for drafts that have not been assigned a tag yet. */
  tag: string | null;
  name: string | null;
  body: string;
  draft: boolean;
  prerelease: boolean;
  createdAt: string | null;
  publishedAt: string | null;
  url: string | null;
  viaToken: boolean;
}

const prInfoCache = new Map<
  string,
  {
    at: number;
    info: { title: string | null; body: string; url: string | null; viaToken: boolean };
  }
>();
const PR_INFO_TTL_MS = 30 * 60_000;

const mergedPrCache = new Map<
  string,
  { at: number; prs: ReleasePullRequest[] }
>();
const MERGED_PR_TTL_MS = 30 * 60_000;

function tokenTag(token?: string | null): string {
  return token
    ? `t${crypto.createHash("sha256").update(token).digest("hex").slice(0, 12)}`
    : "anon";
}

function githubHeaders(token?: string | null): Record<string, string> {
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    Accept: "application/vnd.github+json",
    "User-Agent": "appilot",
  };
}

async function fetchDefaultBranch(
  ownerRepo: string,
  token?: string | null,
  onStats?: (requestBytes: number, responseBytes: number) => void,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(`https://api.github.com/repos/${ownerRepo}`, {
      headers: githubHeaders(token),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const raw = await response.text();
    onStats?.(ownerRepo.length + (token ? token.length + 24 : 0) + 40, raw.length);
    const data: any = JSON.parse(raw);
    return typeof data?.default_branch === "string" ? data.default_branch : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPrCommitShas(
  ownerRepo: string,
  number: number,
  token?: string | null,
  onStats?: (requestBytes: number, responseBytes: number) => void,
): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(
      `https://api.github.com/repos/${ownerRepo}/pulls/${number}/commits?per_page=100`,
      { headers: githubHeaders(token), signal: controller.signal },
    );
    if (!response.ok) return [];
    const raw = await response.text();
    onStats?.(number.toString().length + (token ? token.length + 24 : 0) + 80, raw.length);
    const data: any[] = JSON.parse(raw);
    return Array.isArray(data)
      ? data.map((item: any) => (typeof item?.sha === "string" ? item.sha : "")).filter(Boolean)
      : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * List merged pull requests on the default branch whose merged_at is at or
 * after `sinceDate` (the last generation boundary). This is the authoritative
 * PR source for the change summary: it works even when commit subjects carry
 * no "#N" reference (regular "Merge pull request" merges).
 *
 * Degradation ladder:
 * - With a token: full list (private repos included) + per-PR commit shas.
 * - Without a token: anonymous list for public repos; commit shas are skipped
 *   to stay inside the anonymous rate limit.
 * - Offline / private / rate limited: [] and the caller falls back to the
 *   locally derived PR references.
 *
 * Never throws; failures degrade to [].
 */
export async function fetchMergedPullRequests(
  localPath: string,
  sinceDate?: string | null,
  token?: string | null,
  onStats?: (requestBytes: number, responseBytes: number) => void,
): Promise<ReleasePullRequest[]> {
  const remote = await getRemoteUrl(localPath);
  const repoUrl = normalizeGitHubUrl(remote);
  if (!repoUrl) return [];
  const ownerRepo = repoUrl.replace("https://github.com/", "");
  const key = `${ownerRepo}#${sinceDate || "all"}#${tokenTag(token)}`;
  const cached = mergedPrCache.get(key);
  if (cached && Date.now() - cached.at < MERGED_PR_TTL_MS) return cached.prs;

  const cutoff = sinceDate ? new Date(sinceDate).getTime() : 0;
  const defaultBranch = await fetchDefaultBranch(ownerRepo, token, onStats);
  const bases = Array.from(
    new Set([defaultBranch, "main", "master"].filter(Boolean) as string[]),
  );

  const prs: ReleasePullRequest[] = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    for (const base of bases) {
      if (prs.length > 0) break;
      for (let page = 1; page <= 3 && prs.length < 50; page += 1) {
        const url =
          `https://api.github.com/repos/${ownerRepo}/pulls` +
          `?state=closed&base=${base}&sort=updated&direction=desc&per_page=100&page=${page}`;
        const response = await fetch(url, {
          headers: githubHeaders(token),
          signal: controller.signal,
        });
        if (!response.ok) break;
        const raw = await response.text();
        onStats?.(
          url.length + (token ? token.length + 24 : 0),
          raw.length,
        );
        const data: any[] = JSON.parse(raw);
        if (!Array.isArray(data) || data.length === 0) break;
        for (const item of data) {
          if (prs.length >= 50) break;
          const mergedAt =
            typeof item?.merged_at === "string" ? item.merged_at : null;
          if (cutoff && (!mergedAt || new Date(mergedAt).getTime() < cutoff)) {
            continue;
          }
          prs.push({
            number: item.number,
            title: typeof item.title === "string" ? item.title : null,
            body: typeof item.body === "string" ? item.body : "",
            url: typeof item.html_url === "string" ? item.html_url : null,
            viaToken: Boolean(token),
            commits: typeof item.commits === "number" ? item.commits : undefined,
            mergedAt,
          });
        }
      }
    }

    // De-duplicate: the same PR can surface again when multiple base branches
    // are probed or pages overlap.
    const deduped: ReleasePullRequest[] = [];
    const seenNumbers = new Set<number>();
    for (const pr of prs) {
      if (seenNumbers.has(pr.number)) continue;
      seenNumbers.add(pr.number);
      deduped.push(pr);
    }

    // Per-PR commit shas let the workbench map checked PRs to real commits for
    // the AI material. Only fetched with a token (parallel, bounded at 10 PRs).
    const withShas = await Promise.all(
      deduped.slice(0, 10).map(async (pr) =>
        token
          ? {
              ...pr,
              commitShas: await fetchPrCommitShas(ownerRepo, pr.number, token, onStats),
            }
          : pr,
      ),
    );
    const result = [...withShas, ...deduped.slice(10)];
    mergedPrCache.set(key, { at: Date.now(), prs: result });
    return result;
  } catch (err: any) {
    log.warn(`fetchMergedPullRequests failed for ${ownerRepo}: ${err.message}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * List GitHub releases (newest first), including drafts when the token
 * account has push access to the repository.
 *
 * Degradation ladder:
 * - With a token: full listing (drafts visible for push-access accounts).
 * - Without a token: anonymous read of a public repo returns published
 *   releases only (drafts are never returned anonymously).
 * - Private repo / offline / rate limit: returns [] and the caller falls
 *   back to local git tags.
 *
 * Never throws; failures degrade to [].
 */
export async function listGitHubReleases(
  localPath: string,
  token?: string | null,
  onStats?: (requestBytes: number, responseBytes: number) => void,
): Promise<GitHubReleaseItem[]> {
  try {
    const remote = await getRemoteUrl(localPath);
    const repoUrl = normalizeGitHubUrl(remote);
    if (!repoUrl) return [];
    const ownerRepo = repoUrl.replace("https://github.com/", "");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(
        `https://api.github.com/repos/${ownerRepo}/releases?per_page=30`,
        {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            Accept: "application/vnd.github+json",
            "User-Agent": "appilot",
          },
          signal: controller.signal,
        },
      );
      if (!response.ok) return [];
      const raw = await response.text();
      const data: any = JSON.parse(raw);
      if (!Array.isArray(data)) return [];
      onStats?.(
        repoUrl.length + (token ? token.length + 24 : 0),
        raw.length,
      );
      return data
        .map((item) => ({
          id: Number(item.id) || 0,
          tag: typeof item.tag_name === "string" && item.tag_name ? item.tag_name : null,
          name: typeof item.name === "string" ? item.name : null,
          body: typeof item.body === "string" ? item.body : "",
          draft: Boolean(item.draft),
          prerelease: Boolean(item.prerelease),
          createdAt: typeof item.created_at === "string" ? item.created_at : null,
          publishedAt: typeof item.published_at === "string" ? item.published_at : null,
          url: typeof item.html_url === "string" ? item.html_url : null,
          viaToken: Boolean(token),
        }))
        .sort((a, b) =>
          String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
        );
    } finally {
      clearTimeout(timer);
    }
  } catch (err: any) {
    log.warn(`listGitHubReleases failed: ${err.message}`);
    return [];
  }
}

/**
 * Best-effort fetch of the GitHub release announcement for a tag.
 * Without a token only published releases of public repos are readable;
 * with a token private repos work, and drafts are returned when the token
 * account has push access to the repository.
 * Returns null silently on 404 / drafts without access / rate limits / offline.
 */
export async function fetchGitHubRelease(
  localPath: string,
  tag: string,
  token?: string | null,
  onStats?: (requestBytes: number, responseBytes: number) => void,
): Promise<GitHubReleaseInfo | null> {
  try {
    const remote = await getRemoteUrl(localPath);
    const repoUrl = normalizeGitHubUrl(remote);
    if (!repoUrl) return null;
    const ownerRepo = repoUrl.replace("https://github.com/", "");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(
        `https://api.github.com/repos/${ownerRepo}/releases/tags/${encodeURIComponent(tag)}`,
        {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            Accept: "application/vnd.github+json",
            "User-Agent": "appilot",
          },
          signal: controller.signal,
        },
      );
      if (!response.ok) return null;
      const raw = await response.text();
      const data = JSON.parse(raw);
      if (!data || typeof data.tag_name !== "string") return null;
      onStats?.(
        repoUrl.length + (token ? token.length + 24 : 0),
        raw.length,
      );
      return {
        name: typeof data.name === "string" ? data.name : null,
        body: typeof data.body === "string" ? data.body : "",
        publishedAt: typeof data.published_at === "string" ? data.published_at : null,
        url: typeof data.html_url === "string" ? data.html_url : null,
        viaToken: Boolean(token),
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (err: any) {
    log.warn(`fetchPublicGitHubRelease failed for ${tag}: ${err.message}`);
    return null;
  }
}

/**
 * Enrich PR references with titles/URLs fetched from the GitHub API.
 * Works anonymously for public repos; with a token private repos work too.
 * Falls back to the locally derived reference on any failure, so this never
 * blocks release detection.
 */
export async function fetchPullRequests(
  localPath: string,
  refs: ReleasePullRequest[],
  token?: string | null,
  onStats?: (requestBytes: number, responseBytes: number) => void,
): Promise<ReleasePullRequest[]> {
  if (refs.length === 0) return [];
  const remote = await getRemoteUrl(localPath);
  const repoUrl = normalizeGitHubUrl(remote);
  if (!repoUrl) return refs.map((ref) => ({ ...ref }));
  const ownerRepo = repoUrl.replace("https://github.com/", "");
  const results = await Promise.all(
    refs.map(async (ref) => {
      // Anonymous and authenticated fetches can return different data
      // (private PRs), and different tokens may see different repos — key the
      // cache by token hash so a token change never serves stale PR info.
      const tokenTag = token
        ? `t${crypto.createHash("sha256").update(token).digest("hex").slice(0, 12)}`
        : "anon";
      const cacheKey = `${ownerRepo}#${ref.number}#${tokenTag}`;
      const cached = prInfoCache.get(cacheKey);
      if (cached && Date.now() - cached.at < PR_INFO_TTL_MS) {
        return { number: ref.number, ...cached.info };
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      try {
        const response = await fetch(
          `https://api.github.com/repos/${ownerRepo}/pulls/${ref.number}`,
          {
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              Accept: "application/vnd.github+json",
              "User-Agent": "appilot",
            },
            signal: controller.signal,
          },
        );
        if (!response.ok) return { number: ref.number, title: ref.title };
        const raw = await response.text();
        const data: any = JSON.parse(raw);
        onStats?.(ref.number.toString().length + (token ? token.length + 24 : 0) + 60, raw.length);
        const info = {
          title: typeof data.title === "string" ? data.title : ref.title,
          body: typeof data.body === "string" ? data.body : "",
          url: typeof data.html_url === "string" ? data.html_url : null,
          viaToken: Boolean(token),
        };
        prInfoCache.set(cacheKey, { at: Date.now(), info });
        return { number: ref.number, ...info };
      } catch {
        return { number: ref.number, title: ref.title };
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  return results;
}
