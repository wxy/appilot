/**
 * project-sync 单测：项目级发布同步执行器（纯，不依赖壳存储）。
 * 用临时 git 仓库（本地 tag）+ 无 remote（GitHub 走公开降级为空）覆盖。
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import assert from "node:assert/strict";
import { syncProjectReleaseState, inspectProjectRelease } from "../src/project-sync";

async function main(): Promise<void> {
  // 建临时 git 仓库：commit + tag v1.0.0
  const dir = mkdtempSync(join(tmpdir(), "project-sync-"));
  execSync("git init -q", { cwd: dir });
  execSync('git config user.email "test@test.dev" && git config user.name "test"', { cwd: dir });
  execSync("echo hi > a.txt && git add -A && git commit -qm init", { cwd: dir });
  execSync("git tag v1.0.0", { cwd: dir });

  // fetchRemote=false：不 fetch（无 remote 也安全）；tags 读到 v1.0.0；releases 空（无 remote）
  const state = await syncProjectReleaseState(dir, { token: null, fetchRemote: false });
  assert.equal(state.fetched, false);
  assert.equal(state.latestTag?.name, "v1.0.0", "应读到本地 tag v1.0.0");
  assert.equal(state.draftCount, 0);
  assert.equal(state.publishedCount, 0);
  assert.ok(state.summary.includes("tag=v1.0.0"), `摘要应含 tag: ${state.summary}`);
  assert.ok(state.summary.includes("GitHub 发布 0"), `摘要应含发布数: ${state.summary}`);
  console.log("✓ 本地 tag 提取 + 摘要（无 remote → releases 空）");

  // fetchRemote=true 在无 remote 仓库：安全降级（fetched=false，不抛）
  const state2 = await syncProjectReleaseState(dir, { token: null, fetchRemote: true });
  assert.equal(state2.fetched, false, "无 remote 时 fetch 应安全返回 false");
  assert.equal(state2.latestTag?.name, "v1.0.0");
  console.log("✓ fetchRemote 无 remote 安全降级");

  // 深度检测（Electron github-sync 同链）：无 remote/token → 本地 git-tag 产物
  const inspection = await inspectProjectRelease(dir, { token: null, fetchRemote: false });
  assert.equal(inspection.release?.tag, "v1.0.0", "无 GitHub 时应回退本地 tag 作为候选发布");
  assert.equal(inspection.release?.source, "git-tag");
  assert.equal(inspection.material?.commits.length, 1, "单 commit 素材");
  assert.deepEqual(inspection.repoCapabilities, { push: null, tokenKind: "none", contents: null }, "无 token → none");
  assert.equal(inspection.lastSeenTag, null);
  assert.ok(inspection.summary.includes("tag=v1.0.0"));
  console.log("✓ inspectProjectRelease 深度链（无 remote/token 降级）");

  console.log("project-sync 单测全部通过 ✓");
}

main().catch((err) => {
  console.error("project-sync 测试失败:", err);
  process.exit(1);
});
