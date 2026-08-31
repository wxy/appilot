import assert from "node:assert/strict";
import { normalizeLocalizedStoreCopy, validateTranslatedCopy } from "../src/ai/release-reviewer";

console.log("✅ PASS: normalizeLocalizedStoreCopy clamps fields to limits");
const clamped = normalizeLocalizedStoreCopy(
  {
    name: "GloWalk: Path of Light with Extra Padding That Pushes Past Thirty",
    subtitle: "A Very Long Subtitle That Definitely Exceeds Thirty Characters",
    promotionalText: "p".repeat(200),
    description: "App description",
    whatsNew: "Fixed a bug",
    keywords: "k".repeat(150),
  },
  "en",
);
// 智能截断：长度不超过上限，且在单词/句子边界结束，而不是中间切断。
assert.ok(clamped.name.length <= 30, "name within limit");
assert.ok(clamped.subtitle.length <= 30, "subtitle within limit");
assert.ok(!clamped.name.endsWith("Ex"), "name not cut mid-word");
assert.equal(clamped.promotionalText.length, 170);
assert.equal(clamped.keywords.length, 100);
assert.equal(clamped.description, "App description");

console.log("✅ PASS: normalizeLocalizedStoreCopy prefixes promotional text with '> '");
const quoted = normalizeLocalizedStoreCopy({ promotionalText: "Track AI costs" }, "en");
assert.equal(quoted.promotionalText, "> Track AI costs");
const alreadyQuoted = normalizeLocalizedStoreCopy({ promotionalText: "> Track AI costs" }, "en");
assert.equal(alreadyQuoted.promotionalText, "> Track AI costs");

console.log("✅ PASS: normalizeLocalizedStoreCopy falls back to the brand name");
const fallback = normalizeLocalizedStoreCopy({ subtitle: "tagline" }, "zh-Hans", "GloWalk");
assert.equal(fallback.name, "GloWalk");
assert.equal(fallback.subtitle, "tagline");
assert.equal(fallback.language, "zh-Hans");

console.log("✅ PASS: normalizeLocalizedStoreCopy tolerates missing fields");
const empty = normalizeLocalizedStoreCopy({}, "en");
assert.equal(empty.name, "");
assert.equal(empty.subtitle, "");
assert.equal(empty.description, "");
assert.equal(empty.promotionalText, "");

console.log("✅ PASS: validateTranslatedCopy rejects source-language echo (Russian ← Chinese)");
const zhSource = normalizeLocalizedStoreCopy(
  { name: "GloWalk: 智能夜行手电", keywords: "手电筒,闪光灯", description: "夜间步行安全" },
  "zh-Hans",
);
const echoed = normalizeLocalizedStoreCopy(
  { name: "GloWalk: 智能夜行手电", keywords: "手电筒,闪光灯", description: "夜间步行安全" },
  "ru",
);
assert.throws(() => validateTranslatedCopy(echoed, "ru", zhSource), "echo rejected");

console.log("✅ PASS: validateTranslatedCopy accepts real Russian");
const realRu = normalizeLocalizedStoreCopy(
  {
    name: "GloWalk: Умный ночной фонарь",
    keywords: "фонарик,ночная прогулка",
    description: "Безопасная ходьба ночью",
  },
  "ru",
);
validateTranslatedCopy(realRu, "ru", zhSource); // 不应抛

console.log("🎉 All release-reviewer utility tests passed!");
