import assert from "node:assert/strict";
import {
  buildCellIndex,
  matrixCellState,
  matrixColumnMeta,
  matrixFilterKeywords,
  matrixRowGroups,
  trackingLanguageOptions,
  STALE_MS,
} from "../src/renderer/lib/matrix";

console.log("✅ PASS: trackingLanguageOptions excludes en (global card) and sorts by zh-CN pinyin");
const opts = trackingLanguageOptions([
  { code: "zh-Hans", name: "简体中文" },
  { code: "de", name: "德文" },
  { code: "en", name: "英文" },
]);
// en 是全局卡（英文关键词 × 全部商店），不再作为本地语言选项；其余按汉语拼音音序排列（德 dé < 简 jiǎn）。
assert.deepEqual(opts, [
  { code: "de", label: "德文" },
  { code: "zh-Hans", label: "简体中文" },
]);
assert.deepEqual(trackingLanguageOptions([{ code: "zh-Hans", name: "简体中文" }]), [
  { code: "zh-Hans", label: "简体中文" },
]);

console.log("✅ PASS: matrixFilterKeywords returns only the view language (en lives in the global card)");
const filtered = matrixFilterKeywords(
  [
    { language: "zh-Hans" },
    { language: "en" },
    { language: "ja" },
  ],
  "zh-Hans",
);
assert.deepEqual(filtered, [{ language: "zh-Hans" }]);
// 全局卡（en）只含 en 词，不再混入其他语言。
assert.deepEqual(
  matrixFilterKeywords([{ language: "zh-Hans" }, { language: "en" }], "en"),
  [{ language: "en" }],
);

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

console.log("✅ PASS: buildCellIndex O(1) lookup matches matrixCellState");
const indexSnapshots = [
  { keyword: "night walk", storefront: "us", rank: 5, totalResults: 200, checkedAt: "2026-08-18T10:00:00.000Z" },
  { keyword: "night walk", storefront: "us", rank: 3, totalResults: 200, checkedAt: "2026-08-19T10:00:00.000Z" },
  { keyword: "night walk", storefront: "cn", rank: 40, totalResults: 200, checkedAt: "2026-08-19T10:00:00.000Z" },
];
const index = buildCellIndex(indexSnapshots);
const indexed = index("night walk", "us");
assert.equal(indexed.rank, 3, "index returns latest rank");
assert.equal(indexed.delta, 2, "index keeps delta vs previous");
assert.equal(indexed.trend, "up");
assert.equal(index("night walk", "gb").rank, null, "missing cell falls back to empty");
assert.deepEqual(index("night walk", "us"), matrixCellState(indexSnapshots, "night walk", "us"), "index agrees with matrixCellState");

console.log("✅ PASS: matrixRowGroups splits ranked (best first) and unranked");
const groups = matrixRowGroups(
  [{ keyword: "deep link" }, { keyword: "记账" }, { keyword: "night walk" }],
  [{ storefront: "us" }, { storefront: "cn" }],
  buildCellIndex([
    { keyword: "night walk", storefront: "us", rank: 5, totalResults: 200, checkedAt: "2026-08-19T10:00:00.000Z" },
    { keyword: "记账", storefront: "cn", rank: 2, totalResults: 200, checkedAt: "2026-08-19T10:00:00.000Z" },
    { keyword: "deep link", storefront: "us", rank: null, totalResults: 200, checkedAt: "2026-08-19T10:00:00.000Z" },
  ]),
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
