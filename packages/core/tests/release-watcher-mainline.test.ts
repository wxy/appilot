/**
 * Release watcher main-line detection test.
 * A release tagged on the default branch must be detected even when the local
 * checkout sits on a feature branch that does not contain the tag.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { checkForRelease } from "../src/release-watcher";

let errors = 0;
function check(ok: boolean, msg: string) {
  if (ok) console.log(`✅ PASS: ${msg}`);
  else { console.error(`❌ FAIL: ${msg}`); errors++; }
}

function run(dir: string, args: string[]) {
  execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
}

function setup(): string {
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), "appilot-rel-remote-"));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "appilot-rel-work-"));
  run(remote, ["init", "--bare", "-q"]);
  run(work, ["init", "-q"]);
  run(work, ["config", "user.email", "t@example.com"]);
  run(work, ["config", "user.name", "T"]);
  fs.writeFileSync(path.join(work, "a.txt"), "base\n");
  run(work, ["add", "."]);
  run(work, ["commit", "-qm", "base"]);
  run(work, ["branch", "-M", "master"]);
  run(work, ["remote", "add", "origin", remote]);
  run(work, ["push", "-qu", "origin", "master"]);

  // Feature branch diverges from master.
  run(work, ["checkout", "-qb", "feature"]);
  fs.writeFileSync(path.join(work, "a.txt"), "feature\n");
  run(work, ["add", "."]);
  run(work, ["commit", "-qm", "feature work"]);
  run(work, ["push", "-qu", "origin", "feature"]);

  // Master gets the release commit + tag, not present on the feature branch.
  run(work, ["checkout", "-q", "master"]);
  fs.writeFileSync(path.join(work, "a.txt"), "release\n");
  run(work, ["add", "."]);
  run(work, ["commit", "-qm", "release v1.1.1"]);
  run(work, ["tag", "v1.1.1"]);
  run(work, ["push", "-q", "origin", "master", "--tags"]);

  // The app checkout stays on the feature branch (behind the main line).
  run(work, ["checkout", "-q", "feature"]);
  return work;
}

async function runTest() {
  const work = setup();
  try {
    const result = await checkForRelease(work, null, null, { sync: true });
    check(result.latest?.tag === "v1.1.1", "主分支上的新 tag 在功能分支 checkout 下也能被检测到");
  } catch (err: any) {
    check(false, `checkForRelease 异常: ${err.message}`);
  }
  if (errors) process.exit(1);
  console.log("done");
}
void runTest();
