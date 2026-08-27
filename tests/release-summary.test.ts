/**
 * Release change summary tests — one row per PR (title + commit count) plus
 * a single aggregated row for commits without a PR.
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
    { sha: "111", subject: "feat: night mode (#23)", body: "", date: "2026-08-01T00:00:00.000Z" },
    { sha: "222", subject: "fix: map loading (#22)", body: "", date: "2026-08-02T00:00:00.000Z" },
    { sha: "333", subject: "feat(ios): offline tracks (#24)", body: "", date: "2026-08-03T00:00:00.000Z" },
    { sha: "444", subject: "perf: faster startup (#21)", body: "", date: "2026-08-04T00:00:00.000Z" },
    { sha: "555", subject: "docs: update readme", body: "", date: "2026-08-05T00:00:00.000Z" },
    { sha: "666", subject: "chore: bump version", body: "", date: "2026-08-06T00:00:00.000Z" },
  ],
};

const items = summarizeChanges(material as any);
assert(items.length === 5, "summarize: 4 PR rows + 1 aggregated row");
assert(items[0].type === "feature" && items[0].title === "night mode", "summarize: feat mapped and stripped");
assert(items[1].type === "feature" && items[1].title === "offline tracks", "summarize: feat(scope) stripped");
assert(items[2].type === "fix" && items[2].title === "map loading", "summarize: fix mapped");
assert(items[3].type === "perf" && items[3].title === "faster startup", "summarize: perf mapped");
assert(items[0].github === true && items[0].prNumber === 23, "summarize: PR row flagged");
assert(items[0].refs.includes("#23"), "summarize: PR ref recorded");
assert(items[0].commitCount === 1 && items[0].commits[0].date === "2026-08-01T00:00:00.000Z", "summarize: commit count + detail carried");

const standalone = items.find((item) => item.standalone);
assert(Boolean(standalone), "summarize: standalone aggregated row exists");
assert(standalone?.title === "未形成 PR 的提交", "summarize: standalone title");
assert(standalone?.commitCount === 2, "summarize: standalone counts commits without a PR");
assert(standalone?.commits.length === 2, "summarize: standalone keeps commits for AI material");
assert(standalone?.refs.length === 0 && !standalone?.github, "summarize: standalone has no PR ref");

// PR aggregation: two commits of the same PR become one item.
const aggregated = summarizeChanges({
  commits: [
    { sha: "aaa", subject: "feat: dark mode (#30)", body: "", date: "2026-08-07T00:00:00.000Z" },
    { sha: "bbb", subject: "fix: dark mode contrast (#30)", body: "", date: "2026-08-08T00:00:00.000Z" },
  ],
} as any);
assert(aggregated.length === 1, "aggregate: same PR merged into one item");
assert(aggregated[0].refs.includes("#30"), "aggregate: PR ref merged");
assert(aggregated[0].commits.length === 2 && aggregated[0].commitCount === 2, "aggregate: both commits kept");

// Fetched PR list wins: API title + commit count; unlisted commits stay standalone.
const withPrList = summarizeChanges({
  commits: [
    { sha: "aaaaaaa1", subject: "feat: dark mode", body: "", date: "2026-08-07T00:00:00.000Z" },
    { sha: "bbbbbb2", subject: "chore: tidy", body: "", date: "2026-08-08T00:00:00.000Z" },
    { sha: "cccccc3", subject: "docs: readme", body: "", date: "2026-08-09T00:00:00.000Z" },
  ],
  pullRequests: [
    {
      number: 30,
      title: "Dark mode overhaul",
      url: "https://github.com/owner/repo/pull/30",
      commits: 4,
      mergedAt: "2026-08-08T00:00:00.000Z",
      commitShas: ["aaaaaaa1", "bbbbbb2"],
    },
  ],
} as any);
assert(withPrList.length === 2, "pr-list: PR row + standalone row");
assert(withPrList[0].title === "Dark mode overhaul", "pr-list: API title used");
assert(withPrList[0].commitCount === 4, "pr-list: API commit count used");
assert(withPrList[0].commits.length === 2, "pr-list: matched commits kept");
assert(withPrList[0].prUrl === "https://github.com/owner/repo/pull/30", "pr-list: PR URL kept");
assert(withPrList[1].commitCount === 1, "pr-list: remaining commit aggregated");

// Empty + cap.
assert(summarizeChanges(null).length === 0, "summarize: null material → empty");
const many = summarizeChanges({
  commits: Array.from({ length: 20 }, (_, i) => ({ sha: `s${i}`, subject: `feat: item ${i}`, body: "" })),
} as any);
assert(many.length === 1, "summarize: many non-PR commits collapse to one row");
assert(many[0].commitCount === 20, "summarize: collapse row counts all commits");

if (errors === 0) console.log("\nAll release-summary tests passed ✅");
else { console.error(`\n${errors} test(s) failed ❌`); process.exit(1); }
