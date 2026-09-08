/**
 * 能力②竞品优势纯函数单测（computeCompetitorAdvantage）。
 * 覆盖：占优商店计数、优势/劣势词划分（我方名次领先多数竞品 / 被多数压制）、
 * 单边压制（竞品在榜我方不在）、无竞品返回 null、无可比数据 hasData=false。
 *
 * 口径：≤200 在榜；双方都在榜才比较；竞品在榜而我方不在榜 → 我方被压；
 * 竞品不在榜不构成优势也不构成压制（不用竞品缺数据夸大我方）。
 */

import { computeCompetitorAdvantage } from "../src/renderer/components/overview/overviewData";
import type { CompetitorAdvantageProfile } from "../src/renderer/components/overview/overviewData";

let errors = 0;
function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    errors++;
  } else {
    console.log(`✅ PASS: ${msg}`);
  }
}

function face(opts: {
  language?: string;
  keyword: string;
  ownBest?: number | null;
  theirBest?: number | null;
  cells?: Array<{ storefront: string; own?: number | null; theirs?: number | null }>;
}) {
  return {
    platform: "ios",
    language: opts.language ?? "en",
    keyword: opts.keyword,
    ownBest: opts.ownBest ?? null,
    theirBest: opts.theirBest ?? null,
    cells: (opts.cells || []).map((c) => ({ ...c })),
  };
}

function runTests() {
  const profiles: CompetitorAdvantageProfile[] = [
    {
      competitor: { name: "Comp A" },
      intel: {
        faces: [
          face({
            keyword: "night walk",
            ownBest: 8,
            theirBest: 12,
            cells: [
              { storefront: "us", own: 8, theirs: 12 },
              { storefront: "cn", own: 9, theirs: 12 },
              { storefront: "jp", own: 8, theirs: 30 },
            ],
          }),
          face({
            keyword: "running",
            ownBest: 40,
            theirBest: 30,
            cells: [
              { storefront: "us", own: 40, theirs: 30 },
              { storefront: "cn", own: 40, theirs: 30 },
              { storefront: "jp", own: 40, theirs: 25 },
            ],
          }),
        ],
      },
    },
    {
      competitor: { name: "Comp B" },
      intel: {
        faces: [
          face({
            keyword: "night walk",
            ownBest: 8,
            theirBest: 200,
            cells: [
              { storefront: "us", own: 8, theirs: 200 },
              { storefront: "cn", own: 8, theirs: 150 },
              { storefront: "de", own: 8, theirs: null },
            ],
          }),
          // 竞品不在榜（zh-Hans 词）：不构成压制也不构成优势。
          face({ language: "zh-Hans", keyword: "记账", ownBest: 100, theirBest: null }),
          // 竞品在榜而我们不在榜 → 该词被压（单词/整店）。
          face({ keyword: "walk", ownBest: 300, theirBest: 50, cells: [{ storefront: "us", own: 300, theirs: 50 }] }),
        ],
      },
    },
  ];

  const result = computeCompetitorAdvantage(profiles);
  assert(result !== null, "non-empty profiles → structured result");

  // ── 占优商店：cn 店 A 平手、B 领先 → leading 1 / compared 2 ──
  assert(
    result?.dominantStorefronts.length === 1 &&
      result?.dominantStorefronts[0].storefront === "cn",
    `dominant storefront = cn only (got ${JSON.stringify(result?.dominantStorefronts)})`,
  );
  const cn = result?.dominantStorefronts[0];
  assert(
    cn?.leading === 1 && cn?.compared === 2 && cn?.trailing === 0,
    "cn storefront: we lead 1 of 2 comparable competitors",
  );
  // us 店两竞品各 1 胜 1 负 → 平手，不占优也不被压制。
  assert(
    !result?.dominantStorefronts.some((s) => s.storefront === "us"),
    "us storefront tied for both competitors → not dominant",
  );

  // ── 优势词 / 劣势词 ──
  assert(
    result?.advantageKeywords.length === 1 &&
      result?.advantageKeywords[0].keyword === "night walk" &&
      result?.advantageKeywords[0].wins === 2 &&
      result?.advantageKeywords[0].losses === 0,
    "night walk is an advantage keyword (ahead of 2/2 competitors)",
  );
  assert(
    result?.disadvantageKeywords.length === 2,
    `two disadvantage keywords (got ${JSON.stringify(result?.disadvantageKeywords)})`,
  );
  const running = result?.disadvantageKeywords.find((k) => k.keyword === "running");
  const walk = result?.disadvantageKeywords.find((k) => k.keyword === "walk");
  assert(
    running?.wins === 0 && running?.losses === 1,
    "running: beaten by competitor A on chart",
  );
  assert(
    walk?.wins === 0 && walk?.losses === 1,
    "walk: competitor on chart while we are off-chart counts as a loss",
  );
  assert(
    !result?.disadvantageKeywords.some((k) => k.keyword === "记账") &&
      !result?.advantageKeywords.some((k) => k.keyword === "记账"),
    "keyword where competitor is not on chart is ignored (no fabricated data)",
  );

  // ── 空/无数据边界 ──
  assert(computeCompetitorAdvantage(null) === null, "null input → null");
  assert(computeCompetitorAdvantage([]) === null, "empty profiles → null");
  const noData = computeCompetitorAdvantage([
    {
      competitor: { name: "Comp C" },
      intel: {
        faces: [face({ keyword: "deep", ownBest: 3, theirBest: 400, cells: [{ storefront: "us", own: 3, theirs: 400 }] })],
      },
    },
  ]);
  assert(
    noData?.hasData === false &&
      noData?.dominantStorefronts.length === 0 &&
      noData?.advantageKeywords.length === 0 &&
      noData?.disadvantageKeywords.length === 0,
    "competitors present but nothing on chart → hasData=false, empty lists",
  );

  // ── 纯被压制商店不出现（trailing-only storefront excluded） ──
  const pressuredStore: CompetitorAdvantageProfile[] = [
    {
      competitor: { name: "Comp D" },
      intel: {
        faces: [face({ keyword: "top word", ownBest: 90, theirBest: 5, cells: [{ storefront: "fr", own: 90, theirs: 5 }] })],
      },
    },
  ];
  const pressured = computeCompetitorAdvantage(pressuredStore);
  assert(
    pressured?.hasData === true &&
      pressured?.disadvantageKeywords.length === 1 &&
      pressured?.dominantStorefronts.length === 0,
    "purely-trailing storefront excluded from dominant list, word lands in disadvantage",
  );

  if (errors === 0) console.log("\n🎉 All competitor-advantage tests passed!");
  else process.exitCode = 1;
}

void runTests();
