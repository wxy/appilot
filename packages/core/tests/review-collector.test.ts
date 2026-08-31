import assert from "node:assert/strict";
import { fetchAllStorefrontReviews, parseReviewEntries } from "../src/review-collector";

let errors = 0;
function check(ok: boolean, msg: string) {
  if (ok) console.log(`✅ PASS: ${msg}`);
  else { console.error(`❌ FAIL: ${msg}`); errors++; }
}

const FEED = {
  feed: {
    entry: [
      // The first entry in an RSS review feed is the app itself (no im:rating).
      { id: { label: "app-self" }, title: { label: "GloWalk" }, content: { label: "Path of Light" } },
      { id: { label: "r1" }, "im:rating": { label: "5" }, title: { label: "Great" }, content: { label: "Love it" }, "im:version": { label: "1.1.0" }, author: { name: { label: "Alice" } }, updated: { label: "2026-08-20T10:00:00-07:00" } },
      { id: { label: "r2" }, "im:rating": { label: "1" }, title: { label: "Crash" }, content: { label: "Crashes on launch" }, "im:version": { label: "1.0.0" }, author: { name: { label: "Bob" } }, updated: { label: "2026-08-19T10:00:00-07:00" } },
    ],
  },
};

check((() => {
  const reviews = parseReviewEntries("6794170791", "us", FEED);
  return reviews.length === 2
    && reviews[0].rating === 5 && reviews[0].body === "Love it"
    && reviews[1].rating === 1 && reviews[1].country === "us"
    && reviews[0].id === "r1";
})(), "parseReviewEntries 过滤 app 条目并解析评分/正文/国家");

async function run() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.includes("/us/rss/")) return new Response(JSON.stringify(FEED), { status: 200 });
    if (url.includes("/cn/rss/")) return new Response(JSON.stringify({ feed: { entry: [] } }), { status: 200 });
    return new Response("not found", { status: 404 });
  }) as any;

  try {
    const { reviews, fetchedAt } = await fetchAllStorefrontReviews("6794170791", ["us", "cn"], ["r1"]);
    assert.ok(fetchedAt, "fetchedAt 存在");
    check(reviews.length === 1 && reviews[0].id === "r2", "增量拉取按 existingIds 去重（r1 已存在，只剩 r2）");
    const again = await fetchAllStorefrontReviews("6794170791", ["us"], ["r1", "r2"]);
    check(again.reviews.length === 0, "全部已存在时无新增");
  } catch (err: any) {
    check(false, `review-collector 异常: ${err.message}`);
  } finally {
    globalThis.fetch = originalFetch;
    if (errors) process.exit(1);
  }
}
void run();
