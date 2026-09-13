import assert from "node:assert/strict";
import { buildRankDiagnosticPackage, selectRankDiagnosticEvidence } from "../src/diagnostics/rank";

const now = "2026-09-11T08:00:00.000Z";
const scope = { projectId: "p1", productId: "p1:ios", platform: "ios" };
const result = buildRankDiagnosticPackage({
  scope, source: "sqlite", generatedAt: now, expectedSeriesCount: 5,
  snapshots: [
    { keyword: "a", language: "en", storefront: "us", rank: 5, checkedAt: "2026-09-11T07:00:00.000Z" },
    { keyword: "a", language: "en", storefront: "us", rank: null, checkedAt: "2026-09-11T07:30:00.000Z" },
    { keyword: "b", language: "en", storefront: "us", rank: 8, checkedAt: "2026-09-08T07:00:00.000Z" },
    { keyword: "bad", language: "en", storefront: "gb", rank: 1, checkedAt: "invalid" },
    { keyword: "future", language: "en", storefront: "us", rank: 1, checkedAt: "2026-09-12T08:00:00.000Z" },
  ],
});
assert.equal(result.coverage.latestSeriesCount, 2);
assert.equal(result.coverage.latestRankedCount, 1);
assert.equal(result.coverage.latestUnrankedCount, 1);
assert.equal(result.coverage.freshSeriesCount, 1);
assert.equal(result.coverage.staleSeriesCount, 1);
assert.ok(result.anomalies.some((item) => item.id === "rank.invalid-timestamps"));
assert.equal(result.coverage.futureTimestampCount, 1);
assert.ok(result.anomalies.some((item) => item.id === "rank.future-timestamps"));
assert.ok(result.anomalies.some((item) => item.id === "rank.stale-coverage"));
assert.ok(result.anomalies.some((item) => item.id === "rank.expected-coverage-gap"));
assert.ok(result.limitations.some((item) => item.includes("未搜到排名不等于排名下降")));
assert.equal(result.evidenceIndex.length, 1);

const allUnranked = buildRankDiagnosticPackage({
  scope, source: "live-query", generatedAt: now,
  snapshots: Array.from({ length: 5 }, (_, index) => ({
    keyword: `k${index}`, language: "en", storefront: "us", rank: null,
    checkedAt: "2026-09-11T07:00:00.000Z",
  })),
});
const visibility = allUnranked.anomalies.find((item) => item.id === "rank.all-fresh-unranked");
assert.ok(visibility);
assert.match(visibility!.interpretation, /不能仅凭/);

const empty = buildRankDiagnosticPackage({ scope, source: "sqlite", generatedAt: now, snapshots: [] });
assert.equal(empty.coverage.source, "none");
assert.equal(empty.anomalies[0].severity, "blocking");
assert.match(empty.anomalies[0].interpretation, /不能判断排名表现/);

const scoped = selectRankDiagnosticEvidence({
  platform: "ios",
  supportedLanguages: ["en"],
  trackedKeywords: [
    { keyword: "active", language: "en", status: "active" },
    { keyword: "paused", language: "en", status: "paused" },
    { keyword: "mac-only", language: "en", status: "active", pausedPlatforms: ["ios"] },
  ],
  snapshots: [
    { keyword: "active", language: "en", storefront: "us", rank: 4, checkedAt: now },
    { keyword: "paused", language: "en", storefront: "us", rank: 1, checkedAt: now },
    { keyword: "removed", language: "en", storefront: "us", rank: 2, checkedAt: now },
    { keyword: "mac-only", language: "en", storefront: "us", rank: 3, checkedAt: now },
  ],
});
assert.ok(scoped.expectedSeriesCount > 0);
assert.deepEqual(scoped.snapshots.map((item) => item.keyword), ["active"]);

console.log("rank diagnostic tests passed");
