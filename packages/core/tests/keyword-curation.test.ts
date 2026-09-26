import assert from "node:assert/strict";
import { buildKeywordCurationEvidence, curateKeywords, parseKeywordCuration } from "../src/ai/keyword-suggester";
import type { AIProvider, ChatMessage } from "../src/ai/ai-provider";

console.log("✅ PASS: parseKeywordCuration reads removals and adds");
const c1 = parseKeywordCuration(
  '{"removals":[{"keyword":"torch","reason":"持续未进榜"}],"adds":[{"keyword":"night walk","rationale":"夜间场景","language":"en"}]}',
);
assert.equal(c1.removals.length, 1);
assert.equal(c1.removals[0].keyword, "torch");
assert.equal(c1.adds[0].keyword, "night walk");

console.log("✅ PASS: parseKeywordCuration unwraps markdown fences");
const c2 = parseKeywordCuration(
  '```json\n{"removals":[{"keyword":"a","reason":"r"}],"adds":[]}\n```',
);
assert.equal(c2.removals[0].keyword, "a");

console.log("✅ PASS: parseKeywordCuration caps removals at 20 and adds at 30");
const removals = Array.from({ length: 30 }, (_, i) => `{"keyword":"k${i}","reason":"r"}`).join(",");
const adds = Array.from({ length: 40 }, (_, i) => `{"keyword":"a${i}","rationale":"r"}`).join(",");
const c3 = parseKeywordCuration(`{"removals":[${removals}],"adds":[${adds}]}`);
assert.equal(c3.removals.length, 20);
assert.equal(c3.adds.length, 30);

console.log("✅ PASS: parseKeywordCuration tolerates missing fields");
assert.deepEqual(parseKeywordCuration("{}"), { removals: [], adds: [] });

const tracked = [
  { language: "en", keyword: "weak term", source: "ai", pendingPausePlatforms: ["ios"] },
  { language: "en", keyword: "unknown term", source: "submission" },
  { language: "de", keyword: "anderes wort", source: "ai" },
];
const iosEvidence = buildKeywordCurationEvidence(tracked, [
  { keyword: "weak term", language: "en", storefront: "us", rank: null, totalResults: 0, checkedAt: "2026-09-21T00:00:00Z" },
  { keyword: "weak term", language: "en", storefront: "us", rank: null, totalResults: 0, checkedAt: "2026-09-22T00:00:00Z" },
  { keyword: "anderes wort", language: "de", storefront: "de", rank: 12, totalResults: 100, checkedAt: "2026-09-22T00:00:00Z" },
], "en", "ios");
assert.equal(iosEvidence.length, 2);
assert.deepEqual(iosEvidence.map(({ keyword, checkCount, rankedCheckCount, pendingReview }) => ({ keyword, checkCount, rankedCheckCount, pendingReview })), [
  { keyword: "weak term", checkCount: 2, rankedCheckCount: 0, pendingReview: true },
  { keyword: "unknown term", checkCount: 0, rankedCheckCount: 0, pendingReview: false },
]);
const macEvidence = buildKeywordCurationEvidence(tracked, [
  { keyword: "weak term", language: "en", storefront: "us", rank: 7, totalResults: 100, checkedAt: "2026-09-22T00:00:00Z" },
], "en", "macos");
assert.equal(macEvidence[0].bestRank, 7);
assert.equal(macEvidence[0].pendingReview, false);
console.log("✅ PASS: curation evidence is scoped to product snapshots and platform review state");

let prompt = "";
void curateKeywords({
  chat: async (messages: ChatMessage[]) => {
    prompt = messages.map((message) => message.content).join("\n");
    return '{"removals":[],"adds":[]}';
  },
} as AIProvider, {
  name: "Test App",
  description: "A test product",
  language: "en",
  uiLanguage: "zh-Hans",
  existingKeywords: iosEvidence,
  collectionLoad: { dailyInstances: 376, referenceLine: 360, costPerKeyword: 12 },
  submissionKeywords: [],
  removedKeywords: [],
}).then(() => {
  assert.match(prompt, /376\/360; \+12 per keyword/);
  assert.match(prompt, /weak term\|unknown\|0\/2/);
  assert.match(prompt, /no\/few checks has unknown effectiveness/i);
  assert.match(prompt, /reference line is advisory/i);
  console.log("✅ PASS: high-load curation prompt requests evidence-based cleanup without blocking adds");
  console.log("🎉 All keyword-curation tests passed!");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
