/**
 * competitor-intel 单测：竞品竞争面聚合 + 竞争指数（决策 1/3/4 口径）。
 * 纯 node（不 import electron）。
 */
import assert from 'node:assert';
import { buildCompetitorIntel } from '../src/main/competitor-intel';

const day = 86_400_000;
const now = Date.now();
const d = (agoDays: number) => new Date(now - agoDays * day).toISOString();

function main(): void {
  const own = [
    // kwA：我方主力词（美国店 #30）
    { keyword: 'kwA', language: 'en', storefront: 'us', rank: 30, checkedAt: d(0) },
    // kwB：我方弱词（#250，长尾侧）
    { keyword: 'kwB', language: 'en', storefront: 'us', rank: 250, checkedAt: d(0) },
    // kwD：我方在榜但被竞品咬着的词（我方 #120，竞品 #180；随后双方都掉到 200 外）
    { keyword: 'kwD', language: 'en', storefront: 'us', rank: 120, checkedAt: d(1) },
    { keyword: 'kwD', language: 'en', storefront: 'us', rank: 260, checkedAt: d(0) },
    // kwE：我方韩国店词（en 关键词 × kr 店）——face 应带两个商店
    { keyword: 'kwA', language: 'en', storefront: 'kr', rank: 88, checkedAt: d(0) },
    // kwF：10 天前采集（窗口外，应忽略）
    { keyword: 'kwF', language: 'en', storefront: 'us', rank: 5, checkedAt: d(10) },
  ];
  const theirs = [
    // kwA：竞品 #5 领先我（delta = 5 - 30 = -25；weight 我方 30 → 4；threat 1.5 → 6 分）
    { keyword: 'kwA', language: 'en', storefront: 'us', platform: 'ios', rank: 5, checkedAt: d(0) },
    // kwB：竞品也在 200 外（#320）→ offChart / 双方长尾
    { keyword: 'kwB', language: 'en', storefront: 'us', platform: 'ios', rank: 320, checkedAt: d(0) },
    // kwD：竞品 #180 落后我（我方 120 → weight 2；threat both 0.6；竞品最新掉到 260 → 长尾 0.2）
    { keyword: 'kwD', language: 'en', storefront: 'us', platform: 'ios', rank: 180, checkedAt: d(1) },
    { keyword: 'kwD', language: 'en', storefront: 'us', platform: 'ios', rank: 260, checkedAt: d(0) },
    // kwE：竞品在 kr 店 #40，我只在 kr（en×kr 都是 #88）→ both，delta 40-88 = -48，weight 我方 88→2，threat 1.5
    { keyword: 'kwA', language: 'en', storefront: 'kr', platform: 'ios', rank: 40, checkedAt: d(0) },
    // macos 平台的记录：多平台分开统计，应被 ios 聚合忽略
    { keyword: 'kwA', language: 'en', storefront: 'us', platform: 'macos', rank: 2, checkedAt: d(0) },
  ];

  const intel = buildCompetitorIntel({
    platform: 'ios',
    rankEntries: theirs,
    ownSnapshots: own,
    linkedKeywords: [{ keyword: 'kwC', language: 'en' }],
    now,
  });

  assert.equal(intel.platform, 'ios');
  // faces：kwA / kwB / kwC(仅关联，无采集) / kwD。kwF 窗口外不产生 face。
  assert.deepEqual(
    intel.faces.map((f) => f.keyword).sort(),
    ['kwA', 'kwB', 'kwC', 'kwD'],
    'face 集合 = 窗口内竞品快照词 ∪ linkedKeywords（窗口外忽略）',
  );

  const byKw = new Map(intel.faces.map((f) => [f.keyword, f]));
  const kwA = byKw.get('kwA')!;
  assert.equal(kwA.theirBest, 5, 'kwA 竞品最好名次');
  assert.equal(kwA.ownBest, 30, 'kwA 我方最好名次（us #30）');
  assert.equal(kwA.weight, 4, '决策1：我方 ≤50 → 权重 4');
  assert.equal(kwA.overlap, 'both');
  assert.equal(kwA.delta, -25, 'delta = 竞品 - 我方（负 = 竞品领先）');
  assert.equal(kwA.threat, 1.5, '竞品领先 → threat 1.5');
  assert.equal(kwA.contribution, 6, '4 × 1.5');
  assert.equal(kwA.cells.length, 2, 'kwA cells = us + kr 两商店');
  assert.equal(kwA.cells.find((c) => c.storefront === 'kr')?.theirs, 40, 'kr 店竞品名次');
  assert.equal(kwA.cells.find((c) => c.storefront === 'kr')?.own, 88);
  const kwAUs = kwA.cells.find((c) => c.storefront === 'us')!;
  assert.equal(kwAUs?.ownSeen, true, 'us 店我方已采集（seen 标记）');
  assert.equal(kwAUs?.theirsSeen, true, 'us 店竞品已采集（seen 标记）');
  assert.equal(kwA.cells.find((c) => c.storefront === 'kr')?.theirsSeen, true, 'kr 店竞品 seen');

  const kwB = byKw.get('kwB')!;
  assert.equal(kwB.overlap, 'offChart', '竞品 320 → 200 名外 = offChart');
  assert.equal(kwB.longTail, true, '双方最新 >200 → 长尾标记');
  assert.equal(kwB.contribution, 0, 'offChart threat=0 → 无贡献');

  const kwC = byKw.get('kwC')!;
  assert.equal(kwC.overlap, 'unknown', '仅关联未采集 → unknown');
  assert.equal(kwC.sampleCount, 0);

  const kwD = byKw.get('kwD')!;
  assert.equal(kwD.weight, 2, '我方 120 → 权重 2');
  assert.equal(kwD.overlap, 'both');
  assert.equal(kwD.threat, 0.6, '双方在榜且我领先 → 0.6');
  assert.equal(kwD.longTail, true, '竞品最新 260 / 我方 250 → 双方 >200 → 长尾降权');
  assert.equal(kwD.contribution, 2 * 0.6 * 0.2, '决策4：长尾 ×0.2');

  // 汇总：压制词数（kwA 压我；kwD 我领先不算压制）→ 1
  assert.equal(intel.faceCount, 4);
  assert.equal(intel.pressuredCount, 1, '仅 kwA 被竞品压制');
  assert.equal(intel.theirOnChart, 2, 'kwA/kwD 竞品在榜（best ≤200）');
  assert.equal(intel.longTailCount, 2, 'kwB/kwD 双方长尾');
  const expectIndex = Math.round((6 + 0 + 0 + 0.24) * 10) / 10;
  assert.equal(intel.index, expectIndex, `竞争指数 = ${expectIndex}`);

  console.log('✓ 竞争面聚合（窗口/多平台隔离/长尾）');
  console.log('✓ 竞争指数（决策 1 权重 / 决策 3 分平台 / 决策 4 降权）');
  console.log('competitor-intel 单测全部通过 ✓');
}

main();
