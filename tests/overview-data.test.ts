import {
  overviewRankRows,
  overviewTrendData,
} from "../src/renderer/components/overview/overviewData";

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
