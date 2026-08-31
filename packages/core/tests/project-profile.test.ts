/**
 * Project profile tests
 * Run: npm test (tsx tests/project-profile.test.ts)
 */

import {
  buildProjectProfile,
  profileToPromptBlock,
  archiveSystemPrompt,
} from "../src/project-profile";

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
  readme: "# GloWalk\n\nNight walking companion app.\n\nFull README body.",
  storeLinks: [
    { name: "GloWalk App Store", country: "美国" },
    { name: "GloWalk App Store", country: "中国大陆" },
  ],
  trackedKeywords: [
    { keyword: "old", status: "paused", bestRank: 1 },
    { keyword: "night walk", status: "active", bestRank: 3 },
    { keyword: "记账", status: "active", bestRank: null },
  ],
  releaseHistory: [
    { tag: "v1.1.0", name: "v1.1.0", summary: "Added offline maps.", publishedAt: "2026-07-01T00:00:00.000Z" },
    { tag: "v1.0.2", name: "v1.0.2", summary: "Bug fixes.", publishedAt: "2026-06-01T00:00:00.000Z" },
  ],
};

const profile = buildProjectProfile(input);
assert(profile.name === "GloWalk" && profile.subtitle === "Path of Light", "profile: identity fields");
assert(profile.languages.join(",") === "en,zh-Hans,de", "profile: languages");
assert(profile.storeNames.length === 1 && profile.storefrontLabels.length === 2, "profile: store dedupe");
assert(
  profile.trackedKeywords.join(",") === "night walk,记账",
  "profile: paused excluded, stable alphabetical order",
);

const block = profileToPromptBlock(profile);
assert(block.includes("App name: GloWalk"), "prompt block: name");
assert(block.includes("Description: Night walking companion app."), "prompt block: description");
assert(block.includes("Storefront regions: 美国, 中国大陆"), "prompt block: storefronts");
assert(block.includes("Tracked keywords (active): night walk, 记账"), "prompt block: keywords");
assert(block.includes("README (full):\n# GloWalk"), "prompt block: full readme");
assert(block.includes("- v1.1.0 [2026-07-01T00:00:00.000Z]: Added offline maps."), "prompt block: release history");
assert(
  profileToPromptBlock(buildProjectProfile(input)) === block,
  "prompt block: deterministic across builds",
);
assert(
  archiveSystemPrompt(profile) === archiveSystemPrompt(buildProjectProfile(input)),
  "archive: byte-stable across builds",
);
assert(archiveSystemPrompt(profile).startsWith("Appilot project archive"), "archive: shared header first");

const empty = buildProjectProfile({ name: "X", supportedLanguages: [], description: "", readme: "" });
assert(empty.trackedKeywords.length === 0 && empty.description === "", "profile: empty-safe");
assert(empty.readme === "" && empty.releaseHistory.length === 0, "profile: readme/history empty-safe");

if (errors === 0) console.log("\nAll project-profile tests passed ✅");
else { console.error(`\n${errors} test(s) failed ❌`); process.exit(1); }
