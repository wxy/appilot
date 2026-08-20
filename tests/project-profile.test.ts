/**
 * Project profile tests
 * Run: npm test (tsx tests/project-profile.test.ts)
 */

import { buildProjectProfile, profileToPromptBlock } from "../src/engine/project-profile";

let errors = 0;
function assert(condition: boolean, msg: string) {
  if (!condition) { console.error(`❌ FAIL: ${msg}`); errors++; }
  else { console.log(`✅ PASS: ${msg}`); }
}

const input = {
  name: "GloWalk",
  subtitle: "Path of Light",
  platform: "ios",
  supportedLanguages: ["en", "zh-Hans", "de"],
  description: "Night walking companion app.",
  storeLinks: [
    { name: "GloWalk App Store", country: "美国" },
    { name: "GloWalk App Store", country: "中国大陆" },
  ],
  trackedKeywords: [
    { keyword: "old", status: "paused", bestRank: 1 },
    { keyword: "night walk", status: "active", bestRank: 3 },
    { keyword: "记账", status: "active", bestRank: null },
  ],
};

const profile = buildProjectProfile(input);
assert(profile.name === "GloWalk" && profile.subtitle === "Path of Light", "profile: identity fields");
assert(profile.languages.join(",") === "en,zh-Hans,de", "profile: languages");
assert(profile.storeNames.length === 1 && profile.storefrontLabels.length === 2, "profile: store dedupe");
assert(
  profile.trackedKeywords.join(",") === "night walk,记账",
  "profile: paused excluded, sorted by bestRank",
);

const block = profileToPromptBlock(profile);
assert(block.includes("App name: GloWalk"), "prompt block: name");
assert(block.includes("Description: Night walking companion app."), "prompt block: description");
assert(block.includes("Storefront regions: 美国, 中国大陆"), "prompt block: storefronts");
assert(block.includes("Tracked keywords (active, by best rank): night walk, 记账"), "prompt block: keywords");
assert(
  profileToPromptBlock(buildProjectProfile(input)) === block,
  "prompt block: deterministic across builds",
);

const empty = buildProjectProfile({ name: "X", supportedLanguages: [], description: "" });
assert(empty.trackedKeywords.length === 0 && empty.description === "", "profile: empty-safe");

if (errors === 0) console.log("\nAll project-profile tests passed ✅");
else { console.error(`\n${errors} test(s) failed ❌`); process.exit(1); }
