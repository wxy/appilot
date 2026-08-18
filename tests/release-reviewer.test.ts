import assert from "node:assert/strict";
import { normalizeLocalizedStoreCopy } from "../src/engine/ai/release-reviewer";

console.log("✅ PASS: normalizeLocalizedStoreCopy clamps name/subtitle to 30 chars");
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
assert.equal(clamped.name.length, 30);
assert.equal(clamped.subtitle.length, 30);
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

console.log("🎉 All release-reviewer utility tests passed!");
