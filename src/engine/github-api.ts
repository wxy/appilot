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
