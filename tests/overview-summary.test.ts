/**
 * Overview summary pure-function tests
 * Run: npm test (tsx tests/overview-summary.test.ts)
 */

import { computeRankMovers, buildBriefInput } from "../src/engine/overview-summary";

let errors = 0;
function assert(condition: boolean, msg: string) {
  if (!condition) { console.error(`❌ FAIL: ${msg}`); errors++; }
  else { console.log(`✅ PASS: ${msg}`); }
}

const now = Date.now();
const iso = (hoursAgo: number) => new Date(now - hoursAgo * 3600 * 1000).toISOString();
const snapshots = [
  { keyword: "night walk", language: "en", storefront: "us", rank: 5, totalResults: 1, checkedAt: iso(30) },
  { keyword: "night walk", language: "en", storefront: "us", rank: 12, totalResults: 1, checkedAt: iso(2) },
  { keyword: "记账", language: "zh-Hans", storefront: "hk", rank: null, totalResults: 1, checkedAt: iso(3) },
  { keyword: "记账", language: "zh-Hans", storefront: "hk", rank: 8, totalResults: 1, checkedAt: iso(1) },
  { keyword: "old", language: "en", storefront: "us", rank: 1, totalResults: 1, checkedAt: iso(20 * 24) },
];

const movers = computeRankMovers(snapshots as any);
const night = movers.find((m) => m.keyword === "night walk");
assert(night?.delta === -7, "computeRankMovers: drop delta is negative");
assert(night?.previousRank === 5 && night?.currentRank === 12, "computeRankMovers: prev/current ranks");
const note = movers.find((m) => m.keyword === "记账");
assert(note?.delta === null && note?.currentRank === 8, "computeRankMovers: new entry has null delta");
assert(!movers.some((m) => m.keyword === "old"), "computeRankMovers: outside window excluded");

const input = buildBriefInput({
  projectName: "GloWalk",
  productName: "GloWalk",
  description: "Night walking app",
  platform: "ios",
  supportedLanguages: ["en", "zh-Hans"],
  trackedKeywords: [
    { keyword: "night walk", language: "en", status: "active" },
    { keyword: "old", language: "en", status: "paused" },
  ],
  rankSnapshots: snapshots as any,
  releaseDraft: { name: "v1.2.0", tag: "v1.2.0" },
  submissionDraft: {
    localizations: [{ language: "en", name: "GloWalk", subtitle: "", promotionalText: "", description: "", whatsNew: "", keywords: "" }],
    storeStatus: "prepared",
  },
  submissionKeywords: [{ language: "en", text: "night walk, walk" }],
});
assert(input.name === "GloWalk", "buildBriefInput: name");
assert(input.keywordStats.tracked === 1 && input.keywordStats.paused === 1, "buildBriefInput: keyword stats");
assert(input.keywordStats.ranked === 1 && input.keywordStats.top10 === 1, "buildBriefInput: ranked/top10 from snapshots (night walk best #5 in window)");
assert(input.release?.tag === "v1.2.0", "buildBriefInput: release tag");
assert(input.submissionKeywordCount === 2, "buildBriefInput: submission keyword count");

const themed = buildBriefInput({
  projectName: "P", productName: "GloWalk", description: "d", platform: "ios",
  supportedLanguages: ["en"], trackedKeywords: [], rankSnapshots: [],
  releaseDraft: null, submissionDraft: null, submissionKeywords: [],
  feedbackThemes: [{ title: "夜间模式", evidenceCount: 3, topQuotes: ["太亮了"] }],
  competitorDeltas: [{ name: "Comp", change: "v1.0 → v1.1" }],
});
assert(themed.feedbackThemes?.length === 1 && themed.competitorDeltas?.[0]?.name === "Comp", "buildBriefInput: 反馈主题与竞品动态透传");

if (errors === 0) console.log("\nAll overview-summary tests passed ✅");
else { console.error(`\n${errors} test(s) failed ❌`); process.exit(1); }
