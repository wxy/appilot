import {
  buildThemeMessages,
  normalizeReviewThemes,
  parseReviewThemes,
} from "../src/engine/ai/review-insights";

let errors = 0;
function check(ok: boolean, msg: string) {
  if (ok) console.log(`✅ PASS: ${msg}`);
  else { console.error(`❌ FAIL: ${msg}`); errors++; }
}

const raw = JSON.stringify({
  themes: [
    {
      title: "用户想要夜间模式",
      evidenceCount: 3,
      sampleQuotes: ["希望加夜间模式", "太亮了"],
      suggestedKeywords: ["night mode", "dark mode"],
      suggestedDescriptionAngles: ["夜间使用友好"],
      sourceBreakdown: { reviews: 2, issues: 1 },
    },
    { title: "", evidenceCount: 0, sampleQuotes: [], suggestedKeywords: [], suggestedDescriptionAngles: [], sourceBreakdown: { reviews: 0, issues: 0 } },
  ],
});

const parsed = parseReviewThemes(raw);
check(parsed.length === 1, "parse: 空主题被剔除");
check(parsed[0].title === "用户想要夜间模式" && parsed[0].evidenceCount === 3, "parse: 字段保留");
check(parsed[0].suggestedKeywords[0] === "night mode", "parse: 关键词数组保留");
check(parseReviewThemes("```json\n" + raw + "\n```")[0].evidenceCount === 3, "parse: 容忍代码围栏");
check(normalizeReviewThemes(null)?.length === 0, "normalize: null 输入为空数组");

const messages = buildThemeMessages(undefined, [
  { source: "issue", sourceId: "1", productId: null, title: "t", body: "b", state: "open", url: "", author: "a", createdAt: "2026-08-20T00:00:00Z" },
]);
const joined = messages.map((m) => m.content).join("\n");
check(messages[0].role === "system", "buildThemeMessages: 系统提示在前");
check(joined.includes("issue"), "buildThemeMessages: 任务数据嵌入");

if (errors) process.exit(1);
console.log("done");
