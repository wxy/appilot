/**
 * Release change summary (rule grouping) tests
 * Run: npm test (tsx tests/release-summary.test.ts)
 */

import { summarizeChanges } from "../src/renderer/lib/release-summary";

let errors = 0;
function assert(condition: boolean, msg: string) {
  if (!condition) { console.error(`❌ FAIL: ${msg}`); errors++; }
  else { console.log(`✅ PASS: ${msg}`); }
}

const material = {
  commits: [
    { sha: "111", subject: "feat: night mode (#23)", body: "" },
    { sha: "222", subject: "fix: map loading (#22)", body: "" },
    { sha: "333", subject: "feat(ios): offline tracks (#24)", body: "" },
    { sha: "444", subject: "perf: faster startup (#21)", body: "" },
    { sha: "555", subject: "docs: update readme", body: "" },
    { sha: "666", subject: "chore: bump version", body: "" },
  ],
};

const items = summarizeChanges(material as any);
assert(items.length === 6, "summarize: one item per commit/PR");
assert(items[0].type === "feature" && items[0].title === "night mode", "summarize: feat mapped and stripped");
assert(items[1].type === "feature" && items[1].title === "offline tracks", "summarize: feat(scope) stripped");
assert(items[2].type === "fix" && items[2].title === "map loading", "summarize: fix mapped");
assert(items[3].type === "perf", "summarize: perf mapped");
assert(items[4].type === "chore" && items[4].title === "bump version", "summarize: chore mapped");
assert(items[5].type === "chore" && items[5].title === "update readme", "summarize: docs → chore");
assert(
  items.every((item, index) => index === 0 || TYPE_RANK(items[index - 1].type) <= TYPE_RANK(item.type)),
  "summarize: sorted feature → fix → perf → chore",
);
assert(items[0].refs.includes("#23") && items[0].refs.includes("111"), "summarize: PR ref + sha recorded");

// PR aggregation: two commits of the same PR become one item.
const aggregated = summarizeChanges({
  commits: [
    { sha: "aaa", subject: "feat: dark mode (#30)", body: "" },
    { sha: "bbb", subject: "fix: dark mode contrast (#30)", body: "" },
  ],
} as any);
assert(aggregated.length === 1, "aggregate: same PR merged into one item");
assert(aggregated[0].refs.includes("#30") && aggregated[0].refs.includes("aaa") && aggregated[0].refs.includes("bbb"), "aggregate: refs merged");

// Empty + cap.
assert(summarizeChanges(null).length === 0, "summarize: null material → empty");
const many = summarizeChanges({
  commits: Array.from({ length: 20 }, (_, i) => ({ sha: `s${i}`, subject: `feat: item ${i}`, body: "" })),
} as any);
assert(many.length === 12, "summarize: capped at 12");

function TYPE_RANK(type: string): number {
  return ["feature", "fix", "perf", "chore"].indexOf(type);
}

if (errors === 0) console.log("\nAll release-summary tests passed ✅");
else { console.error(`\n${errors} test(s) failed ❌`); process.exit(1); }
