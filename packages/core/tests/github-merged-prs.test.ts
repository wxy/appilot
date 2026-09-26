/**
 * fetchMergedPullRequests 边界窗口契约测试（审计 2026-09-26 M-C1）。
 *
 * 旧实现 /pulls?sort=updated 分页 + merged_at 本地过滤：只覆盖最近更新的
 * 300 个 PR，窗口内合并但此后无更新的 PR 会被静默挤出。修复后带 cutoff 时
 * 走 Search API（服务端 merged:>= 过滤 + updated 排序），再按实际 merged_at 排序。
 *
 * 通过替换全局 fetch 注入响应，断言请求契约与结果映射。纯 node。
 */
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { fetchMergedPullRequests } from "../src/github-api";

const realFetch = globalThis.fetch;

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "appilot-ghpr-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "T"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "a.txt"), "x");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/owner/repo.git"], { cwd: dir });

  const requestedUrls: string[] = [];
  let denseWindow = false;
  globalThis.fetch = (async (url: string | URL): Promise<Response> => {
    const href = String(url);
    requestedUrls.push(href);
    const json = (body: unknown, status = 200): Response =>
      ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) } as unknown as Response);
    if (href.includes("/repos/owner/repo?") || href.endsWith("/repos/owner/repo")) {
      return json({ default_branch: "main" });
    }
    if (href.includes("/search/issues?")) {
      if (denseWindow) {
        const newerCreated = Array.from({ length: 59 }, (_, index) => ({
          number: 200 + index,
          title: `ordinary ${index}`,
          body: "",
          html_url: `https://github.com/owner/repo/pull/${200 + index}`,
          pull_request: { merged_at: "2026-09-18T00:00:00Z" },
        }));
        return json({
          total_count: 60,
          items: [
            ...newerCreated,
            {
              number: 999,
              title: "long-running PR merged most recently",
              body: "",
              html_url: "https://github.com/owner/repo/pull/999",
              pull_request: { merged_at: "2026-09-25T00:00:00Z" },
            },
          ],
        });
      }
      // PR #101：窗口内合并（新）；#102：合并时间早于 cutoff（应被服务端过滤
      // 语义之外再本地兜底排除）；#103：无 pull_request.merged_at 但有 closed_at。
      return json({
        total_count: 2,
        items: [
          {
            number: 101,
            title: "new feature",
            body: "body-101",
            html_url: "https://github.com/owner/repo/pull/101",
            pull_request: { merged_at: "2026-09-20T00:00:00Z" },
          },
          {
            number: 102,
            title: "old merged",
            body: "",
            html_url: "https://github.com/owner/repo/pull/102",
            pull_request: { merged_at: "2020-01-01T00:00:00Z" },
          },
          {
            number: 103,
            title: "no merged_at",
            body: "",
            html_url: "https://github.com/owner/repo/pull/103",
            pull_request: {},
            closed_at: "2026-09-21T00:00:00Z",
          },
        ],
      });
    }
    return json({ message: "not found" }, 404);
  }) as unknown as typeof fetch;

  try {
    const sinceDate = "2026-09-15T00:00:00Z";
    const prs = await fetchMergedPullRequests(dir, sinceDate, null);

    const searchUrls = requestedUrls.filter((u) => u.includes("/search/issues?"));
    assert.ok(searchUrls.length > 0, "带 cutoff 时应走 Search API");
    assert.ok(
      searchUrls.every((u) => u.includes("q=repo%3Aowner%2Frepo+is%3Apr+is%3Amerged")),
      "查询应含 repo/is:pr/is:merged（URLSearchParams 编码后）",
    );
    assert.ok(
      searchUrls[0].includes("merged%3A%3E%3D2026-09-15T00%3A00%3A00.000Z"),
      "查询应含服务端 merged:>=cutoff 窗口",
    );
    assert.ok(searchUrls[0].includes("sort=updated"), "应优先按更新排序，再以实际合并时间排序结果");

    const numbers = prs.map((pr) => pr.number).sort((a, b) => a - b);
    assert.deepEqual(numbers, [101, 103], "早于 cutoff 的 #102 应被排除");
    const pr101 = prs.find((pr) => pr.number === 101)!;
    assert.equal(pr101.title, "new feature");
    assert.equal(pr101.url, "https://github.com/owner/repo/pull/101");
    assert.equal(pr101.mergedAt, "2026-09-20T00:00:00Z");

    denseWindow = true;
    const dense = await fetchMergedPullRequests(dir, "2026-09-16T00:00:00Z", null);
    assert.equal(dense.length, 50, "变更摘要仍限制 50 条");
    assert.equal(dense[0].number, 999, "较早创建但最近合并的 PR 应优先入选");
  } finally {
    globalThis.fetch = realFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log("github merged-PR 窗口契约测试全部通过 ✓");
}

main().catch((err) => {
  console.error("merged-PR 测试失败:", err);
  process.exit(1);
});
