/**
 * Release material (new-tag signal) integration tests
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
  commit(dir, "a.txt", "chore: initial");
  commit(dir, "b.txt", "feat: walk (#1)");
  run(dir, ["tag", "v1.0.0"]);
  commit(dir, "c.txt", "feat: night walk support (#2)");
  commit(dir, "d.txt", "fix: map loading (#3)");
  run(dir, ["tag", "-a", "v1.1.0", "-m", "v1.1.0 release"]);
  commit(dir, "e.txt", "chore: post-tag work");
  return dir;
}

async function runTests() {
  const dir = setupRepo();
  try {
    const tags = await listGitTags(dir);
    assert(tags.length === 2 && tags[0].name === "v1.1.0" && tags[1].name === "v1.0.0", "listGitTags: newest first");

    const between = await collectReleaseMaterial(dir, "v1.0.0", "v1.1.0");
    assert(between.commits.length === 2, "collectReleaseMaterial: commits between tags");
    assert(
      between.commits.every((c) => !c.subject.includes("chore: initial")),
      "collectReleaseMaterial: excludes pre-previous-tag commits",
    );
    assert(between.pullRequests.some((pr) => pr.number === 2), "collectReleaseMaterial: PR ref extracted");

    const first = await collectReleaseMaterial(dir, null, "v1.0.0");
    assert(first.commits.length === 2, "collectReleaseMaterial: first tag covers history up to it");

    const result = await checkForRelease(dir, null);
    assert(result.latest?.tag === "v1.1.0", "checkForRelease: newest tag wins");
    assert(result.latest?.source === "git-tag", "checkForRelease: source is git-tag");
    const body = result.latest?.body || "";
    assert(body.includes("since the previous release (v1.0.0)"), "checkForRelease: boundary wording");
    assert(
      body.includes("feat: night walk support (#2)") &&
        body.includes("fix: map loading (#3)") &&
        !body.includes("chore: initial") &&
        !body.includes("post-tag work"),
      "checkForRelease: material exactly between tags",
    );
    assert(result.isNew === true, "checkForRelease: unseen tag is new");
    assert((await checkForRelease(dir, "v1.1.0")).isNew === false, "checkForRelease: same tag not new");
    assert((await checkForRelease(dir, "v1.0.0")).isNew === true, "checkForRelease: older seen tag still new");

    // A new tag after more commits becomes the next release candidate.
    run(dir, ["tag", "v1.2.0"]);
    const next = await checkForRelease(dir, "v1.1.0");
    const nextBody = next.latest?.body || "";
    assert(next.latest?.tag === "v1.2.0", "checkForRelease: latest tag after new tag");
    assert(
      nextBody.includes("post-tag work") && !nextBody.includes("feat: night walk support"),
      "checkForRelease: next release material since v1.1.0",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  if (errors === 0) console.log("\nAll release-material tests passed ✅");
  else { console.error(`\n${errors} test(s) failed ❌`); process.exit(1); }
}

void runTests();
