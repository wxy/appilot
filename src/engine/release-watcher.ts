/**
 * Release watcher — a new local git tag is the release signal.
 *
 * Rationale: creating a GitHub release always creates a tag, so a new tag is
 * the developer's explicit "this is a release" action — no convention file,
 * no merge heuristics, no token. The release announcement body is not
 * available locally, so the material is all commits (+ PR references + diff
 * stat) since the previous tag; AI drafts the announcement from that.
 * `RELEASE_DRAFT.md` remains only as a last-resort fallback for repos without
 * any tags yet (migration path).
 */

import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { log } from "./logger";

const execFileAsync = promisify(execFile);

export interface ReleaseInfo {
  id: string;
  tag: string;
  name: string | null;
  publishedAt: string;
  url: string;
  body: string;
  material: ReleaseMaterial | null;
  source: "git-tag" | "release-draft-file";
  draft: boolean;
  commitSha: string | null;
}

export interface ReleaseCheckResult {
  latest: ReleaseInfo | null;
  isNew: boolean;
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
  end: string;
  commits: ReleaseMaterialCommit[];
  pullRequests: { number: number; title: string | null }[];
  diffStat: string;
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
      .slice(0, 10)
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
      "--format=%h%x1f%s%x1f%b%x1f%an%x1f%cI",
    ]).catch(() => ""),
    git(localPath, ["diff", "--stat", range]).catch(() => ""),
  ]);

  const commits: ReleaseMaterialCommit[] = logOut
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, subject, body, author, date] = line.split("\x1f");
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
    end,
    commits,
    pullRequests: prNumbers.map((number) => ({ number, title: null })),
    diffStat: diffOut.slice(0, 800),
  };
}

function materialToBody(material: ReleaseMaterial): string {
  const lines: string[] = [];
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
        ? `Commits since the previous release (${material.since}):`
        : "Commits up to the first release:",
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
 * Detect the latest release:
 * 1. newest git tag → release with commit/PR material since the previous tag;
 * 2. no tags → legacy RELEASE_DRAFT.md fallback.
 */
export async function checkForRelease(
  localPath: string,
  lastSeenTag?: string | null,
  _legacyGithubToken?: string | null,
  options: { fetchTags?: boolean } = {},
): Promise<ReleaseCheckResult> {
  if (options.fetchTags !== false) {
    await fetchRemoteTags(localPath);
  }
  const tags = await listGitTags(localPath);
  const latestTag = tags[0] || null;
  const previousTag = tags[1]?.name || null;

  if (latestTag) {
    const material = await collectReleaseMaterial(localPath, previousTag, latestTag.name);
    const release: ReleaseInfo = {
      id: `tag-${latestTag.sha}`,
      tag: latestTag.name,
      name: latestTag.name,
      publishedAt: latestTag.date || new Date().toISOString(),
      url: "",
      body: materialToBody(material),
      material,
      source: "git-tag",
      draft: true,
      commitSha: latestTag.sha,
    };
    // A moved tag (same name, different commit) redefines the release
    // boundary, so identity is name@sha; a plain-name match still counts as
    // seen for legacy stored values.
    const tagKey = `${release.tag}@${release.commitSha}`;
    const seen =
      tagKey === lastSeenTag ||
      (Boolean(lastSeenTag) && release.tag === lastSeenTag);
    return {
      latest: release,
      isNew: !seen,
      lastSeenTag: lastSeenTag || null,
      releases: [release],
    };
  }

  const draft = readReleaseDraft(localPath);
  const releases = draft ? [draft] : [];
  const latest = draft || null;
  return {
    latest,
    isNew: Boolean(latest && latest.tag !== lastSeenTag),
    lastSeenTag: lastSeenTag || null,
    releases,
  };
}
