/**
 * P2a 测试：rank 实例推导（rankInstancesFor）与执行器装配/校验。
 * 推导纯逻辑可测；执行器网络部分不测（core rank-collector 有覆盖）。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import {
  openStore,
  rankInstancesFor,
  reconcileTaskInstances,
  buildRankExecutor,
  RANK_KIND,
  type ProductRecordRow,
} from '../src/index.js';

function product(over: Partial<ProductRecordRow> = {}): ProductRecordRow {
  return {
    projectName: 'ai-pulse-macos',
    productId: 'projX:macos',
    platform: 'macos',
    trackId: 123456,
    bundleId: 'com.x',
    trackName: 'X',
    artworkUrl: null,
    supportedLanguages: ['en', 'zh-Hans'],
    trackedKeywords: [],
    storeLinks: [],
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

async function main(): Promise<void> {
  // 1. 纯 en 产品 + en 关键词 → en 商店展开；id 与 Electron rankTaskId 一致
  const p = product({ supportedLanguages: ['en'] });
  const pool = [
    { keyword: 'app', language: 'en', status: 'active' },
    { keyword: 'paused-word', language: 'en', status: 'paused' },
    { keyword: 'zh', language: 'zh-Hans', status: 'active' }, // 不在 queryLanguages(en) → 跳过
  ];
  const specs = rankInstancesFor('ai-pulse-macos', p, pool as any);
  assert.ok(specs.length > 0, '应有实例');
  assert.ok(specs.every((s) => s.id.startsWith('projX:macos:en:us:') || s.id.startsWith('projX:macos:en:')), `id 格式: ${specs[0].id}`);
  assert.ok(specs.every((s) => s.kind === RANK_KIND));
  assert.ok(specs.some((s) => (s.instance as any).keyword === 'app'), '应含 active 关键词');
  assert.ok(!specs.some((s) => (s.instance as any).keyword === 'paused-word'), 'paused 关键词应跳过');
  assert.ok(!specs.some((s) => (s.instance as any).queryLanguage === 'zh-Hans'), 'en 产品不展开其他语言');
  console.log(`✓ 推导（en 产品；paused 跳过；en 商店展开；实例数 ${specs.length}）`);

  // 2. 多语言产品 + zh-Hans 关键词 → 展开 zh-Hans + en storefronts
  const p2 = product({ supportedLanguages: ['zh-Hans'] });
  const specs2 = rankInstancesFor('ai-pulse-macos', p2, [{ keyword: '应用', language: 'zh-Hans', status: 'active' }] as any);
  assert.ok(specs2.some((s) => (s.instance as any).queryLanguage === 'zh-Hans'), 'zh-Hans 关键词应展开');
  assert.ok(specs2.every((s) => (s.instance as any).queryLanguage === 'zh-Hans'), 'zh-Hans 产品只查 zh-Hans 语言（+en 关键词若有）');
  console.log(`✓ 多语言展开（zh-Hans storefronts ${specs2.length}）`);

  // 3. 无 trackId → 空
  assert.equal(rankInstancesFor('p', product({ trackId: null }), pool as any).length, 0, '无 trackId 不推导');
  console.log('✓ 无 trackId 跳过');

  // 4. reconcile 落库（seed → DB kind=rank 实例）
  const dir = mkdtempSync(join(tmpdir(), 'rank-inst-'));
  const store = openStore(join(dir, 'appilot.db'));
  const res = reconcileTaskInstances(store, rankInstancesFor('ai-pulse-macos', p, pool as any), 'electron');
  assert.ok(res.seeded > 0);
  const row = store.tasks.all().find((t) => t.kind === RANK_KIND);
  assert.equal(row?.kind, RANK_KIND);
  assert.ok((row?.instance as any)?.productId === 'projX:macos');
  console.log(`✓ reconcile 落库（seeded ${res.seeded}）`);

  // 5. 执行器装配与参数校验（错误路径无需网络）
  const executor = buildRankExecutor();
  assert.equal(executor.title, '排名采集');
  const s2 = openStore(join(dir, 'appilot2.db'));
  const bad = executor
    .run({ store: s2, task: { id: 'x', title: 't', intervalMinutes: 60, lastRunAt: null, nextRunAt: null, lastStatus: 'never', lastSummary: null, runCount: 0, source: 'dsh', kind: RANK_KIND, instance: { projectName: 'p', productId: 'id', keyword: '', storefront: 'us' } } as any, log: () => {} })
    .then(() => null, (e: Error) => e.message);
  const msg = await bad;
  assert.ok((msg as string).includes('参数不完整'), `缺参数应报错: ${msg}`);
  // 缺 trackId（DB 无 product_records）→ 报错（在参数完整后）
  const s3 = openStore(join(dir, 'appilot3.db'));
  const bad2 = executor
    .run({ store: s3, task: { id: 'x', title: 't', intervalMinutes: 60, lastRunAt: null, nextRunAt: null, lastStatus: 'never', lastSummary: null, runCount: 0, source: 'dsh', kind: RANK_KIND, instance: { projectName: 'p', productId: 'pid', keyword: 'app', storefront: 'us', queryLanguage: 'en' } } as any, log: () => {} })
    .then(() => null, (e: Error) => e.message);
  const msg2 = await bad2;
  assert.ok((msg2 as string).includes('trackId'), `缺 trackId 应报错: ${msg2}`);
  s2.close();
  s3.close();
  store.close();
  console.log('✓ 执行器装配 + 参数/trackId 校验错误路径');

  console.log('P2a rank 组件测试全部通过 ✓');
}

main().catch((err) => {
  console.error('rank-instances 测试失败:', err);
  process.exit(1);
});
