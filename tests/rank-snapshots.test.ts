import assert from "node:assert/strict";
import { appendRankSnapshots, RANK_SNAPSHOT_MAX_PER_KEY } from "../src/engine/rank-snapshots";

const base = { keyword: "night walk", language: "en", storefront: "us", totalResults: 200 };
const now = Date.now();
const snap = (offsetMs: number, rank: number | null, checkedAt = new Date(now - offsetMs).toISOString()) => ({
  ...base,
  rank,
  checkedAt,
});

console.log("✅ PASS: appendRankSnapshots dedupes by exact key (incoming wins)");
const merged = appendRankSnapshots([snap(1000, 5)], [snap(1000, 3)]);
assert.equal(merged.length, 1);
assert.equal(merged[0].rank, 3);

console.log("✅ PASS: appendRankSnapshots keeps only the newest per key");
const capped = appendRankSnapshots(
  Array.from({ length: RANK_SNAPSHOT_MAX_PER_KEY + 20 }, (_, i) => snap(i * 1000, i)),
  [],
);
assert.equal(capped.length, RANK_SNAPSHOT_MAX_PER_KEY);

console.log("✅ PASS: appendRankSnapshots drops snapshots outside the 90-day window");
const old = appendRankSnapshots([snap(91 * 24 * 60 * 60 * 1000, 2)], [snap(1000, 4)]);
assert.deepEqual(old.map((s) => s.rank), [4]);

console.log("🎉 All rank-snapshots tests passed!");
