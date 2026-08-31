import { competitorDeltaSummary } from "../src/competitor-radar";
import type { Competitor, CompetitorSnapshot } from "../src/competitor-radar";

let errors = 0;
function check(ok: boolean, msg: string) {
  if (ok) console.log(`✅ PASS: ${msg}`);
  else { console.error(`❌ FAIL: ${msg}`); errors++; }
}

const competitor: Competitor = {
  id: "cid-1", name: "Comp", trackId: "1", platform: "ios", githubUrl: null, notes: "", addedAt: "2026-08-01T00:00:00Z",
};
const base = (date: string): CompetitorSnapshot => ({
  date, country: "us", platform: "ios", version: "1.0", releaseDate: null, price: 0, averageUserRating: 4, ratingCount: 10, stars: 10, recentReleases: [],
});
const day = (offset: number) =>
  new Date(Date.now() - offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const snapshots = [
  base(day(3)),
  { ...base(day(1)), version: "1.1", stars: 15, recentReleases: [{ tag: "v1.1", publishedAt: `${day(1)}T00:00:00Z` }] },
];

const delta = competitorDeltaSummary(competitor, snapshots, 7);
check(delta?.name === "Comp", "delta 返回竞品名");
check(delta?.change?.includes("v1.0 → v1.1") === true, "delta 含版本变化");
check(delta?.change?.includes("★+5") === true, "delta 含 star 增量");
check(competitorDeltaSummary(competitor, [], 7) === null, "无快照返回 null");
const unchanged = competitorDeltaSummary(competitor, [base(day(2)), base(day(1))], 7);
check(unchanged === null, "无变化返回 null");

if (errors) process.exit(1);
console.log("done");
