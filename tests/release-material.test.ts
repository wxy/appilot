/**
 * Release material (git-tag based) integration tests
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

function setupRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "appilot-release-"));
  run(dir, ["init", "-q"]);
  run(dir, ["config", "user.email", "test@example.com"]);
  run(dir, ["config", "user.name", "Test"]);
  fs.writeFileSync(path.join(dir, "a.txt"), "1");
  run(dir, ["add", "."]);
  run(dir, ["commit", "-q", "-m", "feat: initial (#1)"]);
  run(dir, ["tag", "v1.0.0"]);
  fs.writeFileSync(path.join(dir, "b.txt"), "2");
  run(dir, ["add", "."]);
  run(dir, ["commit", "-q", "-m", "feat: night walk support (#2)"]);
  run(dir, ["tag", "-a", "v1.1.0", "-m", "v1.1.0 release"]);
  return dir;
}

async function runTests() {
  const dir = setupRepo();
  try {
    const tags = await listGitTags(dir);
    assert(tags.length === 2 && tags[0].name === "v1.1.0" && tags[1].name === "v1.0.0", "listGitTags: newest first");
    assert(tags[0].sha.length > 0 && tags[0].date.length > 0, "listGitTags: sha + date populated");

    const material = await collectReleaseMaterial(dir, "v1.0.0");
    assert(material.commits.length === 1, "collectReleaseMaterial: commits since previous tag");
    assert(material.commits[0].subject.includes("night walk support"), "collectReleaseMaterial: subject parsed");
    assert(material.pullRequests.some((pr) => pr.number === 2), "collectReleaseMaterial: PR ref extracted");
    assert(material.sinceTag === "v1.0.0", "collectReleaseMaterial: sinceTag recorded");

    const result = await checkForRelease(dir, null);
    assert(result.latest?.tag === "v1.1.0", "checkForRelease: latest tag wins");
    assert(result.latest?.source === "git-tag", "checkForRelease: source is git-tag");
    const body = result.latest?.body || "";
    assert(body.includes("night walk support") && body.includes("#2"), "checkForRelease: body has commit/PR material");
    assert(result.isNew === true, "checkForRelease: unseen tag is new");
    const seen = await checkForRelease(dir, "v1.1.0");
    assert(seen.isNew === false, "checkForRelease: same tag not new");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  if (errors === 0) console.log("\nAll release-material tests passed ✅");
  else { console.error(`\n${errors} test(s) failed ❌`); process.exit(1); }
}

void runTests();
