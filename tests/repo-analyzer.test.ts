/**
 * Repo Analyzer tests — mocks octokit to avoid real API calls.
 */

import { RepoAnalyzer, RepoIndex } from "../src/engine/repo-analyzer";

let errors = 0;
function assert(condition: boolean, msg: string) {
  if (!condition) { console.error(`❌ FAIL: ${msg}`); errors++; }
  else { console.log(`✅ PASS: ${msg}`); }
}

// 1. parseGitHubUrl
const r1 = RepoAnalyzer.parseGitHubUrl("github.com/facebook/react");
assert(r1.owner === "facebook" && r1.repo === "react", "parseGitHubUrl without protocol");

const r2 = RepoAnalyzer.parseGitHubUrl("https://github.com/user/my-repo.git");
assert(r2.owner === "user" && r2.repo === "my-repo", "parseGitHubUrl with .git suffix");

const r3 = RepoAnalyzer.parseGitHubUrl("https://github.com/owner/repo/");
assert(r3.owner === "owner" && r3.repo === "repo", "parseGitHubUrl with trailing slash");

const r4 = RepoAnalyzer.parseGitHubUrl("owner/repo");
assert(r4.owner === "owner" && r4.repo === "repo", "parseGitHubUrl short form");

try {
  RepoAnalyzer.parseGitHubUrl("not-a-url");
  assert(false, "parseGitHubUrl should throw on invalid URL");
} catch {
  assert(true, "parseGitHubUrl throws on invalid URL");
}

// 2. summarize from index
async function runTests() {
const analyzer = new RepoAnalyzer();
const mockIndex: RepoIndex = {
  owner: "test",
  repo: "cool-app",
  defaultBranch: "main",
  indexedAt: new Date(),
  readme: [
    "# Cool App",
    "A CLI tool for automating workflows — built with Rust and TypeScript.",
    "",
    "## Features",
    "- Parallel execution",
    "- YAML config",
    "",
    "## License",
    "MIT",
  ].join("\n"),
  directoryTree: [
    "📄 README.md",
    "📄 package.json",
    "📄 tsconfig.json",
    "📄 Cargo.toml",
    "📁 src",
    "📄 LICENSE",
    "📄 Dockerfile",
  ],
  recentCommits: [
    { sha: "abc1234", message: "Add parallel download support", author: "dev", date: "2026-07-15T10:00:00Z" },
    { sha: "def5678", message: "Fix config parsing", author: "dev", date: "2026-07-14T10:00:00Z" },
  ],
};

const summary = await analyzer.summarize(mockIndex);
assert(summary.projectName === "cool-app", "summarize: project name from repo");
assert(summary.tagline === "Cool App", "summarize: tagline from first heading");
assert(summary.techStack.includes("Node.js"), "summarize: detects Node.js from package.json");
assert(summary.techStack.includes("TypeScript"), "summarize: detects TypeScript from tsconfig.json");
assert(summary.techStack.includes("Rust"), "summarize: detects Rust from Cargo.toml");
assert(summary.license === "MIT", "summarize: detects MIT license");
assert(summary.recentCommits.length === 2, "summarize: preserves recent commits");
assert(summary.directoryTree.length === 7, "summarize: preserves directory tree");
assert(summary.inferredAudience === "Developers / DevOps", "summarize: infers CLI audience");

// 3. extractHighlights (placeholder in Phase 0)
const highlights = await analyzer.extractHighlights("test");
assert(Array.isArray(highlights), "extractHighlights: returns array (placeholder)");

// 4. Rate limit tracking
const rl = analyzer.getRateLimit();
assert(rl.remaining === 60, "rate limit: initial remaining = 60");
assert(rl.reset === 0, "rate limit: initial reset = 0");

console.log(`\n${errors === 0 ? "🎉 All repo analyzer tests passed!" : `❌ ${errors} test(s) failed`}`);
process.exit(errors > 0 ? 1 : 0);
}

runTests();
