import assert from "node:assert/strict";
import { parseSubmissionCandidates } from "../src/engine/ai/keyword-suggester";

console.log("✅ PASS: parseSubmissionCandidates reads candidates with source");
const c1 = parseSubmissionCandidates(
  '{"candidates":[{"keyword":"cost tracker","source":"name","rationale":"r"},{"keyword":"budget alert","source":"subtitle","rationale":"r"}]}',
);
assert.equal(c1.length, 2);
assert.equal(c1[0].source, "name");
assert.equal(c1[1].source, "subtitle");

console.log("✅ PASS: parseSubmissionCandidates unwraps fences and defaults source to name");
const c2 = parseSubmissionCandidates(
  '```json\n{"candidates":[{"keyword":"tracking","source":"subtitle","rationale":"r"},{"keyword":"other","rationale":"r"}]}\n```',
);
assert.equal(c2[0].source, "subtitle");
assert.equal(c2[1].source, "name");

console.log("✅ PASS: parseSubmissionCandidates caps at 20 and tolerates missing");
const many = Array.from({ length: 30 }, (_, i) => `{"keyword":"k${i}","source":"name","rationale":"r"}`).join(",");
assert.equal(parseSubmissionCandidates(`{"candidates":[${many}]}`).length, 20);
assert.deepEqual(parseSubmissionCandidates("{}"), []);

console.log("🎉 All submission-candidates tests passed!");
