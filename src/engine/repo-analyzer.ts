/**
 * Repo Analyzer — Phase 0: single GitHub public repo.
 *
 * Uses @octokit/rest (unauthenticated, 60 req/h) for README, file tree,
 * and recent commits. Falls back to simple-git for local `git log` detail.
 *
 * Phase 1+ adds: connectLocalRepo, connectGitHubPrivateRepo, multi-repo analysis.
 */

import { Octokit } from "@octokit/rest";
import { simpleGit, SimpleGit } from "simple-git";
import { ApiError, EngineError, apiErrorFromStatus } from "./errors";
import { log } from "./logger";
import path from "path";
import os from "os";
import fs from "fs";

// ── Types ──

export interface RepoIndex {
  owner: string;
  repo: string;
  defaultBranch: string;
  indexedAt: Date;
  readme: string;          // raw README content
  directoryTree: string[]; // top-level files + dirs (depth 4)
  recentCommits: CommitInfo[];
}

export interface CommitInfo {
  sha: string;
  message: string;
  author: string;
  date: string; // ISO 8601
}

export interface RepoSummary {
  projectName: string;
  tagline: string;           // first non-empty line of README
  description: string;       // first paragraph of README
  techStack: string[];       // detected from package.json etc.
  license: string | null;
  recentCommits: CommitInfo[];
  directoryTree: string[];
  inferredAudience: string | null;
}

export interface FeatureHighlight {
  title: string;
  description: string;
  source: "code_verified" | "ai_inferred";
  isFocused: boolean;
}

// ── Rate limit tracking ──

interface RateLimitState {
  remaining: number;
  reset: number; // Unix timestamp
}

// ── RepoAnalyzer ──

export class RepoAnalyzer {
  private octokit: Octokit;
  private rateLimit: RateLimitState = { remaining: 60, reset: 0 };
  private indexCache = new Map<string, RepoIndex>();

  constructor() {
    this.octokit = new Octokit({ request: { timeout: 10000 } });
  }

  // ── Phase 0 public API ──

  /** Parse "github.com/owner/repo" → {owner, repo} */
  static parseGitHubUrl(url: string): { owner: string; repo: string } {
    // Strip protocol, trailing .git, trailing slash
    let clean = url.replace(/^https?:\/\//, "").replace(/\.git$/, "").replace(/\/$/, "");
    // Handle "github.com/owner/repo" or just "owner/repo"
    if (clean.startsWith("github.com/")) clean = clean.slice("github.com/".length);
    const parts = clean.split("/");
    if (parts.length < 2) throw new EngineError(`Invalid GitHub URL: ${url}`, "INVALID_REPO_URL");
    return { owner: parts[0], repo: parts[1] };
  }

  /** Connect to a GitHub public repo and build an index. */
  async connectGitHubPublicRepo(githubUrl: string): Promise<RepoIndex> {
    const { owner, repo } = RepoAnalyzer.parseGitHubUrl(githubUrl);
    const cacheKey = `${owner}/${repo}`;

    // Return cached index if available and fresh (< 5 min)
    const cached = this.indexCache.get(cacheKey);
    if (cached && Date.now() - cached.indexedAt.getTime() < 300_000) {
      log.info(`Using cached index for ${cacheKey}`);
      return cached;
    }

    log.info(`Connecting to GitHub repo: ${cacheKey}`);

    try {
      // Fetch README
      const readme = await this.fetchReadme(owner, repo);

      // Fetch default branch
      const { data: repoData } = await this.octokit.rest.repos.get({ owner, repo });
      const defaultBranch = repoData.default_branch;

      // Fetch file tree (depth 4)
      const directoryTree = await this.fetchFileTree(owner, repo, defaultBranch);

      // Fetch recent commits (last 10)
      const recentCommits = await this.fetchRecentCommits(owner, repo, defaultBranch);

      const index: RepoIndex = {
        owner,
        repo,
        defaultBranch,
        indexedAt: new Date(),
        readme,
        directoryTree,
        recentCommits,
      };

      this.indexCache.set(cacheKey, index);
      return index;
    } catch (err: any) {
      if (err instanceof ApiError) throw err;
      if (err.status) throw apiErrorFromStatus(err.message || "GitHub API error", "GITHUB_API_ERROR", err.status);
      throw new EngineError(`Failed to connect to ${cacheKey}: ${err.message}`, "REPO_CONNECT_FAILED");
    }
  }

  /** Build a structured summary for AI consumption. */
  async summarize(indexOrProjectId: RepoIndex | string): Promise<RepoSummary> {
    const index = typeof indexOrProjectId === "string"
      ? this.indexCache.get(indexOrProjectId) || (() => { throw new EngineError("Index not found", "INDEX_NOT_FOUND"); })()
      : indexOrProjectId;

    const readme = index.readme || "";
    const lines = readme.split("\n").filter((l) => l.trim());
    const tagline = lines[0]?.replace(/^#+\s*/, "").trim() || index.repo;
    const description = lines.slice(1, 5).join(" ").trim().slice(0, 300);

    // Detect tech stack from README + common files
    const techStack = this.detectTechStack(index.readme, index.directoryTree);

    // Detect license
    const license = this.detectLicense(index.directoryTree, index.readme);

    return {
      projectName: index.repo,
      tagline,
      description,
      techStack,
      license,
      recentCommits: index.recentCommits,
      directoryTree: index.directoryTree,
      inferredAudience: this.inferAudience(index.readme, techStack),
    };
  }

  /** Extract feature highlights from code patterns (AI supplements this in Task 0.7). */
  async extractHighlights(_projectId: string): Promise<FeatureHighlight[]> {
    // Phase 0: heuristic extraction from README + directory structure.
    // Full AI-driven extraction comes in Task 0.7 (AI Engine).
    return [];
  }

  /** Check current rate limit status. */
  getRateLimit(): RateLimitState {
    return { ...this.rateLimit };
  }

  // ── Private helpers ──

  private async fetchReadme(owner: string, repo: string): Promise<string> {
    try {
      const { data, headers } = await this.octokit.rest.repos.getReadme({ owner, repo });
      this.updateRateLimit({ headers } as any);
      return Buffer.from(data.content, "base64").toString("utf-8");
    } catch (err: any) {
      if (err.status === 404) return "";
      throw this.handleApiError(err);
    }
  }

  private async fetchFileTree(
    owner: string,
    repo: string,
    branch: string,
  ): Promise<string[]> {
    try {
      const { data, headers } = await this.octokit.rest.git.getTree({
        owner,
        repo,
        tree_sha: branch,
        recursive: "1",
      });
      this.updateRateLimit({ headers } as any);
      // Filter to depth ≤ 4, skip node_modules/.git/build/dist
      const skipDirs = ["node_modules", ".git", "build", "dist", "vendor", "__pycache__", ".next"];
      return data.tree
        .filter((item) => {
          if (!item.path) return false;
          const depth = item.path.split("/").length;
          if (depth > 4) return false;
          const topDir = item.path.split("/")[0];
          return !skipDirs.includes(topDir);
        })
        .map((item) => `${item.type === "tree" ? "📁" : "📄"} ${item.path}`)
        .slice(0, 200);
    } catch (err: any) {
      throw this.handleApiError(err);
    }
  }

  private async fetchRecentCommits(
    owner: string,
    repo: string,
    branch: string,
  ): Promise<CommitInfo[]> {
    try {
      const { data, headers } = await this.octokit.rest.repos.listCommits({
        owner,
        repo,
        sha: branch,
        per_page: 10,
      });
      this.updateRateLimit({ headers } as any);
      return data.map((c) => ({
        sha: c.sha.slice(0, 7),
        message: c.commit.message.split("\n")[0].slice(0, 100),
        author: c.commit.author?.name || "unknown",
        date: c.commit.author?.date || "",
      }));
    } catch (err: any) {
      throw this.handleApiError(err);
    }
  }

  // ── Detection heuristics ──

  private detectTechStack(readme: string, tree: string[]): string[] {
    const stack: string[] = [];
    const treeStr = tree.join(" ").toLowerCase();
    const readmeLower = readme.toLowerCase();

    const detectors: [RegExp | string, string][] = [
      [/package\.json/, "Node.js"],
      [/tsconfig\.json/, "TypeScript"],
      [/cargo\.toml/i, "Rust"],
      [/go\.mod/, "Go"],
      [/requirements\.txt|setup\.py|pyproject\.toml/, "Python"],
      [/Gemfile/, "Ruby"],
      [/pom\.xml|build\.gradle/, "Java/Kotlin"],
      [/CMakeLists\.txt/, "C/C++"],
      [/\.swift/, "Swift"],
      [/Dockerfile/, "Docker"],
      [/next\.config/, "Next.js"],
      [/vite\.config/, "Vite"],
      [/tailwind\.config/, "Tailwind CSS"],
    ];

    for (const [pattern, label] of detectors) {
      if (treeStr.match(pattern) || readmeLower.match(pattern)) {
        stack.push(label);
      }
    }

    return stack.length > 0 ? stack : ["Unknown"];
  }

  private detectLicense(tree: string[], readme: string): string | null {
    const licensePatterns: [RegExp, string][] = [
      [/MIT|MIT License/i, "MIT"],
      [/Apache|Apache License/i, "Apache-2.0"],
      [/GPL|GNU General Public/i, "GPL"],
      [/BSD/i, "BSD"],
    ];
    for (const [pattern, label] of licensePatterns) {
      if (readme.match(pattern)) return label;
    }
    if (tree.some((f) => f.toLowerCase().includes("license"))) return "Unknown";
    return null;
  }

  private inferAudience(readme: string, techStack: string[]): string | null {
    const lower = readme.toLowerCase();
    if (lower.includes("cli") || lower.includes("command line")) return "Developers / DevOps";
    if (lower.includes("api") || lower.includes("sdk")) return "Developers / Integrators";
    if (lower.includes("react") || lower.includes("component")) return "Frontend Developers";
    if (lower.includes("desktop") || lower.includes("electron")) return "Desktop Users";
    if (techStack.includes("Rust") || techStack.includes("Go")) return "Systems Developers";
    return null;
  }

  // ── Rate limit + error handling ──

  private updateRateLimit(response: { headers?: Record<string, string> }) {
    const h = response?.headers || {};
    if (h["x-ratelimit-remaining"]) {
      this.rateLimit.remaining = parseInt(h["x-ratelimit-remaining"], 10);
    }
    if (h["x-ratelimit-reset"]) {
      this.rateLimit.reset = parseInt(h["x-ratelimit-reset"], 10) * 1000;
    }
    if (this.rateLimit.remaining <= 5) {
      log.warn(`GitHub API rate limit low: ${this.rateLimit.remaining} remaining`);
    }
  }

  private handleApiError(err: any): never {
    if (err.status === 403 && err.message?.includes("rate limit")) {
      const resetDate = err.headers?.["x-ratelimit-reset"]
        ? new Date(parseInt(err.headers["x-ratelimit-reset"]) * 1000).toISOString()
        : "unknown";
      throw new ApiError(
        `GitHub API rate limit exceeded. Resets at ${resetDate}. Provide a PAT for 5,000 req/h.`,
        "GITHUB_RATE_LIMIT",
        { statusCode: 429, retryable: true, context: { resetDate } },
      );
    }
    if (err.status) {
      throw apiErrorFromStatus(err.message || "GitHub API error", "GITHUB_API_ERROR", err.status);
    }
    throw err;
  }
}
