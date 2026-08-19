/**
 * Read-only git info collection tests
 * Run: npm test (tsx tests/git-info.test.ts)
 */

import path from "path";
import { collectRepoInfo, normalizeGitHubUrl } from "../src/engine/git-info";

let errors = 0;
function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    errors++;
  } else {
    console.log(`✅ PASS: ${msg}`);
  }
}

// 1. normalizeGitHubUrl — common remote forms
assert(
  normalizeGitHubUrl("https://github.com/wxy/appilot.git") === "https://github.com/wxy/appilot",
  "https remote with .git is normalized",
);
assert(
  normalizeGitHubUrl("git@github.com:wxy/appilot.git") === "https://github.com/wxy/appilot",
  "git@ SSH remote is normalized",
);
assert(
  normalizeGitHubUrl("ssh://git@github.com/wxy/appilot.git") === "https://github.com/wxy/appilot",
  "ssh:// remote is normalized",
);
assert(
  normalizeGitHubUrl("https://github.com/wxy/appilot/") === "https://github.com/wxy/appilot",
  "trailing slash is stripped",
);
assert(
  normalizeGitHubUrl("https://gitlab.com/wxy/appilot.git") === null,
  "non-GitHub remote returns null",
);
assert(normalizeGitHubUrl("") === null, "empty remote returns null");
assert(normalizeGitHubUrl(null) === null, "null remote returns null");

// 2. collectRepoInfo against the current repo (read-only commands)
async function run() {
  const repo = await collectRepoInfo(path.resolve(__dirname, ".."));
  assert(repo.remoteUrl === "https://github.com/wxy/appilot.git", "origin remote detected");
  assert(repo.githubUrl === "https://github.com/wxy/appilot", "GitHub URL derived from remote");
  assert(typeof repo.branch === "string" && repo.branch.length > 0, "current branch detected");
  assert(typeof repo.headSha === "string" && repo.headSha.length > 0, "HEAD short sha detected");
  assert(typeof repo.headMessage === "string" && repo.headMessage.length > 0, "HEAD message detected");
  assert(typeof repo.headDate === "string" && !Number.isNaN(new Date(repo.headDate).getTime()), "HEAD date is ISO");
  assert(typeof repo.dirty === "boolean", "dirty flag is boolean");
  assert(typeof repo.capturedAt === "string", "capturedAt set");

  if (errors === 0) console.log("\nAll git-info tests passed ✅");
  else {
    console.error(`\n${errors} git-info test(s) failed ❌`);
    process.exit(1);
  }
}

void run();
