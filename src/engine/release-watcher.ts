/**
 * Release watcher — detects release candidates from the local repository
 * WITHOUT requiring tags, releases, tokens, or any developer convention.
 *
 * The boundary is Appilot's own memory: the HEAD sha at the moment the last
 * release draft was generated (`project.lastReleaseSha`). Everything committed
 * since that boundary is the material for the next release announcement
 * (commits + PR references + diff stat). On first run (no boundary yet), the
 * recent commit history is used. `RELEASE_DRAFT.md` remains only as a
 * last-resort fallback for repos git cannot read.
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
  source: "git-commits" | "release-draft-file";
  draft: boolean;
  commitSha: string | null;
}

export interface ReleaseCheckResult {
  latest: ReleaseInfo | null;
  isNew: boolean;
  lastSeenTag: string | null;
  releases: ReleaseInfo[];
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

async function headSha(localPath: string): Promise<string | null> {
  try {
    return (await git(localPath, ["rev-parse", "--short", "HEAD"])) || null;
  } catch (err: any) {
    log.warn(`headSha failed for ${localPath}: ${err.message}`);
    return null;
  }
}

/** Commits + PR references + diff stat since a boundary sha (or recent history). */
export async function collectReleaseMaterial(
  localPath: string,
  since?: string | null,
): Promise<ReleaseMaterial> {
  const range = since ? `${since}..HEAD` : "HEAD";
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
    commits,
    pullRequests: prNumbers.map((number) => ({ number, title: null })),
    diffStat: diffOut.slice(0, 800),
  };
}

function materialToBody(material: ReleaseMaterial, head: string): string {
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
  return lines.join("\n") || `Release at ${head} (no commits collected)`;
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
 * Detect the current release candidate:
 * - HEAD sha (when available) with commit/PR material since `lastSeenSha`;
 * - fallback to RELEASE_DRAFT.md only when git cannot be read.
 */
export async function checkForRelease(
  localPath: string,
  lastSeenSha?: string | null,
  _legacyGithubToken?: string | null,
): Promise<ReleaseCheckResult> {
  const head = await headSha(localPath);

  if (head) {
    const material = await collectReleaseMaterial(localPath, lastSeenSha || null);
    const latestCommit = material.commits[0] || null;
    const release: ReleaseInfo = {
      id: `head-${head}`,
      tag: `head-${head}`,
      name: `基于 ${head}`,
      publishedAt: latestCommit?.date || new Date().toISOString(),
      url: "",
      body: materialToBody(material, head),
      source: "git-commits",
      draft: true,
      commitSha: head,
    };
    return {
      latest: release,
      isNew: release.commitSha !== (lastSeenSha || null),
      lastSeenTag: lastSeenSha || null,
      releases: [release],
    };
  }

  const draft = readReleaseDraft(localPath);
  const releases = draft ? [draft] : [];
  const latest = draft || null;
  return {
    latest,
    isNew: Boolean(latest && latest.tag !== lastSeenSha),
    lastSeenTag: lastSeenSha || null,
    releases,
  };
}
