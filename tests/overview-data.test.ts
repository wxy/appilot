import {
  overviewRankRows,
  overviewTrendData,
} from "../src/renderer/components/overview/overviewData";
import {
  activityGridColumns,
  submissionDraftRows,
} from "../src/renderer/components/overview/overviewData";
import type { SubmissionDraftRow } from "../src/renderer/components/overview/overviewData";

let errors = 0;
function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    errors++;
  } else {
    console.log(`✅ PASS: ${msg}`);
  }
}

const snap = (
  keyword: string,
  storefront: string,
  rank: number | null,
  checkedAt: string,
) => ({ keyword, language: "en", storefront, rank, totalResults: 100, checkedAt });

async function runTests() {
  const hour = 3_600_000;
  const t = (agoHours: number) => new Date(Date.now() - agoHours * hour).toISOString();
  const snapshots = [
    snap("night", "us", 8, t(20)),
    snap("night", "us", 5, t(10)),
    snap("night", "cn", 12, t(9)),
    snap("walk", "us", 20, t(10)),
  ];
  const rows = overviewRankRows(
    [{ keyword: "night", language: "en" }, { keyword: "walk", language: "en" }],
    snapshots,
  );
  assert(rows.length === 2, "one row per keyword");
  const night = rows.find((row) => row.keyword === "night");
  assert(night?.bestRank === 5, "best rank across storefronts");
  assert(night?.storefront === "us", "best storefront recorded");
  assert(night?.trend === "up" && night?.delta === 3, "trend vs previous snapshot");
  assert(night?.stale === false, "fresh snapshot not stale");

  const { series, data } = overviewTrendData(rows, snapshots, 14);
  assert(series.length === 2, "series covers top keywords");
  assert(data.length >= 1, "chart data has daily points");
  const nightPoint = data[0]?.["en\u0000night"];
  assert(nightPoint === 5 || nightPoint === 8, "best rank per day recorded");

  const dropped = overviewRankRows([{ keyword: "walk", language: "en" }], []);
  assert(dropped.length === 0, "no snapshots → no rows");

  if (errors === 0) console.log("\n🎉 All overview-data tests passed!");
  else process.exitCode = 1;
}

void runTests();

// ── ② 文案行聚合（submissionDraftRows）──
function localDay(offsetDays: number): string {
  const d = new Date(Date.now() - offsetDays * 86_400_000);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
const isoOf = (offsetDays: number) => `${localDay(offsetDays)}T00:00:00.000Z`;

function draftRowTests() {
  const drafts = [
    {
      id: "p:v1.1.0",
      projectId: "p",
      releaseTag: "v1.1.0",
      appVersion: "1.1.0",
      updatedAt: isoOf(0),
      localizations: [{ language: "en" }, { language: "zh-Hans" }],
    },
    {
      id: "p:v1.0.0",
      projectId: "p",
      releaseTag: "v1.0.0",
      appVersion: "1.0.0",
      updatedAt: isoOf(30),
      localizations: [{ language: "en" }],
    },
    {
      // 无版本号草稿：label 回落 releaseTag。
      id: "p:scratch",
      projectId: "p",
      releaseTag: "scratch-v2",
      updatedAt: isoOf(60),
      localizations: [],
    },
  ];
  const rows = submissionDraftRows(drafts, {
    currentTag: "v1.1.0",
    publishedTags: ["1.0.0"], // 去前导 v：应命中 releaseTag v1.0.0。
  });
  assert(rows.length === 3, "drafts: one row per draft");
  assert(
    rows.map((r) => r.tag).join(",") === "v1.1.0,v1.0.0,scratch-v2",
    "drafts: sorted by updatedAt desc",
  );
  const current = rows.find((r) => r.tag === "v1.1.0");
  const published = rows.find((r) => r.tag === "v1.0.0");
  const scratch = rows.find((r) => r.tag === "scratch-v2");
  assert(current?.status === "current" && current?.label === "v1.1.0", "drafts: latest candidate → current + v label");
  assert(
    published?.status === "published" && published?.languageCount === 1,
    "drafts: published by v-normalized tag match, languageCount kept",
  );
  assert(scratch?.status === "draft" && scratch?.label === "scratch-v2", "drafts: unknown tag → draft, label falls back to tag");
  assert(rows[0].updatedAt === isoOf(0) && rows[2].updatedAt === isoOf(60), "drafts: updatedAt preserved");
  assert(submissionDraftRows(null, {})!.length === 0, "drafts: null → []");
  assert(submissionDraftRows([], {})!.length === 0, "drafts: [] → []");
  assert(submissionDraftRows(undefined, {})!.length === 0, "drafts: undefined → []");
  // 全部已发布、无候选：published 优先；无 ctx → 全部草案。
  const publishedOnly = submissionDraftRows(drafts, {
    publishedTags: ["v1.1.0", "v1.0.0", "scratch-v2"],
  });
  assert(
    publishedOnly.every((r: SubmissionDraftRow) => r.status === "published"),
    "drafts: all-published ctx",
  );
  assert(
    submissionDraftRows(drafts, null).every((r: SubmissionDraftRow) => r.status === "draft"),
    "drafts: no ctx → all draft",
  );
}

// ── ① 活跃格子图数据（activityGridColumns）──
function gridTests() {
  const commits: Record<string, number> = {};
  // 覆盖约 5 周（多个活跃日，含今天）→ 应判定为格子图（spanDays ≥ 28）。
  for (let offset = 35; offset >= 0; offset -= 2) {
    commits[localDay(offset)] = (commits[localDay(offset)] || 0) + 1;
  }
  commits[localDay(0)] = (commits[localDay(0)] || 0) + 1;
  const grid = activityGridColumns(commits, 6);
  assert(grid !== null, "grid: commits present → data");
  assert(
    grid!.columns.length === 6 && grid!.columns.every((c) => c.days.length === 7),
    "grid: 6 week-columns × 7 day rows",
  );
  assert(grid!.spanDays !== null && grid!.spanDays >= 28, "grid: span ≥ 4 weeks → grid mode");
  assert(grid!.total > 0, "grid: window total counted");
  const todayCount = grid!.columns[grid!.columns.length - 1].days.find(
    (d) => d.date === localDay(0),
  )?.count ?? 0;
  assert(todayCount >= 1, "grid: today cell carries count");

  // 只有近几天 → spanDays < 28（柱状图模式）。
  const recent = { [localDay(1)]: 3, [localDay(0)]: 5 };
  const recentGrid = activityGridColumns(recent, 6);
  assert(
    recentGrid !== null && recentGrid.spanDays !== null && recentGrid.spanDays < 28,
    "grid: recent-only → bars mode",
  );
  assert(activityGridColumns(undefined, 6) === null, "grid: undefined → null");
  assert(activityGridColumns({}, 6) === null, "grid: empty object → null");
  // 未来日期不计入、键带时间后缀容错。
  const edge = { [`${localDay(1)}T12:00:00`]: 2, [localDay(0)]: 1 };
  const edgeGrid = activityGridColumns(edge, 6);
  assert(edgeGrid !== null && edgeGrid.total === 3, "grid: tz-suffixed keys tolerated");
}

draftRowTests();
gridTests();

if (errors === 0) console.log("\n🎉 All overview-data tests passed!");
else process.exitCode = 1;
