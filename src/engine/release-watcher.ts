/**
 * Release watcher — detects release points and collects the material used to
 * draft the release announcement.
 *
 * Source of truth (new flow): local git tags. A new tag marks a release; the
 * announcement material is the commits (+ PR references) since the previous
 * tag, so Appilot does NOT depend on the developer writing an announcement
 * file or a draft release. `RELEASE_DRAFT.md` remains as a fallback for repos
 * without any tags yet (migration path).
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
  sinceTag: string | null;
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

/** Latest tags first; date is the tag's creatordate. */
export async function listGitTags(localPath: string): Promise<GitTagInfo[]> {
  try {
    const raw = await git(
      localPath,
      [
        "for-each-ref",
        "--sort=-creatordate",
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

/** Commits + PR references + diff stat since a previous tag (or the whole history). */
export async function collectReleaseMaterial(
  localPath: string,
  sinceTag?: string | null,
): Promise<ReleaseMaterial> {
  const range = sinceTag ? `${sinceTag}..HEAD` : "HEAD";
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
    sinceTag: sinceTag || null,
    commits,
    pullRequests: prNumbers.map((number) => ({ number, title: null })),
    diffStat: diffOut.slice(0, 800),
  };
}

function materialToBody(material: ReleaseMaterial, tagName: string): string {
  const lines: string[] = [];
  if (material.pullRequests.length > 0) {
    lines.push(
      `Pull requests in this release: ${material.pullRequests
        .map((pr) => `#${pr.number}`)
        .join(", ")}`,
    );
  }
  if (material.commits.length > 0) {
    lines.push(`Commits (since ${material.sinceTag || "the beginning"}):`);
    for (const commit of material.commits) {
      lines.push(`- ${commit.subject} (${commit.sha})`);
      if (commit.body) lines.push(`  ${commit.body.split("\n")[0]}`);
    }
  }
  if (material.diffStat) {
    lines.push(`Diff summary:\n${material.diffStat}`);
  }
  return lines.join("\n") || `Release ${tagName} (no commits collected)`;
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
 * 1. newest git tag → release from commit/PR material since the previous tag;
 * 2. no tags → legacy RELEASE_DRAFT.md fallback.
 */
export async function checkForRelease(
  localPath: string,
  lastSeenTag?: string | null,
  _legacyGithubToken?: string | null,
): Promise<ReleaseCheckResult> {
  const tags = await listGitTags(localPath);
  const latestTag = tags[0] || null;
  const previousTag = tags[1]?.name || null;

  if (latestTag) {
    const material = await collectReleaseMaterial(localPath, previousTag);
    const release: ReleaseInfo = {
      id: `tag-${latestTag.sha}`,
      tag: latestTag.name,
      name: latestTag.name,
      publishedAt: latestTag.date || new Date().toISOString(),
      url: "",
      body: materialToBody(material, latestTag.name),
      source: "git-tag",
      draft: true,
      commitSha: latestTag.sha,
    };
    return {
      latest: release,
      isNew: release.tag !== lastSeenTag,
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
