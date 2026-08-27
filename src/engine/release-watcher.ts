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
  fetchMergedPullRequests,
  fetchPullRequests,
  type GitHubReleaseInfo,
  type GitHubReleaseItem,
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
  source: "git-tag" | "git-commits" | "release-draft-file" | "github-release";
  /** Real GitHub release state; null when the release came from local git. */
  githubDraft: boolean | null;
  /**
   * 注意：draft 的语义是“可作为文案生成的候选”，不是真实的 GitHub 草案
   * 状态（真实状态见 githubDraft）。所有 GitHub release 都按候选处理，
   * 便于已正式发布的版本也可以从头新建文案。
   */
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
  /** Pre-warmed GitHub releases listing (drafts included). */
  releases?: GitHubReleaseItem[];
}

const RELEASE_DRAFT_FILENAME = "RELEASE_DRAFT.md";
const MAX_MATERIAL_COMMITS = 60;

/**
 * A merge commit ("Merge pull request #N ..." / "Merge branch ...") carries
 * no content of its own — its changes live in the branch commits, which are
 * already part of the range. Excluding it keeps the change summary free of
 * phantom "new PR" entries after a release is merged.
 */
export function isMergeCommit(subject: string): boolean {
  return /^Merge\s+(pull\s+request|branch)/i.test(String(subject || "").trim());
}

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
/** 每个仓库串行化的 git 操作队列：后台同步与手动检查并发时不再互相抢占 ref。 */
const repoGitQueues = new Map<string, Promise<unknown>>();

function enqueueRepoGit<T>(localPath: string, fn: () => Promise<T>): Promise<T> {
  const previous = repoGitQueues.get(localPath) || Promise.resolve();
  const run = previous.then(fn, fn);
  repoGitQueues.set(
    localPath,
    run.catch(() => undefined),
  );
  return run;
}

/**
 * git fetch --tags，带一次重试：并发 fetch 时 refs/remotes/origin/* 的锁竞争
 * 是瞬时的，重试即可通过；其他失败则抛出。
 */
async function fetchTagsWithRetry(localPath: string): Promise<void> {
  try {
    await git(localPath, ["fetch", "--tags"], 60_000);
  } catch (err: any) {
    log.warn(`git fetch retry for ${localPath}: ${err.message}`);
    await git(localPath, ["fetch", "--tags"], 60_000);
  }
}

export async function fetchRemoteTags(localPath: string): Promise<boolean> {
  const remote = await git(localPath, ["remote", "get-url", "origin"]).catch(
    () => "",
  );
  if (!remote) return false;
  return enqueueRepoGit(localPath, () =>
    fetchTagsWithRetry(localPath)
      .then(() => true)
      .catch((err: any) => {
        log.warn(`fetchRemoteTags failed for ${localPath}: ${err.message}`);
        return false;
      }),
  );
}

/**
 * Update the local repo before determining release data: fetch remote branches
 * and tags, then fast-forward the current local branch when the working tree
 * is clean (never force, never touch dirty work). Silent no-op on failure.
 */
export async function syncLocalRepo(localPath: string): Promise<boolean> {
  const remote = await git(localPath, ["remote", "get-url", "origin"]).catch(
    () => "",
  );
  if (!remote) return false;
  return enqueueRepoGit(localPath, async () => {
    try {
      await fetchTagsWithRetry(localPath);
      const branch = await git(localPath, ["symbolic-ref", "--short", "HEAD"]).catch(
        () => "",
      );
      if (branch) {
        const dirty = await git(localPath, ["status", "--porcelain"]).catch(
          () => "",
        );
        if (!dirty) {
          await git(localPath, ["merge", "--ff-only", `origin/${branch}`]).catch(
            () => {
              log.warn(`Fast-forward ${branch} failed; using local state as-is`);
            },
          );
        }
      }
      return true;
    } catch (err: any) {
      log.warn(`syncLocalRepo failed for ${localPath}: ${err.message}`);
      return false;
    }
  });
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
  // Merge commits ("Merge pull request #N …") are excluded from the content
  // commits, but their subjects identify PRs. For each merge commit we also
  // derive the PR's own commits (second-parent range) so the change summary
  // can map PR rows to real commits even when the branch commits carry no #N.
  const mergeLog = await git(localPath, [
    "log",
    ...rangeArgs,
    "--merges",
    "--max-count=20",
    "--format=%H%x1f%P%x1f%s%x1e",
  ]).catch(() => "");
  const mergePrShas = new Map<number, string[]>();
  for (const record of mergeLog.split("\x1e").filter(Boolean)) {
    const [sha, parents, subject] = record.split("\x1f");
    const match = (subject || "").match(/Merge pull request #(\d+)/i);
    if (!match || !sha) continue;
    const [p1, p2] = (parents || "").split(/\s+/).filter(Boolean);
    if (!p1 || !p2) continue;
    const shas = await git(localPath, [
      "rev-list",
      `${p1}..${p2}`,
      "--max-count=100",
    ]).catch(() => "");
    const list = mergePrShas.get(Number(match[1])) || [];
    for (const item of shas.split(/\s+/).filter(Boolean)) {
      if (!list.includes(item)) list.push(item);
    }
    mergePrShas.set(Number(match[1]), list);
  }
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
    .filter((commit) => commit.sha && !isMergeCommit(commit.subject));

  const shasByPr = new Map<number, string[]>();
  const addShas = (number: number, shas: string[]) => {
    const list = shasByPr.get(number) || [];
    for (const sha of shas) {
      if (!list.includes(sha)) list.push(sha);
    }
    shasByPr.set(number, list);
  };
  for (const commit of commits) {
    const numbers = Array.from(
      commit.subject.matchAll(/#(\d+)/g),
      (match) => Number(match[1]),
    );
    for (const number of numbers) addShas(number, [commit.sha]);
  }
  for (const [number, shas] of mergePrShas) addShas(number, shas);
  const prNumbers = Array.from(shasByPr.keys()).slice(0, 10);

  return {
    since: since || null,
    sinceDate: sinceDate || null,
    end: endRefs.join(" "),
    commits,
    pullRequests: prNumbers.map((number) => ({
      number,
      title: null,
      commitShas: shasByPr.get(number) || [],
    })),
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
    lines.push("Pull requests in this release:");
    for (const pr of material.pullRequests) {
      const count =
        typeof pr.commits === "number" ? ` (${pr.commits} commits)` : "";
      lines.push(`- #${pr.number}${pr.title ? ` ${pr.title}` : ""}${count}`);
    }
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

/**
 * Keep only the commits the user chose to feed to the AI. The PR list is
 * re-derived from PR↔commit membership (subject references plus API/merge
 * ranges) so unchecked PR rows drop their commits from the material.
 */
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
  const shaMatches = (local: string, full: string): boolean => {
    const a = String(local || "").trim().toLowerCase();
    const b = String(full || "").trim().toLowerCase();
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.length < 7) return false;
    return b.startsWith(a) || a.startsWith(b);
  };
  const keptNumbers = new Set<number>();
  for (const pr of material.pullRequests || []) {
    if ((pr.commitShas || []).some((sha) =>
      Array.from(set).some((local) => shaMatches(local, sha)),
    )) {
      keptNumbers.add(pr.number);
    }
  }
  for (const commit of commits) {
    for (const match of commit.subject.matchAll(/#(\d+)/g)) {
      keptNumbers.add(Number(match[1]));
    }
  }
  return {
    ...material,
    commits,
    pullRequests: Array.from(keptNumbers)
      .slice(0, 10)
      .map((number) => prByNumber.get(number) || { number, title: null }),
  };
}

/**
 * Resolve the PR list for a release range:
 * - with a token: authoritative merged-PR list from the GitHub API
 *   (titles, commit counts, per-PR commit shas), merged with locally derived
 *   references so nothing is lost;
 * - without a token: local references (subjects + merge commits) enriched by
 *   anonymous per-PR fetches when the repo is public.
 */
async function resolveReleasePullRequests(
  localPath: string,
  material: ReleaseMaterial,
  githubToken?: string | null,
  onApiStats?: (requestBytes: number, responseBytes: number) => void,
): Promise<ReleasePullRequest[]> {
  if (githubToken && material.commits.length > 0) {
    const fetched = await fetchMergedPullRequests(
      localPath,
      material.sinceDate,
      githubToken,
      onApiStats,
    );
    if (fetched.length > 0) {
      const byNumber = new Map(fetched.map((pr) => [pr.number, pr] as const));
      const merged = [...fetched];
      for (const local of material.pullRequests) {
        const existing = byNumber.get(local.number);
        if (!existing) {
          merged.push(local);
        } else if (!existing.commitShas && local.commitShas?.length) {
          existing.commitShas = local.commitShas;
        }
      }
      return merged;
    }
  }
  return fetchPullRequests(
    localPath,
    material.pullRequests,
    githubToken,
    onApiStats,
  );
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
      githubDraft: null,
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
    githubReleases?: GitHubReleaseItem[] | null;
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
  // Only trust cached PR lists that actually carry data. An empty cached list
  // usually means the sync ran before PR enrichment existed (or the API was
  // down), so refetch instead of showing a blank summary.
  const pullRequests =
    cacheMatches &&
    options.githubCache &&
    (options.githubCache.pullRequests?.length ?? 0) > 0
      ? options.githubCache.pullRequests
      : await resolveReleasePullRequests(
          localPath,
          material,
          githubToken,
          options.onApiStats,
        );
  const githubReleases =
    options.githubReleases ?? options.githubCache?.releases ?? null;
  const githubItems =
    githubReleases && githubReleases.length > 0 ? githubReleases : null;

  if (githubItems) {
    const coveredTags = new Set(
      githubItems.map((item) => item.tag).filter((tag): tag is string => Boolean(tag)),
    );
    const extraTags = onMain.filter((tag) => !coveredTags.has(tag.name));
    const sorted = [...githubItems].sort((a, b) => {
      if (a.draft !== b.draft) return a.draft ? -1 : 1;
      return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    });
    const githubReleasesBuilt = sorted.map((item) => {
      const tag = item.tag || `gh-${item.id}`;
      const materialWithRelease: ReleaseMaterial = {
        ...material,
        pullRequests,
        githubRelease: {
          name: item.name,
          body: item.body,
          publishedAt: item.publishedAt,
          url: item.url,
          viaToken: item.viaToken,
        },
      };
      return {
        id: `gh-${item.id}`,
        tag,
        name: item.name || item.tag || tag,
        publishedAt: item.publishedAt || item.createdAt || new Date().toISOString(),
        url: item.url || "",
        body: item.body || materialToBody(materialWithRelease),
        material: materialWithRelease,
        source: "github-release" as const,
        githubDraft: item.draft,
        draft: true,
        commitSha: tip,
      };
    });
    const extraReleases = await Promise.all(
      extraTags.map(async (tag) => {
        const enriched: ReleaseMaterial = {
          ...material,
          pullRequests,
          githubRelease: await fetchGitHubRelease(
            localPath,
            tag.name,
            githubToken,
            options.onApiStats,
          ),
        };
        return {
          id: `tag-${tag.sha}`,
          tag: tag.name,
          name: tag.name,
          publishedAt: tag.date,
          url: "",
          body: materialToBody(enriched),
          material: enriched,
          source: "git-tag" as const,
          githubDraft: null,
          draft: true,
          commitSha: tip,
        };
      }),
    );
    const releases = [...githubReleasesBuilt, ...extraReleases];
    const result: ReleaseCheckResult = {
      latest: releases[0] || null,
      lastSeenTag: lastSeenSha || null,
      releases,
    };
    if (cacheEnabled) releaseCheckCache.set(cacheKey, { at: Date.now(), result });
    return result;
  }

  const enrichedMaterial = {
    ...material,
    pullRequests,
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
    githubDraft: null,
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
