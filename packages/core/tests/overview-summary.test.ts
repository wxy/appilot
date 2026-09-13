/**
 * Overview summary pure-function tests
 * Run: npm test (tsx tests/overview-summary.test.ts)
 */

import { computeRankMovers, buildBriefInput } from "../src/overview-summary";

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
  { keyword: "paused now", language: "en", storefront: "us", rank: 4, totalResults: 1, checkedAt: iso(1) },
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
    { keyword: "paused now", language: "en", status: "paused" },
  ],
  removedKeywords: [{ keyword: "old removed", language: "en", removedAt: iso(5) }],
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
assert(input.keywordStats.checked === 1, "buildBriefInput: null and ranked snapshots both count as completed checks");
assert(input.keywordStats.ranked === 1 && input.keywordStats.top10 === 1, "buildBriefInput: ranked/top10 from snapshots (night walk best #5 in window)");
assert(input.keywordInventory?.active[0]?.keyword === "night walk" && input.keywordInventory?.paused[0]?.keyword === "paused now", "buildBriefInput: active and paused keyword inventory");
assert(input.keywordInventory?.removed[0]?.keyword === "old removed", "buildBriefInput: removed keyword inventory");
assert(input.storefrontCoverage.find((item) => item.language === "en")?.storefronts.length === 27, "buildBriefInput: English query coverage exposes all storefronts");
assert(input.keywordRankDetails?.[0]?.rankedStorefronts === 1 && input.keywordRankDetails?.[0]?.bestRanks[0]?.rank === 12, "buildBriefInput: latest per-storefront rank detail");
assert(!input.rankMovers.some((m) => m.keyword === "paused now" || m.keyword === "记账"), "buildBriefInput: movers only include active tracked keywords");
assert(input.detectedIssues.some((issue) => issue.category === "ranking" && issue.target === "night walk"), "buildBriefInput: significant rank drop becomes a detected issue");
assert(input.detectedIssues.some((issue) => issue.category === "release" && issue.target === "v1.2.0"), "buildBriefInput: incomplete localization becomes a detected issue");
assert(input.release?.tag === "v1.2.0", "buildBriefInput: release tag");
assert(input.submissionKeywordCount === 2, "buildBriefInput: submission keyword count");

const contextual = buildBriefInput({
  projectName: "P", productName: "GloWalk", description: "d", platform: "ios",
  supportedLanguages: ["en"], trackedKeywords: [], rankSnapshots: [],
  releaseDraft: null, submissionDraft: null, submissionKeywords: [],
  competitorDeltas: [{ name: "Comp", change: "v1.0 → v1.1" }],
});
assert(contextual.competitorDeltas?.[0]?.name === "Comp", "buildBriefInput: competitor context is preserved");
assert(contextual.detectedIssues.some((issue) => issue.category === "data-quality" && issue.severity === "high"), "buildBriefInput: empty keyword coverage becomes a high severity issue");

const checkedButUnranked = buildBriefInput({
  projectName: "P", productName: "P", description: "", platform: "ios",
  supportedLanguages: ["en"],
  trackedKeywords: [{ keyword: "hard term", language: "en", status: "active" }],
  rankSnapshots: [{ keyword: "hard term", language: "en", storefront: "us", rank: null, checkedAt: iso(1) }],
  releaseDraft: null, submissionDraft: null, submissionKeywords: [],
});
assert(checkedButUnranked.keywordStats.checked === 1 && checkedButUnranked.keywordStats.ranked === 0, "buildBriefInput: distinguishes checked-but-unranked from missing collection");
assert(checkedButUnranked.detectedIssues.some((issue) => issue.id === "rank-visibility-empty"), "buildBriefInput: checked-but-unranked becomes a ranking issue");
assert(!checkedButUnranked.detectedIssues.some((issue) => issue.id === "rank-snapshots-empty"), "buildBriefInput: checked-but-unranked is not labeled a broken data pipeline");

if (errors === 0) console.log("\nAll overview-summary tests passed ✅");
else { console.error(`\n${errors} test(s) failed ❌`); process.exit(1); }
