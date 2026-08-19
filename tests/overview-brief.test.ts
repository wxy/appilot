/**
 * Overview AI brief engine tests
 * Run: npm test (tsx tests/overview-brief.test.ts)
 */

import {
  parseBriefSuggestions,
  briefSuggestionId,
  buildBriefMessages,
  generateOverviewBrief,
} from "../src/engine/ai/overview-brief";

let errors = 0;
function assert(condition: boolean, msg: string) {
  if (!condition) { console.error(`❌ FAIL: ${msg}`); errors++; }
  else { console.log(`✅ PASS: ${msg}`); }
}

// 1. parseBriefSuggestions
const raw = JSON.stringify({
  suggestions: [
    { title: "把 night walk 加入跟踪", reason: "美区 #5 → #12", action: "keywords", target: "night walk" },
    { title: "补齐英文文案", reason: "3/8 语言未完成", action: "release", target: null },
    { title: "坏条目", reason: "x", action: "bogus", target: "" },
    { title: "多余的第 4 条", reason: "x", action: "keywords", target: null },
  ],
});
const parsed = parseBriefSuggestions(raw);
assert(parsed.length === 3, "parse: caps at 3 suggestions");
assert(parsed[0].action === "keywords" && parsed[0].target === "night walk", "parse: fields preserved");
assert(parsed[1].action === "release", "parse: release action kept");
assert(parsed[2].action === "keywords", "parse: unknown action falls back to keywords");
assert(
  parseBriefSuggestions("```json\n" + raw + "\n```")[0].title === "把 night walk 加入跟踪",
  "parse: code fence tolerated",
);
assert(
  briefSuggestionId("a", "keywords", "b") === briefSuggestionId("a", "keywords", "b"),
  "parse: id is stable",
);

// 2. buildBriefMessages
const input: any = {
  name: "GloWalk",
  description: "Night walking app",
  platform: "ios",
  supportedLanguages: ["en", "zh-Hans"],
  keywordStats: { tracked: 10, ranked: 4, top10: 2, paused: 1 },
  rankMovers: [{ keyword: "night walk", language: "en", storefront: "us", previousRank: 5, currentRank: 12, delta: -7 }],
  release: { tag: "v1.2.0", languageProgress: 3, languageTotal: 8, masterConfirmed: true, batchConfirmed: false, storeStatus: "prepared" },
  submissionKeywordCount: 12,
  uiLanguage: "zh-Hans",
};
const messages = buildBriefMessages(input);
const joined = messages.map((m) => m.content).join("\n");
assert(joined.includes("GloWalk") && joined.includes("night walk") && joined.includes("v1.2.0"), "buildBriefMessages: context embedded");
assert(messages[0].role === "system", "buildBriefMessages: system prompt first");

// 3. generateOverviewBrief with a stub provider
void (async () => {
  let captured: any = null;
  const stubProvider: any = {
    chat: async (msgs: any, opts?: any) => {
      captured = { msgs, opts };
      return raw;
    },
  };
  const generated = await generateOverviewBrief(stubProvider, input);
  assert(generated.length === 3, "generate: returns parsed suggestions");
  assert(captured.opts.responseFormat === "json_object", "generate: requests json_object");
  assert(captured.opts.maxTokens === 4000, "generate: token cap 4000");

  if (errors === 0) console.log("\nAll overview-brief tests passed ✅");
  else { console.error(`\n${errors} test(s) failed ❌`); process.exit(1); }
})();
