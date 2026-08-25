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
import {
  fetchGitHubRelease,
  fetchPullRequests,
  type GitHubReleaseInfo,
  type ReleasePullRequest,
} from "./github-api";

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

/** Pre-warmed GitHub API data produced by the background sync task. */
export interface GithubApiCache {
  tag: string | null;
  release: GitHubReleaseInfo | null;
  pullRequests: ReleasePullRequest[];
}

const RELEASE_DRAFT_FILENAME = "RELEASE_DRAFT.md";
const MAX_MATERIAL_COMMITS = 60;

async function git(
  localPath: string,
  args: string[],
  timeoutMs = 8000,
): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", localPath, ...args], {
    timeout: timeoutMs,
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
    // Fetching can legitimately take a while on large/slow remotes; use a
    // generous timeout so the background sync does not silently give up.
    await git(localPath, ["fetch", "--tags"], 60_000);
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
    await git(localPath, ["fetch", "--tags"], 60_000);
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
  end: string | string[] = "HEAD",
): Promise<ReleaseMaterial> {
  const endRefs = Array.isArray(end) ? end : [end];
  const rangeArgs = since ? [`${since}..${endRefs[0]}`, ...endRefs.slice(1)] : endRefs;
  const [logOut, diffOut] = await Promise.all([
    git(localPath, [
      "log",
      ...rangeArgs,
      `--max-count=${MAX_MATERIAL_COMMITS}`,
      // \x1e record separator keeps multi-line bodies from corrupting records.
      "--format=%h%x1f%s%x1f%b%x1f%an%x1f%cI%x1e",
    ]).catch(() => ""),
    git(localPath, ["diff", "--stat", ...rangeArgs]).catch(() => ""),
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
    end: endRefs.join(" "),
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
  options: {
    sync?: boolean;
    force?: boolean;
    githubCache?: GithubApiCache;
    onApiStats?: (requestBytes: number, responseBytes: number) => void;
  } = {},
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
  // The main line is the checkout's remote branch plus the repository's
  // default branch: GitHub releases are usually tagged on the default branch
  // even when the local checkout sits on a feature branch.
  const frontierShas: string[] = [head];
  if (options.sync) {
    const branch = await git(localPath, ["symbolic-ref", "--short", "HEAD"]).catch(() => "");
    if (branch) {
      const remoteSha = await git(localPath, ["rev-parse", "--short", `origin/${branch}`]).catch(() => "");
      if (remoteSha && !frontierShas.includes(remoteSha)) frontierShas.push(remoteSha);
    }
    for (const ref of ["origin/master", "origin/main"]) {
      const sha = await git(localPath, ["rev-parse", "--short", ref]).catch(() => "");
      if (sha && !frontierShas.includes(sha)) frontierShas.push(sha);
    }
  }
  let tip = head;
  for (const candidate of frontierShas) {
    if (candidate === tip) continue;
    if (!(await isAncestor(localPath, candidate, tip))) tip = candidate;
  }
  const endRefs = frontierShas.join(" ");

  const material = await collectReleaseMaterial(localPath, lastSeenSha || null, frontierShas);

  // The release identity is the newest main-line tag (or the head when there
  // are no tags). It stays stable across the generation boundary, so the
  // workbench keeps surfacing the draft it generated for — material being
  // empty (no new commits since the last generation) does NOT hide it.
  const allTags = await listGitTags(localPath);
  const onMain = await mainLineTags(localPath, allTags, endRefs);
  const releaseTag: GitTagInfo | null = onMain[0] || null;

  const cacheMatches =
    Boolean(releaseTag) && options.githubCache?.tag === releaseTag?.name;
  const enrichedMaterial = {
    ...material,
    pullRequests: cacheMatches
      ? (options.githubCache?.pullRequests ?? material.pullRequests)
      : await fetchPullRequests(
          localPath,
          material.pullRequests,
          githubToken,
          options.onApiStats,
        ),
    githubRelease: cacheMatches
      ? (options.githubCache?.release ?? material.githubRelease)
      : releaseTag
        ? await fetchGitHubRelease(
            localPath,
            releaseTag.name,
            githubToken,
            options.onApiStats,
          )
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
