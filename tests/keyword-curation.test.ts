import assert from "node:assert/strict";
import { parseKeywordCuration } from "../src/engine/ai/keyword-suggester";

console.log("✅ PASS: parseKeywordCuration reads removals and adds");
const c1 = parseKeywordCuration(
  '{"removals":[{"keyword":"torch","reason":"持续未进榜"}],"adds":[{"keyword":"night walk","rationale":"夜间场景","language":"en"}]}',
);
assert.equal(c1.removals.length, 1);
assert.equal(c1.removals[0].keyword, "torch");
assert.equal(c1.adds[0].keyword, "night walk");

console.log("✅ PASS: parseKeywordCuration unwraps markdown fences");
const c2 = parseKeywordCuration(
  '```json\n{"removals":[{"keyword":"a","reason":"r"}],"adds":[]}\n```',
);
assert.equal(c2.removals[0].keyword, "a");

console.log("✅ PASS: parseKeywordCuration caps removals at 20 and adds at 30");
const removals = Array.from({ length: 30 }, (_, i) => `{"keyword":"k${i}","reason":"r"}`).join(",");
const adds = Array.from({ length: 40 }, (_, i) => `{"keyword":"a${i}","rationale":"r"}`).join(",");
const c3 = parseKeywordCuration(`{"removals":[${removals}],"adds":[${adds}]}`);
assert.equal(c3.removals.length, 20);
assert.equal(c3.adds.length, 30);

console.log("✅ PASS: parseKeywordCuration tolerates missing fields");
assert.deepEqual(parseKeywordCuration("{}"), { removals: [], adds: [] });

console.log("🎉 All keyword-curation tests passed!");
