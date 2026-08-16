import { execFile } from "child_process";
import { promisify } from "util";
import { Octokit } from "@octokit/rest";
import { RepoAnalyzer } from "./repo-analyzer";
import { log } from "./logger";

const execFileAsync = promisify(execFile);

export interface ReleaseInfo {
  id: string;
  tag: string;
  name: string | null;
  publishedAt: string;
  url: string;
  body: string;
  source: "github" | "git-tag";
}

export interface ReleaseCheckResult {
  latest: ReleaseInfo | null;
  isNew: boolean;
  lastSeenTag: string | null;
  releases: ReleaseInfo[];
}

function parseGithubRemote(remote: string): { owner: string; repo: string } | null {
  try {
    return RepoAnalyzer.parseGitHubUrl(remote);
  } catch {
    return null;
  }
}

async function getGitRemote(localPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["config", "--get", "remote.origin.url"],
      { cwd: localPath },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function listGitHubReleases(owner: string, repo: string): Promise<ReleaseInfo[]> {
  const octokit = new Octokit({ request: { timeout: 10_000 } });
  const { data } = await octokit.rest.repos.listReleases({
    owner,
    repo,
    per_page: 5,
  });
  return data.map((release) => ({
    id: String(release.id),
    tag: release.tag_name,
    name: release.name || null,
    publishedAt: release.published_at || release.created_at || "",
    url: release.html_url,
    body: release.body || "",
    source: "github",
  }));
}

async function listLocalTags(localPath: string): Promise<ReleaseInfo[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      [
        "for-each-ref",
        "--sort=-creatordate",
        "--format=%(refname:short)%09%(creatordate:iso8601)%09%(objectname:short)",
        "refs/tags",
      ],
      { cwd: localPath },
    );
    return stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(0, 5)
      .map((line) => {
        const [tag, publishedAt] = line.split("\t");
        return {
          id: tag,
          tag,
          name: null,
          publishedAt,
          url: "",
          body: "",
          source: "git-tag" as const,
        };
      });
  } catch (err: any) {
    log.warn(`Local git tag lookup failed for ${localPath}: ${err.message}`);
    return [];
  }
}

export async function checkForRelease(
  localPath: string,
  lastSeenTag?: string | null,
): Promise<ReleaseCheckResult> {
  const remote = await getGitRemote(localPath);
  const github = remote ? parseGithubRemote(remote) : null;
  const releases = github
    ? await listGitHubReleases(github.owner, github.repo)
    : await listLocalTags(localPath);
  const latest = releases[0] || null;
  const isNew = Boolean(latest && latest.tag !== lastSeenTag);

  return {
    latest,
    isNew,
    lastSeenTag: lastSeenTag || null,
    releases,
  };
}
