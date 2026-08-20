/**
 * Release material (boundary-based, no tags/token) integration tests
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
  commit(dir, "a.txt", "feat: initial (#1)");
  commit(dir, "b.txt", "feat: night walk support (#2)");
  return dir;
}

async function runTests() {
  const dir = setupRepo();
  try {
    const material = await collectReleaseMaterial(dir, "HEAD~1");
    assert(material.commits.length === 1, "collectReleaseMaterial: commits since boundary");
    assert(material.commits[0].subject.includes("night walk support"), "collectReleaseMaterial: subject parsed");
    assert(material.pullRequests.some((pr) => pr.number === 2), "collectReleaseMaterial: PR ref extracted");
    assert(material.since === "HEAD~1", "collectReleaseMaterial: since recorded");

    const first = await checkForRelease(dir, null);
    assert(first.latest?.source === "git-commits", "checkForRelease: source is git-commits");
    assert((first.latest?.tag || "").startsWith("head-"), "checkForRelease: candidate keyed by HEAD");
    const firstBody = first.latest?.body || "";
    assert(
      firstBody.includes("feat: initial (#1)") && firstBody.includes("night walk support"),
      "checkForRelease: first run uses recent history",
    );
    assert(first.isNew === true, "checkForRelease: no boundary → new");

    const head = first.latest?.commitSha || null;
    assert(typeof head === "string" && head.length > 0, "checkForRelease: head sha exposed");

    const same = await checkForRelease(dir, head);
    assert(same.isNew === false, "checkForRelease: same head not new");

    commit(dir, "c.txt", "fix: dark mode (#3)");
    const next = await checkForRelease(dir, head);
    assert(next.isNew === true, "checkForRelease: new commits after boundary → new");
    const nextBody = next.latest?.body || "";
    assert(
      nextBody.includes("fix: dark mode (#3)") && !nextBody.includes("feat: initial"),
      "checkForRelease: material only since boundary",
    );
    assert(
      nextBody.includes("since the last generated release"),
      "checkForRelease: boundary wording used",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  if (errors === 0) console.log("\nAll release-material tests passed ✅");
  else { console.error(`\n${errors} test(s) failed ❌`); process.exit(1); }
}

void runTests();
