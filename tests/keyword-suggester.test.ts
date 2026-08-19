/**
 * ASO keyword generation parsing tests (pure, no AI call).
 */

import { parseKeywordGeneration } from "../src/engine/ai/keyword-suggester";

let errors = 0;
function assert(condition: boolean, msg: string) {
  if (!condition) { console.error(`❌ FAIL: ${msg}`); errors++; }
  else { console.log(`✅ PASS: ${msg}`); }
}

// 1. valid JSON with tracking (submission field is ignored)
const g1 = parseKeywordGeneration(
  '{"tracking":[{"keyword":"flashlight","rationale":"core use case"},{"keyword":"nightwalk","rationale":"search term"}],"submission":["flashlight","nightwalk","pedometer"]}',
);
assert(g1.tracking.length === 2, "parse: 2 tracking keywords");
assert(g1.tracking[0].keyword === "flashlight", "parse: tracking keyword");
assert(g1.tracking[0].rationale === "core use case", "parse: tracking rationale");
assert(g1.tracking[0].language === "en", "parse: defaults language to en");

// 2. markdown-fenced JSON is unwrapped
const g2 = parseKeywordGeneration(
  '```json\n{"tracking":[{"keyword":"foo","rationale":"bar"}],"submission":["foo"]}\n```',
);
assert(g2.tracking.length === 1, "parse: markdown fence unwrapped");

// 3. extra prose around JSON is tolerated
const g3 = parseKeywordGeneration(
  'Sure! Here you go:\n{"tracking":[],"submission":["kw"]}',
);
assert(g3.tracking.length === 0, "parse: ignores surrounding prose");

// 4. empty / missing fields → empty sets
const g4 = parseKeywordGeneration("{}");
assert(g4.tracking.length === 0, "parse: empty object");

// 5. cap at 30 tracking terms
const tracking = Array.from({ length: 40 }, (_, i) => `{"keyword":"kw${i}","rationale":""}`).join(",");
const g5 = parseKeywordGeneration(`{"tracking":[${tracking}]}`);
assert(g5.tracking.length === 30, "parse: caps at 30");

// 6. mixed local + English tracking keywords
const g6 = parseKeywordGeneration(
  '{"tracking":[{"language":"zh-Hans","keyword":"AI 成本追踪","translation":"AI 成本追踪","rationale":"本地词"},{"language":"en","keyword":"AI cost tracker","translation":"AI 成本追踪器","rationale":"English phrase"}],"submission":["成本追踪","AI","cost"]}',
  "zh-Hans",
);
assert(g6.tracking[0].language === "zh-Hans", "parse: keeps local language");
assert(g6.tracking[1].language === "en", "parse: keeps English language");
assert(g6.tracking[1].translation === "AI 成本追踪器", "parse: keeps translation when provided");

// 7. response with a submission field only yields tracking
const g7 = parseKeywordGeneration(
  '{"tracking":[{"keyword":"flashlight","rationale":"core use case"}],"submission":["flashlight","torch"]}',
);
assert(g7.tracking.length === 1, "parse: ignores submission field");
assert((g7 as any).submission === undefined, "parse: no submission in result");

console.log(`\n${errors === 0 ? "🎉 All keyword-suggester tests passed!" : `❌ ${errors} test(s) failed`}`);
process.exit(errors > 0 ? 1 : 0);
