import { reviewStats } from "../src/renderer/lib/review-stats";
import type { Review } from "@appilot-labs/core/review-collector";

let errors = 0;
function check(ok: boolean, msg: string) {
  if (ok) console.log(`✅ PASS: ${msg}`);
  else { console.error(`❌ FAIL: ${msg}`); errors++; }
}

const base: Review = {
  id: "r1", trackId: "1", country: "us", rating: 5, title: "t",
  body: "b", version: "1.0", author: "a", updatedAt: "2026-08-20T00:00:00Z",
};
const now = new Date("2026-08-24T00:00:00Z");
const items: Review[] = [
  base,
  { ...base, id: "r2", rating: 4, updatedAt: "2026-06-01T00:00:00Z" },
  { ...base, id: "r3", rating: 1, updatedAt: "2026-07-01T00:00:00Z" },
];

const stats = reviewStats(items, now);
check(stats.total === 3, "总数统计正确");
check(stats.average === 3.3, "平均分保留一位小数");
check(stats.distribution[5] === 1 && stats.distribution[1] === 1, "评分分布正确");
check(stats.recent30 === 1, "近 30 天只计 8-20 那条");
check(reviewStats([], now).average === null, "空集平均分为 null");
check(reviewStats([{ ...base, rating: 99 }], now).total === 0, "越界评分被忽略");

if (errors) process.exit(1);
console.log("done");
