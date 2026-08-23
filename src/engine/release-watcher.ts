/**
 * Release watcher — first-principles model.
 *
 * - The material boundary is Appilot's own memory (`lastSeenSha` = the HEAD
 *   sha at the last draft generation). What's-new always covers EVERYTHING
 *   committed since then, so missed tags/releases never lose content.
 * - A main-line git tag is only a *signal and a name*: the newest tag
 *   reachable from HEAD (and not already generated) names the candidate;
 *   tags on side/backport branches are filtered out by ancestry.
 * - No token, no convention file. `RELEASE_DRAFT.md` remains as a last-resort
 *   fallback for repos git cannot read.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { log } from "./logger";
import { normalizeGitHubUrl } from "./git-info";

const execFileAsync = promisify(execFile);

export interface ReleaseInfo {
  id: string;
  tag: string;
  name: string | null;
  publishedAt: string;
  url: string;
  body: string;
  material: ReleaseMaterial | null;
  source: "git-tag" | "git-commits" | "release-draft-file";
  draft: boolean;
  commitSha: string | null;
}

export interface ReleaseCheckResult {
  latest: ReleaseInfo | null;
  lastSeenTag: string | null;
  releases: ReleaseInfo[];
}

export interface GitTagInfo {
  name: string;
  sha: string;
  date: string;
}

export interface ReleaseMaterialCommit {
  sha: string;
  subject: string;
  body: string;
  author: string;
  date: string;
}

export interface ReleasePullRequest {
  number: number;
  title: string | null;
  /** Filled when the PR was fetched from GitHub (token or public repo). */
  body?: string;
  url?: string | null;
  viaToken?: boolean;
}

export interface ReleaseMaterial {
  since: string | null;
  sinceDate: string | null;
  end: string;
  commits: ReleaseMaterialCommit[];
  pullRequests: ReleasePullRequest[];
  diffStat: string;
  /** Official GitHub release announcement, when publicly fetchable. */
  githubRelease: GitHubReleaseInfo | null;
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

const RELEASE_DRAFT_FILENAME = "RELEASE_DRAFT.md";
const MAX_MATERIAL_COMMITS = 60;

async function git(localPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", localPath, ...args], {
    timeout: 8000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout.trim();
}

async function isAncestor(localPath: string, ancestor: string, descendant: string): Promise<boolean> {
  try {
    await git(localPath, ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sync remote tags into the local repo. Read-only: only adds/updates refs,
 * never touches the user's branches or working tree. Silent no-op when the
 * repo has no remote or the network is unavailable.
 */
export async function fetchRemoteTags(localPath: string): Promise<boolean> {
  try {
    const remote = await git(localPath, ["remote", "get-url", "origin"]).catch(() => "");
    if (!remote) return false;
    await git(localPath, ["fetch", "--tags"]);
    return true;
  } catch (err: any) {
    log.warn(`fetchRemoteTags failed for ${localPath}: ${err.message}`);
    return false;
  }
}

/**
 * Update the local repo before determining release data: fetch remote branches
 * and tags, then fast-forward the current local branch when the working tree
 * is clean (never force, never touch dirty work). Silent no-op on failure.
 */
export async function syncLocalRepo(localPath: string): Promise<boolean> {
  try {
    const remote = await git(localPath, ["remote", "get-url", "origin"]).catch(() => "");
    if (!remote) return false;
    await git(localPath, ["fetch", "--tags"]);
    const branch = await git(localPath, ["symbolic-ref", "--short", "HEAD"]).catch(() => "");
    if (branch) {
      const dirty = await git(localPath, ["status", "--porcelain"]).catch(() => "");
      if (!dirty) {
        await git(localPath, ["merge", "--ff-only", `origin/${branch}`]).catch(() => {
          log.warn(`Fast-forward ${branch} failed; using local state as-is`);
        });
      }
    }
    return true;
  } catch (err: any) {
    log.warn(`syncLocalRepo failed for ${localPath}: ${err.message}`);
    return false;
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
): Promise<GitHubReleaseInfo | null> {
  try {
    const remote = await git(localPath, ["remote", "get-url", "origin"]).catch(() => "");
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
      const data = await response.json();
      if (!data || typeof data.tag_name !== "string") return null;
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

const prInfoCache = new Map<
  string,
  {
    at: number;
    info: { title: string | null; body: string; url: string | null; viaToken: boolean };
  }
>();
const PR_INFO_TTL_MS = 30 * 60_000;

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
): Promise<ReleasePullRequest[]> {
  if (refs.length === 0) return [];
  const remote = await git(localPath, ["remote", "get-url", "origin"]).catch(() => "");
  const repoUrl = normalizeGitHubUrl(remote);
  if (!repoUrl) return refs.map((ref) => ({ ...ref }));
  const ownerRepo = repoUrl.replace("https://github.com/", "");
  const results = await Promise.all(
    refs.map(async (ref) => {
      const cacheKey = `${ownerRepo}#${ref.number}`;
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
        const data: any = await response.json();
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

/** Latest tags first; date is the tag's creatordate. */
export async function listGitTags(localPath: string): Promise<GitTagInfo[]> {
  try {
    const raw = await git(
      localPath,
      [
        "for-each-ref",
        "--sort=-creatordate",
        "--sort=-version:refname",
        "--format=%(refname:short)%09%(objectname:short)%09%(creatordate:iso8601)",
        "refs/tags",
      ],
    );
    return raw
      .split("\n")
      .filter(Boolean)
      .slice(0, 20)
      .map((line) => {
        const [name, sha, date] = line.split("\t");
        return { name: name || "", sha: sha || "", date: date || "" };
      })
      .filter((tag) => tag.name);
  } catch (err: any) {
    log.warn(`listGitTags failed for ${localPath}: ${err.message}`);
    return [];
  }
}

/** Tags reachable from any of the given refs (HEAD / remote tip). */
async function mainLineTags(localPath: string, tags: GitTagInfo[], refs: string): Promise<GitTagInfo[]> {
  const result: GitTagInfo[] = [];
  const refList = refs.split(/\s+/).filter(Boolean);
  for (const tag of tags) {
    for (const ref of refList) {
      if (await isAncestor(localPath, tag.sha, ref)) {
        result.push(tag);
        break;
      }
    }
  }
  return result;
}

/** Commits + PR references + diff stat in `since..end` (or up to `end`). */
export async function collectReleaseMaterial(
  localPath: string,
  since?: string | null,
  end = "HEAD",
): Promise<ReleaseMaterial> {
  const range = since ? `${since}..${end}` : end;
  const [logOut, diffOut] = await Promise.all([
    git(localPath, [
      "log",
      range,
      `--max-count=${MAX_MATERIAL_COMMITS}`,
      // \x1e record separator keeps multi-line bodies from corrupting records.
      "--format=%h%x1f%s%x1f%b%x1f%an%x1f%cI%x1e",
    ]).catch(() => ""),
    git(localPath, ["diff", "--stat", range]).catch(() => ""),
  ]);
  const sinceDate = since
    ? await git(localPath, ["log", "-1", "--format=%cI", since]).catch(() => "")
    : "";

  const commits: ReleaseMaterialCommit[] = logOut
    .split("\x1e")
    .filter(Boolean)
    .map((record) => {
      const [sha, subject, body, author, date] = record.split("\x1f");
      return {
        sha: sha || "",
        subject: subject || "",
        body: (body || "").trim(),
        author: author || "",
        date: date || "",
      };
    })
    .filter((commit) => commit.sha);

  const prNumbers = Array.from(
    new Set(
      commits.flatMap((commit) =>
        Array.from(commit.subject.matchAll(/#(\d+)/g), (match) => Number(match[1])),
      ),
    ),
  ).slice(0, 10);

  return {
    since: since || null,
    sinceDate: sinceDate || null,
    end,
    commits,
    pullRequests: prNumbers.map((number) => ({ number, title: null })),
    diffStat: diffOut.slice(0, 800),
    githubRelease: null,
  };
}

export function materialToBody(material: ReleaseMaterial): string {
  const lines: string[] = [];
  if (material.githubRelease) {
    lines.push(
      `Official release announcement (GitHub):\n${
        material.githubRelease.body || material.githubRelease.name || "(empty announcement)"
      }`,
    );
    lines.push("");
  }
  if (material.pullRequests.length > 0) {
    lines.push(
      `Pull requests in this release: ${material.pullRequests
        .map((pr) => `#${pr.number}`)
        .join(", ")}`,
    );
  }
  if (material.commits.length > 0) {
    lines.push(
      material.since
        ? `Commits since the last generated release (${material.since}):`
        : "Commits (recent history):",
    );
    for (const commit of material.commits) {
      lines.push(`- ${commit.subject} (${commit.sha})`);
      if (commit.body) lines.push(`  ${commit.body.split("\n")[0]}`);
    }
  }
  if (material.diffStat) {
    lines.push(`Diff summary:\n${material.diffStat}`);
  }
  return lines.join("\n") || `Release ${material.end} (no commits collected)`;
}

/** Keep only the commits the user chose to feed to the AI (PR list re-derived). */
export function filterMaterial(
  material: ReleaseMaterial,
  includeShas: string[] | null | undefined,
): ReleaseMaterial {
  if (!includeShas) return material;
  const set = new Set(includeShas);
  const commits = material.commits.filter((commit) => set.has(commit.sha));
  const prByNumber = new Map(
    (material.pullRequests || []).map((pr) => [pr.number, pr] as const),
  );
  const prNumbers = Array.from(
    new Set(
      commits.flatMap((commit) =>
        Array.from(commit.subject.matchAll(/#(\d+)/g), (match) => Number(match[1])),
      ),
    ),
  ).slice(0, 10);
  return {
    ...material,
    commits,
    pullRequests: prNumbers.map(
      (number) => prByNumber.get(number) || { number, title: null },
    ),
  };
}

function firstHeading(content: string): string | null {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) {
      return trimmed.replace(/^#+\s*/, "").trim() || null;
    }
    return trimmed;
  }
  return null;
}

function readReleaseDraft(localPath: string): ReleaseInfo | null {
  const filePath = path.join(localPath, RELEASE_DRAFT_FILENAME);
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const stat = fs.statSync(filePath);
    const modifiedAt = stat.mtime.toISOString();
    const draftId = `draft-${stat.mtimeMs}`;
    return {
      id: draftId,
      tag: draftId,
      name: firstHeading(content) || RELEASE_DRAFT_FILENAME,
      publishedAt: modifiedAt,
      url: "",
      body: content,
      material: null,
      source: "release-draft-file",
      draft: true,
      commitSha: null,
    };
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      log.warn(`Failed to read ${RELEASE_DRAFT_FILENAME}: ${err.message}`);
    }
    return null;
  }
}

/**
 * Detect the current release candidate:
 * - material = commits since `lastSeenSha` (the last generation point);
 * - the newest main-line tag not yet generated names the candidate;
 * - no changes since the boundary → no candidate;
 * - git unavailable → RELEASE_DRAFT.md fallback.
 */
const releaseCheckCache = new Map<
  string,
  { at: number; result: ReleaseCheckResult }
>();
const RELEASE_CHECK_TTL_MS = 30_000;

export async function checkForRelease(
  localPath: string,
  lastSeenSha?: string | null,
  githubToken?: string | null,
  options: { sync?: boolean; force?: boolean } = {},
): Promise<ReleaseCheckResult> {
  const cacheKey = `${localPath}::${lastSeenSha || ""}`;
  const cacheEnabled = options.sync === true;
  const cached = cacheEnabled ? releaseCheckCache.get(cacheKey) : undefined;
  if (!options.force && cached && Date.now() - cached.at < RELEASE_CHECK_TTL_MS) {
    return cached.result;
  }

  if (options.sync) {
    await syncLocalRepo(localPath);
  }

  const head = await git(localPath, ["rev-parse", "--short", "HEAD"]).catch(() => "");
  if (!head) {
    const draft = readReleaseDraft(localPath);
    const releases = draft ? [draft] : [];
    return { latest: draft || null, lastSeenTag: lastSeenSha || null, releases };
  }

  // Include the remote tip too: with a dirty/stale local branch, material
  // still covers the freshest remote commits without touching the worktree.
  let remoteTip: string | null = null;
  if (options.sync) {
    const branch = await git(localPath, ["symbolic-ref", "--short", "HEAD"]).catch(() => "");
    if (branch) {
      remoteTip = await git(localPath, ["rev-parse", "--short", `origin/${branch}`]).catch(() => "");
    }
  }
  let tip = head;
  if (remoteTip && remoteTip !== head && !(await isAncestor(localPath, remoteTip, head))) {
    tip = remoteTip;
  }
  const endRefs = remoteTip && remoteTip !== tip ? `${tip} ${remoteTip}` : tip;

  const material = await collectReleaseMaterial(localPath, lastSeenSha || null, endRefs);

  // The release identity is the newest main-line tag (or the head when there
  // are no tags). It stays stable across the generation boundary, so the
  // workbench keeps surfacing the draft it generated for — material being
  // empty (no new commits since the last generation) does NOT hide it.
  const allTags = await listGitTags(localPath);
  const onMain = await mainLineTags(localPath, allTags, endRefs);
  const releaseTag: GitTagInfo | null = onMain[0] || null;

  const enrichedMaterial = {
    ...material,
    pullRequests: await fetchPullRequests(localPath, material.pullRequests, githubToken),
    githubRelease: releaseTag
      ? await fetchGitHubRelease(localPath, releaseTag.name, githubToken)
      : material.githubRelease,
  };
  const release: ReleaseInfo = {
    id: releaseTag ? `tag-${releaseTag.sha}` : `head-${head}`,
    tag: releaseTag?.name || `head-${head}`,
    name: releaseTag?.name || "待处理变更",
    publishedAt: releaseTag?.date || material.commits[0]?.date || new Date().toISOString(),
    url: "",
    body: materialToBody(enrichedMaterial),
    material: enrichedMaterial,
    source: releaseTag ? "git-tag" : "git-commits",
    draft: true,
    commitSha: tip,
  };
  const result: ReleaseCheckResult = {
    latest: release,
    lastSeenTag: lastSeenSha || null,
    releases: [release],
  };
  if (cacheEnabled) releaseCheckCache.set(cacheKey, { at: Date.now(), result });
  return result;
}
