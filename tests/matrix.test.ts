import assert from "node:assert/strict";
import {
  matrixCellState,
  matrixColumnMeta,
  matrixFilterKeywords,
  matrixRowGroups,
  trackingLanguageOptions,
  STALE_MS,
} from "../src/renderer/lib/matrix";

console.log("✅ PASS: trackingLanguageOptions puts en first and labels it 英文（全局）");
const opts = trackingLanguageOptions([
  { code: "zh-Hans", name: "简体中文" },
  { code: "en", name: "英文" },
]);
assert.deepEqual(opts, [
  { code: "en", label: "英文（全局）" },
  { code: "zh-Hans", label: "简体中文" },
]);
assert.deepEqual(trackingLanguageOptions([{ code: "zh-Hans", name: "简体中文" }]), [
  { code: "en", label: "英文（全局）" },
  { code: "zh-Hans", label: "简体中文" },
]);

console.log("✅ PASS: matrixFilterKeywords includes viewLang and global en");
const filtered = matrixFilterKeywords(
  [
    { language: "zh-Hans" },
    { language: "en" },
    { language: "ja" },
  ],
  "zh-Hans",
);
assert.deepEqual(filtered, [{ language: "zh-Hans" }, { language: "en" }]);

console.log("✅ PASS: matrixCellState reports rank, delta and beyond200");
const snap = [
  { keyword: "night walk", storefront: "us", rank: 5, totalResults: 200, checkedAt: "2026-08-18T10:00:00.000Z" },
  { keyword: "night walk", storefront: "us", rank: 3, totalResults: 200, checkedAt: "2026-08-19T10:00:00.000Z" },
  { keyword: "deep link", storefront: "us", rank: null, totalResults: 200, checkedAt: "2026-08-19T10:00:00.000Z" },
];
const cell = matrixCellState(snap, "night walk", "us");
assert.equal(cell.rank, 3);
assert.equal(cell.delta, 2); // 5 -> 3
assert.equal(cell.trend, "up");
assert.equal(cell.beyond200, false);
const lost = matrixCellState(snap, "deep link", "us");
assert.equal(lost.rank, null);
assert.equal(lost.beyond200, true);
const none = matrixCellState(snap, "记账", "us");
assert.equal(none.rank, null);
assert.equal(none.beyond200, false);

console.log("✅ PASS: matrixColumnMeta detects stale column");
const now = Date.now();
const metaFresh = matrixColumnMeta(
  [{ storefront: "us", checkedAt: new Date(now - STALE_MS / 2).toISOString() }],
  "us",
);
assert.equal(metaFresh.stale, false);
const staleTime = new Date(now - STALE_MS * 2).toISOString();
const metaStale = matrixColumnMeta([{ storefront: "us", checkedAt: staleTime }], "us");
assert.equal(metaStale.stale, true);
assert.equal(metaStale.lastCheckedAt, staleTime);

console.log("✅ PASS: matrixRowGroups splits ranked (best first) and unranked");
const groups = matrixRowGroups(
  [{ keyword: "deep link" }, { keyword: "记账" }, { keyword: "night walk" }],
  [{ storefront: "us" }, { storefront: "cn" }],
  [
    { keyword: "night walk", storefront: "us", rank: 5, totalResults: 200, checkedAt: "2026-08-19T10:00:00.000Z" },
    { keyword: "记账", storefront: "cn", rank: 2, totalResults: 200, checkedAt: "2026-08-19T10:00:00.000Z" },
    { keyword: "deep link", storefront: "us", rank: null, totalResults: 200, checkedAt: "2026-08-19T10:00:00.000Z" },
  ],
);
assert.deepEqual(
  groups.ranked.map((item) => item.row.keyword),
  ["记账", "night walk"],
  "ranked sorted by best rank ascending",
);
assert.equal(groups.ranked[0].bestRank, 2);
assert.deepEqual(
  groups.unranked.map((item) => item.keyword),
  ["deep link"],
  "unranked keeps no-rank keywords",
);

console.log("🎉 All matrix helper tests passed!");
