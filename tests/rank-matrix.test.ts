/**
 * rank-matrix 单测：覆盖热力图聚合（桶切分 / 12h 窗口 tone / 矩阵形状）。
 * 纯 node（不 import electron）。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { openStore } from '@appilot-labs/appilot-headless';
import {
  buildRankCoverageMatrix,
  chunkInstances,
  bucketTone,
  columnGroupOf,
  COVERAGE_BUCKET_KEYWORDS,
} from '../src/main/rank-matrix';

const NOW = new Date('2026-09-05T00:00:00.000Z').getTime();
const iso = (ms: number) => new Date(ms).toISOString();
const H = 3600 * 1000;

function rankTask(store: ReturnType<typeof openStore>, id: string, productId: string, storefront: string, keyword: string, lang = 'en', status: 'ok' | 'error' | 'never' = 'ok', nextInH?: number): void {
  store.tasks.upsert({
    id, title: '排名采集', intervalMinutes: 720,
    lastRunAt: status === 'ok' ? iso(NOW - 1000) : null,
    nextRunAt: nextInH != null ? iso(NOW + nextInH * H) : iso(NOW + 720 * 60 * 1000),
    lastStatus: status, lastSummary: status === 'error' ? 'e' : null, runCount: 1,
    source: 'electron', kind: 'rank',
    instance: { productId, keyword, queryLanguage: lang, storefront, platform: productId.split(':')[1] },
  });
}

async function main(): Promise<void> {
  const store = openStore(join(mkdtempSync(join(tmpdir(), 'rank-matrix-')), 'appilot.db'));
  store.projects.save({ name: 'proj-a', path: '/x', githubUrl: null, platform: 'ios', languages: ['en'], lastResolvedAt: iso(NOW), artworkUrl: null, updatedAt: iso(NOW) });
  store.products.upsert({
    projectName: 'proj-a', productId: 'app-a:ios', platform: 'ios', trackId: 1, bundleId: 'x',
    trackName: 'App A', artworkUrl: null, supportedLanguages: ['en'], trackedKeywords: [],
    storeLinks: [], updatedAt: iso(NOW),
  });

  // us 格：k1..k3 覆盖（快照 1h 内）+ k4 过期未采（快照 20h 前、nextRunAt 过去）→ 4 词 1 桶 → part
  rankTask(store, 'u1', 'app-a:ios', 'us', 'alpha');
  rankTask(store, 'u2', 'app-a:ios', 'us', 'beta');
  rankTask(store, 'u3', 'app-a:ios', 'us', 'gamma');
  rankTask(store, 'u4', 'app-a:ios', 'us', 'delta', 'en', 'ok', -10);
  // de 格：zeta error + 4 ok（1h 内）→ 5 词 1 桶 → err
  rankTask(store, 'd1', 'app-a:ios', 'de', 'alpha');
  rankTask(store, 'd2', 'app-a:ios', 'de', 'beta');
  rankTask(store, 'd3', 'app-a:ios', 'de', 'gamma');
  rankTask(store, 'd4', 'app-a:ios', 'de', 'delta');
  rankTask(store, 'd5', 'app-a:ios', 'de', 'zeta', 'en', 'error');
  // 快照：4 个 us 词 1h 前；de 前 4 词 1h 前
  store.snapshots.add([
    { projectName: 'proj-a', productId: 'app-a:ios', keyword: 'alpha', language: 'en', storefront: 'us', rank: 1, totalResults: 10, checkedAt: iso(NOW - H) },
    { projectName: 'proj-a', productId: 'app-a:ios', keyword: 'beta', language: 'en', storefront: 'us', rank: 2, totalResults: 10, checkedAt: iso(NOW - H) },
    { projectName: 'proj-a', productId: 'app-a:ios', keyword: 'gamma', language: 'en', storefront: 'us', rank: 3, totalResults: 10, checkedAt: iso(NOW - H) },
    { projectName: 'proj-a', productId: 'app-a:ios', keyword: 'delta', language: 'en', storefront: 'us', rank: 4, totalResults: 10, checkedAt: iso(NOW - 20 * H) },
    { projectName: 'proj-a', productId: 'app-a:ios', keyword: 'alpha', language: 'en', storefront: 'de', rank: 5, totalResults: 10, checkedAt: iso(NOW - H) },
    { projectName: 'proj-a', productId: 'app-a:ios', keyword: 'beta', language: 'en', storefront: 'de', rank: 6, totalResults: 10, checkedAt: iso(NOW - H) },
    { projectName: 'proj-a', productId: 'app-a:ios', keyword: 'gamma', language: 'en', storefront: 'de', rank: 7, totalResults: 10, checkedAt: iso(NOW - H) },
    { projectName: 'proj-a', productId: 'app-a:ios', keyword: 'delta', language: 'en', storefront: 'de', rank: 8, totalResults: 10, checkedAt: iso(NOW - H) },
  ]);

  const m = buildRankCoverageMatrix(store, { now: NOW });
  assert.deepEqual(
    m.columns,
    [
      { lang: 'en', storefront: 'us', group: 'local:en' }, // 英语×英语商店 → 英语组（groupRank 0）
      { lang: 'en', storefront: 'de', group: 'global' }, // 英语×非英语商店 → 全局组（groupRank 1）
    ],
    '列排序：英语组 → 全局组',
  );
  assert.equal(columnGroupOf('de', 'de'), 'local:de', '本地化语言关键词归本地组');
  assert.equal(m.rows.length, 1, '一个产品行');
  const row = m.rows[0];
  assert.equal(row.productId, 'app-a:ios');
  assert.equal(row.projectName, 'proj-a', '仓库名');
  assert.equal(row.platform, 'ios', '平台');
  assert.equal(row.productName, 'App A', 'product_records trackName');
  assert.equal(row.cells.length, 2, 'cells 与 columns 对齐');
  const us = row.cells[0]; // columns[0] = en|us（local:en）
  const de = row.cells[1]; // columns[1] = en|de（global）
  assert.equal(us.total, 4);
  assert.equal(us.buckets.length, 1, '4 词 → 1 桶');
  assert.equal(us.buckets[0].tone, 'half', '3/4 覆盖（≥半数）→ half');
  assert.equal(de.total, 5);
  assert.equal(de.buckets.length, 2, '5 词 → 2 桶（4+1）');
  assert.equal(de.buckets[0].tone, 'cov', '桶1（alpha..delta 均 12h 覆盖）→ cov');
  assert.equal(de.buckets[1].tone, 'err', '桶2（zeta error）→ err');

  // bucketTone 边界：全覆盖 → cov；低于半数 → part；全未到期 → pend
  const okOnly = store.tasks.all().filter((t) => t.id.startsWith('u') && t.id !== 'u4');
  const okOnlyTone = bucketTone(okOnly, store.snapshots.latestCheckedAtByKey(), NOW);
  assert.equal(okOnlyTone.tone, 'cov', '全部 12h 内覆盖 → cov');
  const de4 = store.tasks.all().filter((t) => t.id.startsWith('d') && t.id !== 'd5');
  const de4Tone = bucketTone(de4, store.snapshots.latestCheckedAtByKey(), NOW);
  assert.equal(de4Tone.tone, 'cov', 'de 前 4 词 12h 内覆盖 → cov');
  // chunk 排序：按 keyword 字典序
  const chunks = chunkInstances(store.tasks.all(), COVERAGE_BUCKET_KEYWORDS);
  const firstChunkKeywords = chunks[0].map((t) => String(((t.instance as any)?.keyword)));
  assert.equal(firstChunkKeywords[0], 'alpha', '桶内按 keyword 排序');
  // 每个桶内无重复（同 keyword 不同 lang/storefront 才可能重复——本用例同店单语言）
  for (const ck of chunks) {
    assert.equal(new Set(ck.map((t) => t.id)).size, ck.length, '桶内实例不重复');
  }
  // 每桶 ≤ 5
  for (const ck of chunks) assert.ok(ck.length <= COVERAGE_BUCKET_KEYWORDS, '桶大小 ≤5');

  store.close();
  console.log('rank-matrix 单测全部通过 ✓');
}

main().catch((err) => {
  console.error('rank-matrix 测试失败:', err);
  process.exit(1);
});
