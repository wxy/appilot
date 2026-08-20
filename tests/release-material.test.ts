/**
 * Release material (boundary + branch-merge signal) integration tests
 * Run: npm test (tsx tests/release-material.test.ts)
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import {
  collectReleaseMaterial,
  checkForRelease,
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
  commit(dir, "a.txt", "chore: initial commit");
  return dir;
}

async function runTests() {
  const dir = setupRepo();
  try {
    const first = await checkForRelease(dir, null);
    assert(first.latest?.source === "git-commits", "first run: source is git-commits");
    assert(
      (first.latest?.body || "").includes("no merge detected"),
      "first run: no merge signal yet",
    );
    const boundary = first.latest?.commitSha || null;
    assert(typeof boundary === "string" && boundary.length > 0, "first run: boundary captured");

    // Direct commit on main only → NOT a release candidate.
    commit(dir, "b.txt", "fix: typo");
    const directOnly = await checkForRelease(dir, boundary);
    assert(directOnly.latest === null && directOnly.releases.length === 0, "direct commit alone: no release");

    // Merge a feature branch (--no-ff) → release candidate with merge material.
    run(dir, ["checkout", "-q", "-b", "feature"]);
    commit(dir, "c.txt", "feat: night walk support (#2)");
    run(dir, ["checkout", "-q", "-"]);
    run(dir, ["merge", "--no-ff", "feature", "-m", "Merge branch 'feature'"]);

    const merged = await checkForRelease(dir, boundary);
    const mergedBody = merged.latest?.body || "";
    assert(merged.latest !== null, "merge: candidate created");
    assert(merged.isNew === true, "merge: new release");
    assert(mergedBody.includes("Merged into main"), "merge: body labels merged commits");
    assert(mergedBody.includes("feat: night walk support (#2)"), "merge: feature commit in material");
    assert(mergedBody.includes("Direct commits on the main line (excluded): 1"), "merge: direct commit excluded");
    assert(mergedBody.includes("#2"), "merge: PR ref listed in body");

    // Squash-style commit (single parent + PR ref) also counts as merge-like.
    commit(dir, "d.txt", "feat: dark mode (#3)");
    const squash = await checkForRelease(dir, boundary);
    const squashBody = squash.latest?.body || "";
    assert(squashBody.includes("feat: dark mode (#3)"), "squash-style: PR-referenced commit counted");

    const material = await collectReleaseMaterial(dir, boundary);
    assert(material.commits.some((c) => c.parents >= 2), "collectReleaseMaterial: merge parents detected");
    assert(
      material.mergeCommits.length >= 2,
      "collectReleaseMaterial: merge-like filtering (merge commit + PR commit)",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  if (errors === 0) console.log("\nAll release-material tests passed ✅");
  else { console.error(`\n${errors} test(s) failed ❌`); process.exit(1); }
}

void runTests();
