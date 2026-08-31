/**
 * AI request layer tests — cache-friendly archive message construction.
 * Run: npm test (tsx tests/ai-request.test.ts)
 */

import { buildArchiveMessages } from "../src/ai/ai-request";
import { buildProjectProfile } from "../src/project-profile";

let errors = 0;
function assert(condition: boolean, msg: string) {
  if (!condition) { console.error(`❌ FAIL: ${msg}`); errors++; }
  else { console.log(`✅ PASS: ${msg}`); }
}

const profile = buildProjectProfile({
  name: "GloWalk",
  subtitle: "Path of Light",
  platform: "ios",
  supportedLanguages: ["en", "zh-Hans"],
  description: "Night walking companion app.",
  readme: "# GloWalk\n\nFull README body.",
  storeLinks: [{ name: "GloWalk App Store", country: "美国" }],
  trackedKeywords: [
    { keyword: "night walk", status: "active" },
    { keyword: "记账", status: "active" },
  ],
  releaseHistory: [
    { tag: "v1.1.0", name: "v1.1.0", summary: "Added offline maps.", publishedAt: "2026-07-01T00:00:00.000Z" },
  ],
});

const taskSystem = "You are the task runner. Output JSON.";
const taskLines = ["Target: en", "UI language: zh-Hans"];
const fallbackLines = ["App name: GloWalk", "Platform: ios"];

const withProfile = buildArchiveMessages(profile, taskSystem, taskLines, fallbackLines);
const withoutProfile = buildArchiveMessages(undefined, taskSystem, taskLines, fallbackLines);

assert(withProfile.length === 2, "archive: system + user messages");
assert(withProfile[0].role === "system" && withProfile[1].role === "user", "archive: roles");
assert(
  withProfile[0].content.startsWith("Appilot project archive") &&
    withProfile[0].content.includes("App name: GloWalk") &&
    withProfile[0].content.includes("README (full):"),
  "archive: stable block is the system prefix",
);
assert(withProfile[0].content.includes(taskSystem), "archive: task instructions appended after archive");
assert(
  !withProfile[1].content.includes("README (full):") &&
    withProfile[1].content.includes("Target: en"),
  "archive: volatile task data stays in the user message only",
);
assert(
  buildArchiveMessages(profile, taskSystem, taskLines, fallbackLines)[0].content ===
    withProfile[0].content,
  "archive: same profile yields byte-identical prefix",
);
assert(
  buildArchiveMessages(
    profile,
    "Different task instructions.",
    taskLines,
    fallbackLines,
  )[0].content.startsWith(withProfile[0].content.slice(0, 64)),
  "archive: prefix shared even when task instructions differ",
);
assert(
  withoutProfile[0].content === taskSystem &&
    !withoutProfile[0].content.includes("App name: GloWalk"),
  "no profile: system is task instructions only",
);
assert(
  withoutProfile[1].content.includes("App name: GloWalk") &&
    withoutProfile[1].content.includes("Target: en"),
  "no profile: fallback identity + task lines in user message",
);

if (errors > 0) {
  console.error(`\n❌ ${errors} ai-request test(s) failed`);
  process.exit(1);
}
console.log("\nAll ai-request tests passed ✅");
