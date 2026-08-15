/**
 * ASO keyword generation parsing tests (pure, no AI call).
 */

import { parseKeywordGeneration } from "../src/engine/ai/keyword-suggester";

let errors = 0;
function assert(condition: boolean, msg: string) {
  if (!condition) { console.error(`❌ FAIL: ${msg}`); errors++; }
  else { console.log(`✅ PASS: ${msg}`); }
}

// 1. valid JSON with tracking + submission
const g1 = parseKeywordGeneration(
  '{"tracking":[{"keyword":"flashlight","rationale":"core use case"},{"keyword":"nightwalk","rationale":"search term"}],"submission":["flashlight","nightwalk","pedometer"]}',
);
assert(g1.tracking.length === 2, "parse: 2 tracking keywords");
assert(g1.tracking[0].keyword === "flashlight", "parse: tracking keyword");
assert(g1.tracking[0].rationale === "core use case", "parse: tracking rationale");
assert(g1.tracking[0].language === "en", "parse: defaults language to en");
assert(g1.submission.join(",") === "flashlight,nightwalk,pedometer", "parse: submission list");

// 2. markdown-fenced JSON is unwrapped
const g2 = parseKeywordGeneration(
  '```json\n{"tracking":[{"keyword":"foo","rationale":"bar"}],"submission":["foo"]}\n```',
);
assert(g2.tracking.length === 1 && g2.submission[0] === "foo", "parse: markdown fence unwrapped");

// 3. extra prose around JSON is tolerated
const g3 = parseKeywordGeneration(
  'Sure! Here you go:\n{"tracking":[],"submission":["kw"]}',
);
assert(g3.submission[0] === "kw", "parse: ignores surrounding prose");

// 4. empty / missing fields → empty sets
const g4 = parseKeywordGeneration("{}");
assert(g4.tracking.length === 0 && g4.submission.length === 0, "parse: empty object");

// 5. cap at 30 tracking and 30 submission terms
const tracking = Array.from({ length: 40 }, (_, i) => `{"keyword":"kw${i}","rationale":""}`).join(",");
const submission = Array.from({ length: 40 }, (_, i) => `"s${i}"`).join(",");
const g5 = parseKeywordGeneration(`{"tracking":[${tracking}],"submission":[${submission}]}`);
assert(g5.tracking.length === 30 && g5.submission.length === 30, "parse: caps at 30");

// 6. mixed local + English tracking keywords
const g6 = parseKeywordGeneration(
  '{"tracking":[{"language":"zh-Hans","keyword":"AI 成本追踪","rationale":"本地词"},{"language":"en","keyword":"AI cost tracker","rationale":"English phrase"}],"submission":["成本追踪","AI","cost"]}',
  "zh-Hans",
);
assert(g6.tracking[0].language === "zh-Hans", "parse: keeps local language");
assert(g6.tracking[1].language === "en", "parse: keeps English language");

console.log(`\n${errors === 0 ? "🎉 All keyword-suggester tests passed!" : `❌ ${errors} test(s) failed`}`);
process.exit(errors > 0 ? 1 : 0);
