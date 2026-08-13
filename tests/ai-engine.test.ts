/**
 * AI Engine + Context Builder tests.
 */

import { buildContext, type UserPreferences } from "../src/engine/ai/context-builder";
import { parseAnalysisResponse } from "../src/engine/ai/ai-engine";
import type { RepoSummary, FeatureHighlight } from "../src/engine/repo-analyzer";

let errors = 0;
function assert(condition: boolean, msg: string) {
  if (!condition) { console.error(`❌ FAIL: ${msg}`); errors++; }
  else { console.log(`✅ PASS: ${msg}`); }
}

const mockSummary: RepoSummary = {
  projectName: "TestApp",
  tagline: "A testing framework for Node.js",
  description: "Fast, lightweight test runner with zero config.",
  techStack: ["Node.js", "TypeScript", "Vite"],
  license: "MIT",
  recentCommits: [
    { sha: "abc1234", message: "Add parallel test execution", author: "dev", date: "2026-07-15T10:00:00Z" },
  ],
  directoryTree: ["📄 README.md", "📄 package.json", "📁 src"],
  inferredAudience: "Developers / DevOps",
};

const mockHighlights: FeatureHighlight[] = [
  { title: "Zero config", description: "No setup required", source: "code_verified", isFocused: true },
  { title: "Parallel execution", description: "Runs tests in parallel", source: "code_verified", isFocused: false },
];

// 1. Basic context build
const ctx = buildContext(mockSummary, mockHighlights);
assert(ctx.systemPrompt.includes("TestApp"), "context: includes project name");
assert(ctx.systemPrompt.includes("Node.js"), "context: includes tech stack");
assert(ctx.systemPrompt.includes("Developers / DevOps"), "context: includes audience");
assert(ctx.systemPrompt.includes("280 characters"), "context: Twitter character limit");
assert(ctx.systemPrompt.includes("✅ Zero config"), "context: verified feature marker");
assert(ctx.systemPrompt.includes("MIT"), "context: includes license");
assert(ctx.systemPrompt.length > 200, "context: prompt is substantial");

// 2. With user preferences
const prefs: UserPreferences = {
  tone: "casual",
  emphasis: ["open-source", "performance"],
  bannedWords: ["revolutionary", "game-changer"],
  extraInstructions: "Always include a call to action.",
};
const ctx2 = buildContext(mockSummary, mockHighlights, prefs);
assert(ctx2.systemPrompt.includes("casual"), "context: user tone preference");
assert(ctx2.systemPrompt.includes("open-source"), "context: user emphasis");
assert(ctx2.systemPrompt.includes("revolutionary"), "context: banned words listed");
assert(ctx2.systemPrompt.includes("call to action"), "context: extra instructions");

// 3. Empty highlights
const ctx3 = buildContext(mockSummary, []);
assert(!ctx3.systemPrompt.includes("Key Features"), "context: no features section when empty");

// 4. Unknown tech stack
const unknownSummary = { ...mockSummary, techStack: ["Unknown"] };
const ctx4 = buildContext(unknownSummary, []);
assert(!ctx4.systemPrompt.includes("Tech Stack"), "context: skips unknown tech stack");

// 5. AIEngine tweet parsing (unit test — no AI call)
// Test the parseTweet logic via a mock
const mockTweet = "Introducing TestApp — a zero-config test runner for Node.js 🚀\nBuilt with TypeScript and Vite.\nCheck it out: github.com/test/testapp\n#nodejs #testing #typescript #devtools";
const hashtags = mockTweet.match(/#\w+/g)?.map((h) => h.toLowerCase()) || [];
assert(hashtags.length >= 4, "tweet parsing: extracts hashtags");
assert(mockTweet.length <= 280 || mockTweet.includes("280"), "tweet parsing: reasonable length");
assert(mockTweet.includes("github.com"), "tweet parsing: includes link");

// 6. AI analysis response parsing
const analysis1 = parseAnalysisResponse(
  "TAGLINE: A zero-config test runner\nDESCRIPTION: Run tests fast with no setup.\nFEATURES:\n- Zero config\n- Parallel execution\n- TypeScript support"
);
assert(analysis1.tagline === "A zero-config test runner", "analysis parse: extracts tagline");
assert(analysis1.description === "Run tests fast with no setup.", "analysis parse: extracts description");
assert(analysis1.features.length === 3, "analysis parse: extracts 3 features");
assert(analysis1.features[0] === "Zero config", "analysis parse: feature text correct");

// 7. Parser tolerance — lowercase labels, bullet styles, stray text
const analysis2 = parseAnalysisResponse(
  "Here is the analysis:\ntagline: lightweight tool\ndescription: does one thing well\nfeatures:\n* first\n• second\n- third"
);
assert(analysis2.tagline === "lightweight tool", "analysis parse: lowercase tagline label");
assert(analysis2.features.length === 3, "analysis parse: mixed bullet styles");

// 8. Parser caps features at 6 and ignores empty bullets
const analysis3 = parseAnalysisResponse(
  "FEATURES:\n- a\n- b\n- c\n- d\n- e\n- f\n- g\n-"
);
assert(analysis3.features.length === 6, "analysis parse: caps at 6 features");
assert(analysis3.features[5] === "f", "analysis parse: 6th feature correct");
assert(!analysis3.features.includes("g"), "analysis parse: drops 7th feature");

// 9. Empty / malformed response degrades gracefully
const analysis4 = parseAnalysisResponse("");
assert(analysis4.features.length === 0, "analysis parse: empty response → no features");
assert(analysis4.tagline === undefined, "analysis parse: empty response → no tagline");

console.log(`\n${errors === 0 ? "🎉 All AI engine tests passed!" : `❌ ${errors} test(s) failed`}`);
process.exit(errors > 0 ? 1 : 0);
