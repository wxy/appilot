/**
 * Release material (boundary = last generated; main-line tag as signal/name)
 * integration tests.
 * Run: npm test (tsx tests/release-material.test.ts)
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import {
  listGitTags,
  collectReleaseMaterial,
  checkForRelease,
  fetchRemoteTags,
  filterMaterial,
  materialToBody,
  syncLocalRepo,
} from "../src/engine/release-watcher";

let errors = 0;
function assert(condition: boolean, msg: string) {
  if (!condition) { console.error(`❌ FAIL: ${msg}`); errors++; }
  else { console.log(`✅ PASS: ${msg}`); }
}

function run(dir: string, args: string[]) {
  execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
}

function commit(dir: string, file: string, message: string) {
  fs.writeFileSync(path.join(dir, file), message);
  run(dir, ["add", "."]);
  run(dir, ["commit", "-q", "-m", message]);
}

function setupRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "appilot-release-"));
  run(dir, ["init", "-q"]);
  run(dir, ["config", "user.email", "test@example.com"]);
  run(dir, ["config", "user.name", "Test"]);
  run(dir, ["config", "commit.gpgsign", "false"]);
  commit(dir, "a.txt", "chore: initial");
  commit(dir, "b.txt", "feat: walk (#1)");
  run(dir, ["tag", "v1.0.0"]);
  commit(dir, "c.txt", "feat: night walk support (#2)");
  run(dir, ["tag", "-a", "v1.1.0", "-m", "v1.1.0 release"]);
  commit(dir, "d.txt", "fix: map loading (#3)");
  return dir;
}

async function runTests() {
  const dir = setupRepo();
  try {
    // First run (no boundary): material = recent history, named by newest main-line tag.
    const first = await checkForRelease(dir, null);
    const firstBody = first.latest?.body || "";
    assert(first.latest?.tag === "v1.1.0", "first run: named by newest main-line tag");
    assert(first.latest?.source === "git-tag", "first run: source git-tag");
    assert(
      firstBody.includes("feat: night walk support") && firstBody.includes("fix: map loading"),
      "first run: material covers history",
    );
    const boundary = first.latest?.commitSha || null;
    assert(typeof boundary === "string" && boundary.length > 0, "first run: boundary captured");

    // No new commits → no candidate.
    assert((await checkForRelease(dir, boundary)).latest === null, "no changes: no candidate");

    // New commits after boundary: candidate named head-<sha>, material only since boundary.
    commit(dir, "e.txt", "feat: dark mode (#4)");
    const untagged = await checkForRelease(dir, boundary);
    assert((untagged.latest?.tag || "").startsWith("head-"), "untagged: head-named candidate");
    assert(untagged.latest?.source === "git-commits", "untagged: source git-commits");
    const untaggedBody = untagged.latest?.body || "";
    assert(
      untaggedBody.includes("feat: dark mode (#4)") && !untaggedBody.includes("chore: initial"),
      "untagged: material only since boundary",
    );

    // New main-line tag names the candidate.
    run(dir, ["tag", "v1.2.0"]);
    const tagged = await checkForRelease(dir, boundary);
    assert(tagged.latest?.tag === "v1.2.0" && tagged.latest?.source === "git-tag", "tagged: tag names candidate");

    // Backport tag on an old branch must NOT hijack the candidate.
    run(dir, ["checkout", "-q", "-b", "hotfix", "v1.0.0"]);
    commit(dir, "h.txt", "fix: hotfix (#9)");
    run(dir, ["tag", "v1.0.1"]);
    run(dir, ["checkout", "-q", "-"]);
    const backport = await checkForRelease(dir, boundary);
    assert(backport.latest?.tag === "v1.2.0", "backport: v1.0.1 filtered off the main line");

    // A tag on an already-generated commit does not rename the candidate.
    run(dir, ["tag", "v1.1.1", "HEAD~2"]);
    const oldTag = await checkForRelease(dir, boundary);
    const oldTagName = oldTag.latest?.tag || "";
    assert(oldTagName !== "v1.1.1", "old tag on generated history: not chosen as the name");
    assert(oldTagName === "v1.2.0", "old tag on generated history: newest ungenerated tag still wins");

    // Moved tag re-anchors: new commit + force-move the tag.
    commit(dir, "f.txt", "fix: review feedback (#10)");
    run(dir, ["tag", "-f", "v1.2.0", "-m", "v1.2.0 re-release"]);
    const moved = await checkForRelease(dir, boundary);
    assert(moved.latest?.tag === "v1.2.0", "moved tag: still names the candidate");
    assert(
      (moved.latest?.body || "").includes("fix: review feedback (#10)"),
      "moved tag: material includes post-move commits",
    );

    // collectReleaseMaterial honors an explicit since-boundary.
    const material = await collectReleaseMaterial(dir, boundary);
    assert(material.commits.length === 2, "collectReleaseMaterial: commits since boundary");
    assert(material.pullRequests.some((pr) => pr.number === 10), "collectReleaseMaterial: PR ref extracted");
    assert(typeof material.sinceDate === "string" && material.sinceDate.length > 0, "collectReleaseMaterial: sinceDate populated");

    // filterMaterial keeps only the chosen commits and re-derives PRs.
    const reviewSha = material.commits.find((c) => c.subject.includes("review feedback"))?.sha || "";
    const filtered = filterMaterial(material, [reviewSha]);
    assert(filtered.commits.length === 1, "filterMaterial: only included commits kept");
    assert(filtered.pullRequests.some((pr) => pr.number === 10), "filterMaterial: PR list re-derived");

    // GitHub release announcement joins the AI material and survives filtering.
    const withRelease = {
      ...material,
      githubRelease: { name: "v1.2.0 release", body: "What's new: dark mode", publishedAt: null, url: null },
    };
    const bodyWithRelease = materialToBody(withRelease);
    assert(
      bodyWithRelease.includes("Official release announcement") && bodyWithRelease.includes("dark mode"),
      "materialToBody: GitHub release announcement included",
    );
    const filteredWithRelease = filterMaterial(withRelease, [reviewSha]);
    assert(
      filteredWithRelease.githubRelease?.name === "v1.2.0 release",
      "filterMaterial: GitHub release preserved after filtering",
    );

    // fetchRemoteTags: a tag published on the remote appears locally after sync.
    const originDir = fs.mkdtempSync(path.join(os.tmpdir(), "appilot-origin-"));
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "appilot-work-"));
    run(originDir, ["init", "-q", "--bare"]);
    run(workDir, ["init", "-q"]);
    run(workDir, ["remote", "add", "origin", originDir]);
    run(workDir, ["config", "user.email", "test@example.com"]);
    run(workDir, ["config", "user.name", "Test"]);
    run(workDir, ["config", "commit.gpgsign", "false"]);
    commit(workDir, "g.txt", "feat: remote work (#5)");
    run(workDir, ["push", "-q", "origin", "HEAD"]);
    run(workDir, ["tag", "v9.9.9"]);
    run(workDir, ["push", "-q", "origin", "v9.9.9"]);
    run(workDir, ["tag", "-d", "v9.9.9"]);
    assert(!(await listGitTags(workDir)).some((t) => t.name === "v9.9.9"), "fetch: tag absent before sync");
    assert((await fetchRemoteTags(workDir)) === true, "fetch: remote sync succeeded");
    assert((await listGitTags(workDir)).some((t) => t.name === "v9.9.9"), "fetch: tag synced from remote");
    fs.rmSync(originDir, { recursive: true, force: true });
    fs.rmSync(workDir, { recursive: true, force: true });

    // syncLocalRepo: fetch + fast-forward the local main branch when clean.
    const syncOrigin = fs.mkdtempSync(path.join(os.tmpdir(), "appilot-sync-origin-"));
    const syncWork = fs.mkdtempSync(path.join(os.tmpdir(), "appilot-sync-work-"));
    run(syncOrigin, ["init", "-q", "--bare"]);
    run(syncWork, ["init", "-q"]);
    run(syncWork, ["remote", "add", "origin", syncOrigin]);
    run(syncWork, ["config", "user.email", "test@example.com"]);
    run(syncWork, ["config", "user.name", "Test"]);
    run(syncWork, ["config", "commit.gpgsign", "false"]);
    commit(syncWork, "s1.txt", "sync: base");
    run(syncWork, ["push", "-q", "origin", "HEAD"]);
    const branchName = execFileSync("git", ["-C", syncWork, "symbolic-ref", "--short", "HEAD"]).toString().trim();
    run(syncOrigin, ["symbolic-ref", "HEAD", `refs/heads/${branchName}`]);
    const syncCloneRoot = fs.mkdtempSync(path.join(os.tmpdir(), "appilot-sync-clone-"));
    run(syncCloneRoot, ["clone", "-q", syncOrigin, "repo"]);
    const cloneRepo = path.join(syncCloneRoot, "repo");
    commit(syncWork, "s2.txt", "sync: new work");
    run(syncWork, ["push", "-q", "origin", "HEAD"]);
    const remoteTip = execFileSync("git", ["-C", syncWork, "rev-parse", "HEAD"]).toString().trim();
    assert((await syncLocalRepo(cloneRepo)) === true, "sync: local repo updated");
    const localTip = execFileSync("git", ["-C", cloneRepo, "rev-parse", "HEAD"]).toString().trim();
    assert(localTip === remoteTip, "sync: local main fast-forwarded to origin tip");
    fs.writeFileSync(path.join(cloneRepo, "dirty.txt"), "x");
    commit(syncWork, "s3.txt", "sync: more work");
    run(syncWork, ["push", "-q", "origin", "HEAD"]);
    const beforeDirty = execFileSync("git", ["-C", cloneRepo, "rev-parse", "HEAD"]).toString().trim();
    await syncLocalRepo(cloneRepo);
    const afterDirty = execFileSync("git", ["-C", cloneRepo, "rev-parse", "HEAD"]).toString().trim();
    assert(beforeDirty === afterDirty, "sync: dirty working tree not fast-forwarded");
    fs.rmSync(syncOrigin, { recursive: true, force: true });
    fs.rmSync(syncWork, { recursive: true, force: true });
    fs.rmSync(syncCloneRoot, { recursive: true, force: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  if (errors === 0) console.log("\nAll release-material tests passed ✅");
  else { console.error(`\n${errors} test(s) failed ❌`); process.exit(1); }
}

void runTests();
