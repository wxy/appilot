import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import {
  fetchIssues,
  mergeFeedbackItems,
  normalizeIssue,
  reviewsToFeedbackItems,
} from "../src/engine/feedback-inbox";
import type { Review } from "../src/engine/review-collector";

let errors = 0;
function check(ok: boolean, msg: string) {
  if (ok) console.log(`✅ PASS: ${msg}`);
  else { console.error(`❌ FAIL: ${msg}`); errors++; }
}
function run(dir: string, args: string[]) {
  execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
}
function setupRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "appilot-fb-"));
  run(dir, ["init", "-q"]);
  run(dir, ["remote", "add", "origin", "https://github.com/wxy/glowalk.git"]);
  return dir;
}

const issue: any = {
  number: 12,
  title: "请求夜间模式",
  body: "希望加一个夜间模式",
  state: "open",
  html_url: "https://github.com/wxy/glowalk/issues/12",
  user: { login: "alice" },
  created_at: "2026-08-20T10:00:00Z",
};
const normalized = normalizeIssue(issue);
check(normalized.source === "issue" && normalized.sourceId === "12", "normalizeIssue 映射 source/sourceId");
check(normalized.url === issue.html_url && normalized.state === "open", "normalizeIssue 保留 url/state");

const review: Review = {
  id: "r1", trackId: "1", country: "us", rating: 2, title: "闪退",
  body: "启动就崩", version: "1.0", author: "bob", updatedAt: "2026-08-21T00:00:00Z",
};
const reviewItems = reviewsToFeedbackItems([review], "p1:ios");
check(reviewItems[0].source === "review" && reviewItems[0].productId === "p1:ios", "reviewsToFeedbackItems 携带 productId");

const merged = mergeFeedbackItems(
  [{ ...normalized, sourceId: "12" }, { ...reviewItems[0] }],
  [{ ...normalized, sourceId: "12", state: "closed" }, { ...normalized, sourceId: "13" }],
);
check(merged.length === 3, "merge 按 source+sourceId 去重");
check(merged[0].sourceId === "r1", "merge 按 createdAt 倒序（最新在前）");
check(merged.find((item) => item.sourceId === "12")?.state === "closed", "merge 重复条目取较新的状态");

async function runFetch() {
  const dir = setupRepo();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.includes("/issues?")) {
      return new Response(JSON.stringify([
        issue,
        { ...issue, number: 11, pull_request: { url: "https://api.github.com/repos/wxy/glowalk/pulls/11" } },
      ]), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as any;
  try {
    const issues = await fetchIssues(dir, "token-1");
    check(issues.length === 1 && issues[0].number === 12, "fetchIssues 过滤 PR");
  } catch (err: any) {
    check(false, `fetchIssues 异常: ${err.message}`);
  } finally {
    globalThis.fetch = originalFetch;
    if (errors) process.exit(1);
  }
}
void runFetch();
