import { buildTrendSeries } from "../src/renderer/lib/trend-series";

let errors = 0;
function check(ok: boolean, msg: string) {
  if (ok) console.log(`✅ PASS: ${msg}`);
  else { console.error(`❌ FAIL: ${msg}`); errors++; }
}

const now = new Date("2026-08-24T00:00:00Z");
const traffic = [
  { date: "2026-08-22", views: 100, uniqueViews: 30, clones: 10, uniqueClones: 5, referrers: [], assetTag: "v1.1.0", assetDownloads: [{ name: "a.dmg", downloadCount: 42 }], source: "github-api" },
  { date: "2026-08-23", views: 150, uniqueViews: 40, clones: 12, uniqueClones: 6, referrers: [], source: "github-api" },
] as any;
const ranks = [
  { keyword: "k", language: "en", storefront: "us", rank: 8, totalResults: 200, checkedAt: "2026-08-22T10:00:00Z" },
  { keyword: "k", language: "en", storefront: "us", rank: null, totalResults: 200, checkedAt: "2026-08-22T18:00:00Z" },
  { keyword: "k", language: "en", storefront: "us", rank: 12, totalResults: 200, checkedAt: "2026-08-23T10:00:00Z" },
] as any;
const releases = [
  { tag: "v1.1.0", publishedAt: "2026-08-22T09:00:00Z" },
  { tag: "v1.0.9", publishedAt: "2026-08-22T08:00:00Z" },
] as any;

const series = buildTrendSeries({ trafficSnapshots: traffic, rankSnapshots: ranks, releases, rangeDays: 7, now });
check(series.length === 7, "按 rangeDays 补零成 7 个日点");
const day22 = series.find((p) => p.date === "2026-08-22");
check(day22?.bestRank === 8, "当日最佳排名取最小正排名（忽略 null）");
check(day22?.views === 100 && day22?.assetDownloads === 42, "当日流量与资产下载聚合");
check(day22?.releaseTags.join(",") === "v1.1.0,v1.0.9", "发布事件按日归组");
const day24 = series.find((p) => p.date === "2026-08-24");
check(day24?.views === 0 && day24?.bestRank === null, "无数据日零填充");
check(series[0].date === "2026-08-18", "窗口起点为 now-6 天");

if (errors) process.exit(1);
console.log("done");
