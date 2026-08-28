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

const repoCapCache = new Map<
  string,
  { at: number; value: GitHubRepoCapabilities }
>();
const REPO_CAP_TTL_MS = 10 * 60_000;

export interface GitHubRepoCapabilities {
  /** True when the saved credential can see draft releases (write access on
   *  releases); false when it is definitely read-only; null when unknown
   *  (no token / offline / non-repo / unrecognized token type). */
  push: boolean | null;
  /** Kind of credential observed from the API response headers. */
  tokenKind: "fine-grained" | "classic" | "none" | "unknown";
  /** Fine-grained token's Contents permission reported by GitHub, when
   *  available. `write` is what makes draft releases visible. */
  contents: "read" | "write" | null;
}

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

/**
 * Check whether the saved token can see draft releases. GitHub hides drafts
 * from credentials without push/write access, and the value reported by
 * `GET /repos` (`permissions.push`) reflects the *account's* access, not the
 * token's — a fine-grained token with Contents: read on an admin-owned repo
 * still reports push=true there. So we probe the releases endpoint and read
 * the token-scope headers instead:
 *  - fine-grained tokens: `x-accepted-github-permissions: contents=…`
 *  - classic tokens: `x-oauth-scopes` (repo / public_repo ⇒ write)
 * Cached for 10 minutes; never throws (unknown on failure).
 */
export async function fetchRepoCapabilities(
  localPath: string,
  token?: string | null,
): Promise<GitHubRepoCapabilities> {
  if (!token) return { push: null, tokenKind: "none", contents: null };
  const remote = await getRemoteUrl(localPath);
  const repoUrl = normalizeGitHubUrl(remote);
  if (!repoUrl) return { push: null, tokenKind: "unknown", contents: null };
  const ownerRepo = repoUrl.replace("https://github.com/", "");
  const key = `${ownerRepo}#${tokenTag(token)}`;
  const cached = repoCapCache.get(key);
  if (cached && Date.now() - cached.at < REPO_CAP_TTL_MS) return cached.value;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(
      `https://api.github.com/repos/${ownerRepo}/releases?per_page=1`,
      {
        headers: githubHeaders(token),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      log.warn(`fetchRepoCapabilities failed for ${ownerRepo}: status=${response.status}`);
      return { push: null, tokenKind: "unknown", contents: null };
    }
    await response.text(); // drain body so the connection can be reused
    const value = capabilitiesFromHeaders(response.headers);
    log.debug(`fetchRepoCapabilities: ${ownerRepo} → ${JSON.stringify(value)}`);
    repoCapCache.set(key, { at: Date.now(), value });
    return value;
  } catch {
    return { push: null, tokenKind: "unknown", contents: null };
  } finally {
    clearTimeout(timer);
  }
}

function capabilitiesFromHeaders(headers: Headers): GitHubRepoCapabilities {
  // Fine-grained tokens report the permission used for the request, e.g.
  // "contents=read, metadata=read". Contents: write is what unlocks drafts.
  const accepted = headers.get("x-accepted-github-permissions") || "";
  const contentsMatch = /(?:^|,\s*)contents=(\w+)/.exec(accepted);
  if (contentsMatch) {
    const contents = contentsMatch[1] === "write" ? "write" : "read";
    return { push: contents === "write", tokenKind: "fine-grained", contents };
  }
  // Classic PATs / OAuth tokens return their scopes, e.g. "repo" or
  // "public_repo"; either grants write access to (public) repositories.
  const scopes = (headers.get("x-oauth-scopes") || "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  if (scopes.length > 0) {
    return {
      push: scopes.includes("repo") || scopes.includes("public_repo"),
      tokenKind: "classic",
      contents: null,
    };
  }
  return { push: null, tokenKind: "unknown", contents: null };
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
        let response = await fetch(url, {
          headers: githubHeaders(token),
          signal: controller.signal,
        });
        let effectiveToken = Boolean(token);
        if (token && (response.status === 401 || response.status === 403)) {
          response = await fetch(url, {
            headers: githubHeaders(null),
            signal: controller.signal,
          });
          effectiveToken = false;
        }
        if (!response.ok) break;
        const raw = await response.text();
        onStats?.(
          url.length + (effectiveToken ? token!.length + 24 : 0),
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
            viaToken: effectiveToken,
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
      const url = `https://api.github.com/repos/${ownerRepo}/releases?per_page=30`;
      let response = await fetch(url, {
        headers: githubHeaders(token),
        signal: controller.signal,
      });
      let effectiveToken = Boolean(token);
      if (token && (response.status === 401 || response.status === 403)) {
        // The saved token is rejected (expired/revoked). Retry anonymously so
        // published releases still surface; drafts stay invisible without a
        // token that has push access to the repository.
        log.warn(`listGitHubReleases token rejected for ${ownerRepo}: status=${response.status}`);
        response = await fetch(url, {
          headers: githubHeaders(null),
          signal: controller.signal,
        });
        effectiveToken = false;
      }
      if (!response.ok) return [];
      const raw = await response.text();
      const data: any = JSON.parse(raw);
      if (!Array.isArray(data)) return [];
      log.debug(
        `listGitHubReleases: ${ownerRepo} → ${data.length} releases (${data.filter((item: any) => item?.draft).length} drafts, viaToken=${effectiveToken})`,
      );
      onStats?.(
        repoUrl.length + (effectiveToken ? token!.length + 24 : 0),
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
          viaToken: effectiveToken,
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
        const url = `https://api.github.com/repos/${ownerRepo}/pulls/${ref.number}`;
        let response = await fetch(url, {
          headers: githubHeaders(token),
          signal: controller.signal,
        });
        let effectiveToken = Boolean(token);
        if (token && (response.status === 401 || response.status === 403)) {
          // The saved token is rejected (expired/revoked). Retry anonymously
          // so public repos still surface PR titles under the degradation
          // ladder; private repos simply keep the locally derived reference.
          response = await fetch(url, {
            headers: githubHeaders(null),
            signal: controller.signal,
          });
          effectiveToken = false;
        }
        if (!response.ok) return { number: ref.number, title: ref.title };
        const raw = await response.text();
        const data: any = JSON.parse(raw);
        onStats?.(
          ref.number.toString().length + (effectiveToken ? token!.length + 24 : 0) + 60,
          raw.length,
        );
        const info = {
          title: typeof data.title === "string" ? data.title : ref.title,
          body: typeof data.body === "string" ? data.body : "",
          url: typeof data.html_url === "string" ? data.html_url : null,
          viaToken: effectiveToken,
        };
        prInfoCache.set(cacheKey, { at: Date.now(), info });
        if (!effectiveToken && token) {
          prInfoCache.set(`${ownerRepo}#${ref.number}#anon`, {
            at: Date.now(),
            info,
          });
        }
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
