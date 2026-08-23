/**
 * Read-only local git info collection (Phase P1).
 *
 * Runs only `git` read commands against the local repo; never writes,
 * never creates branches or tags. Matches Appilot's "仓库只读边界".
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { log } from "./logger";
import { readRepoDescription } from "./app-store-discovery";

const execFileAsync = promisify(execFile);

export interface RepoInfo {
  remoteUrl: string | null;
  /** Normalized https://github.com/owner/repo URL, when the remote is GitHub. */
  githubUrl: string | null;
  branch: string | null;
  headSha: string | null;
  headMessage: string | null;
  headDate: string | null; // ISO 8601
  dirty: boolean;
  /** First meaningful README paragraph, truncated for display. */
  description: string | null;
  capturedAt: string; // ISO 8601
}

async function git(localPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", localPath, ...args], {
    timeout: 5000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  return stdout.trim();
}

/** Read the origin remote URL (empty string when unavailable). */
export async function getRemoteUrl(localPath: string): Promise<string> {
  return git(localPath, ["remote", "get-url", "origin"]).catch(() => "");
}

/** Convert common GitHub remote forms to a plain https repo URL (null when not GitHub). */
export function normalizeGitHubUrl(remote: string | null): string | null {
  if (!remote) return null;
  let clean = remote.trim();
  if (!clean) return null;
  clean = clean
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//, "https://github.com/")
    .replace(/^http:\/\//, "https://");
  if (!clean.startsWith("https://github.com/")) return null;
  const parts = clean.split("/").filter(Boolean);
  // parts: ["https:", "github.com", owner, repo, ...]
  const owner = parts[2] || "";
  const repo = (parts[3] || "").replace(/\.git$/, "").replace(/\/$/, "");
  if (!owner || !repo) return null;
  return `https://github.com/${owner}/${repo}`;
}

export async function collectRepoInfo(localPath: string): Promise<RepoInfo> {
  const base: RepoInfo = {
    remoteUrl: null,
    githubUrl: null,
    branch: null,
    headSha: null,
    headMessage: null,
    headDate: null,
    dirty: false,
    description: null,
    capturedAt: new Date().toISOString(),
  };

  try {
    const [remote, branch, head, statusOut] = await Promise.all([
      git(localPath, ["remote", "get-url", "origin"]).catch(() => ""),
      git(localPath, ["branch", "--show-current"]).catch(() => ""),
      git(localPath, ["log", "-1", "--format=%h%x1f%s%x1f%cI"]).catch(() => ""),
      git(localPath, ["status", "--porcelain"]).catch(() => ""),
    ]);
    const [sha, message, date] = head.split("\x1f");
    const remoteUrl = remote || null;
    const description = readRepoDescription(localPath) || "";
    return {
      ...base,
      remoteUrl,
      githubUrl: normalizeGitHubUrl(remoteUrl),
      branch: branch || null,
      headSha: sha || null,
      headMessage: message || null,
      headDate: date || null,
      dirty: statusOut.length > 0,
      description: description.slice(0, 120) || null,
    };
  } catch (err: any) {
    log.warn(`collectRepoInfo failed for ${localPath}: ${err.message}`);
    return base;
  }
}
