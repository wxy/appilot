/**
 * collectReleaseMaterial 多 frontier 边界泄漏回归测试（审计 2026-09-26 H2）。
 *
 * 场景：origin/master 已前进（边界后新提交），origin/main 停在分叉线上
 * 「边界之前」的旧提交（废弃分支/改写历史）。旧实现 `git log since..ref0
 * ref1 …` 的排除集只作用于 ref0，旧提交按可达性被计入素材；且 `diff --stat`
 * 带 3 个 ref 时直接失败并被 catch 静默清空。
 *
 * 修复语义：
 * 1) 有边界 + 多 ref → 逐 ref 取 `since..ref` 按 sha 并集，diff 用并集 tip 的
 *    单一区间；
 * 2) 分叉线上边界之前的旧提交按边界日期过滤（可达性无法表达「边界前」）；
 * 3) 无边界（since=null）保持可达并集语义，不过滤日期。
 * 用临时 git 仓库驱动真实 git，纯 node。
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import assert from "node:assert/strict";
import { collectReleaseMaterial } from "../src/release-watcher";

function run(dir: string, args: string[], env?: Record<string, string>): string {
  return execFileSync("git", ["-C", dir, ...args], {
    stdio: "pipe",
    ...(env ? { env: { ...process.env, ...env } } : {}),
  }).toString().trim();
}

function commit(dir: string, file: string, message: string, env?: Record<string, string>): string {
  fs.writeFileSync(path.join(dir, file), message);
  run(dir, ["add", "."]);
  run(dir, ["commit", "-qm", message], env);
  return run(dir, ["rev-parse", "HEAD"]);
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "appilot-frontier-"));
  run(dir, ["init", "-q"]);
  run(dir, ["config", "user.email", "t@example.com"]);
  run(dir, ["config", "user.name", "T"]);
  run(dir, ["branch", "-M", "master"]);
  commit(dir, "a.txt", "base");
  const b1 = commit(dir, "b.txt", "feature one");
  run(dir, ["tag", "v1.0.0"]);
  const b2 = commit(dir, "c.txt", "feature two");
  // 分叉线：从 base（边界之前）拉出 side，提交日期伪造为 2020 年（远早于边界）
  run(dir, ["checkout", "-qb", "side", "master~2"]);
  const s1 = commit(dir, "s.txt", "stale side commit", {
    GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z",
  });
  run(dir, ["checkout", "-q", "master"]);
  run(dir, ["update-ref", "refs/remotes/origin/master", b2]);
  run(dir, ["update-ref", "refs/remotes/origin/main", s1]);

  // 1) 有边界 + 多 frontier（head、origin/master、origin/main）：
  //    只应含边界后的主线提交，分叉线上的 2020 年旧提交必须被排除。
  const material = await collectReleaseMaterial(dir, b1, [b2, b2, s1]);
  const subjects = material.commits.map((c) => c.subject);
  assert.deepEqual(subjects, ["feature two"], `应只含边界后主线提交（实际 ${JSON.stringify(subjects)}）`);
  assert.ok(!subjects.includes("stale side commit"), "边界前旧提交不得泄漏");
  assert.equal(material.sinceDate != null, true, "sinceDate 应解析");
  assert.ok(material.diffStat.length > 0, "diff --stat 应用单一区间成功（非静默空）");

  // 2) 单 ref + 边界：基线行为不变。
  const single = await collectReleaseMaterial(dir, b1, b2);
  assert.deepEqual(
    single.commits.map((c) => c.subject),
    ["feature two"],
    "单 ref 区间行为不变",
  );

  // 3) 无边界 + 多 ref：保持可达并集语义（不做日期过滤，不虚构排除）。
  const unbounded = await collectReleaseMaterial(dir, null, [b2, s1]);
  const unboundedSubjects = unbounded.commits.map((c) => c.subject);
  assert.ok(unboundedSubjects.includes("feature two"), "无边界：包含主线提交");
  assert.ok(unboundedSubjects.includes("stale side commit"), "无边界：包含分叉线提交");

  fs.rmSync(dir, { recursive: true, force: true });
  console.log("release-watcher frontier 回归测试全部通过 ✓");
}

main().catch((err) => {
  console.error("frontier 测试失败:", err);
  process.exit(1);
});
