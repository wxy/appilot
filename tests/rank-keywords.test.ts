import assert from "node:assert/strict";
import {
  enrichKeywordFromSnapshots,
  evaluatePause,
  normalizeTrackedKeyword,
  PAUSE_CONSECUTIVE_MISSES,
} from "../src/engine/rank-keywords";

const snap = (storefront: string, rank: number | null, i: number) => ({
  keyword: "night walk",
  language: "en",
  storefront,
  rank,
  totalResults: 200,
  checkedAt: new Date(Date.now() - (100 - i) * 3600_000).toISOString(),
});

console.log("✅ PASS: normalizeTrackedKeyword fills defaults");
const normalized = normalizeTrackedKeyword({ language: "en", keyword: "night walk" });
assert.equal(normalized.status, "active");
assert.equal(normalized.source, "manual");
assert.ok(normalized.addedAt);

console.log("✅ PASS: enrichKeywordFromSnapshots computes bestRank and lastSeenAt");
const enriched = enrichKeywordFromSnapshots(normalized, [snap("us", 8, 1), snap("us", 3, 2), snap("us", null, 3)]);
assert.equal(enriched.bestRank, 3);
assert.ok(enriched.lastSeenAt);

console.log("✅ PASS: evaluatePause flags pending-pause after consecutive misses in every mature storefront");
const misses = Array.from({ length: PAUSE_CONSECUTIVE_MISSES }, (_, i) => snap("us", null, i));
const paused = evaluatePause({ ...normalized, status: "active" }, misses);
assert.equal(paused.status, "pending-pause");
assert.match(paused.pausedReason || "", /连续 10 次未在榜/);

const mixed = [...misses.slice(0, PAUSE_CONSECUTIVE_MISSES - 1), snap("us", 5, 99)];
assert.equal(evaluatePause({ ...normalized, status: "active" }, mixed).status, "active");
assert.equal(evaluatePause({ ...normalized, status: "active" }, [snap("us", null, 1)]).status, "active");

console.log("✅ PASS: evaluatePause only counts snapshots after `since` (review/resume baseline)");
const since = new Date(Date.parse(snap("us", null, 20).checkedAt));
assert.equal(
  evaluatePause({ ...normalized, status: "active" }, misses, undefined, since).status,
  "active",
  "misses before the review baseline are ignored",
);
const freshMisses = Array.from({ length: PAUSE_CONSECUTIVE_MISSES }, (_, i) =>
  snap("us", null, 30 + i),
);
assert.equal(
  evaluatePause({ ...normalized, status: "active" }, freshMisses, undefined, since).status,
  "pending-pause",
  "misses after the review baseline re-trigger pending-pause",
);

console.log("🎉 All rank-keywords tests passed!");
