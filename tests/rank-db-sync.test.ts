/**
 * rank-db-sync 单测：Electron rank 历史 → 共享 SQLite 的幂等导入与双写。
 * 纯 node（不 import electron），用临时 DB 验证映射与幂等语义。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert';
import { openStore } from '@appilot-labs/appilot-headless';
import {
  importRankHistoryToDb,
  recordRankSnapshotToDb,
  toRankRows,
} from '../src/main/rank-db-sync';

async function main(): Promise<void> {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'rank-db-sync-test-')), 'appilot.db');
  const store = openStore(dbPath);

  const projects = [
    {
      name: 'proj-a',
      storeProducts: [
        {
          id: 'proj-a:macos',
          rankSnapshots: [
            { keyword: 'app', language: 'en', storefront: 'us', rank: 3, totalResults: 100, checkedAt: '2026-08-01T00:00:00Z' },
            { keyword: 'app', language: 'en', storefront: 'us', rank: 2, totalResults: 100, checkedAt: '2026-08-02T00:00:00Z' },
            { keyword: 'bad-row', storefront: 'us' }, // 畸形：缺 language/checkedAt → 跳过
          ],
        },
        {
          id: 'proj-a:ios',
          rankSnapshots: [{ keyword: 'app', language: 'ja', storefront: 'jp', rank: null, totalResults: 0, checkedAt: '2026-08-03T00:00:00Z' }],
        },
        { id: 'no-snapshots', rankSnapshots: [] },
      ],
    },
    { name: 'proj-b', storeProducts: [{ id: 'proj-b:macos', rankSnapshots: [{ keyword: 'x', language: 'en', storefront: 'us', rank: 1, totalResults: 5, checkedAt: '2026-08-04T00:00:00Z' }] }] },
  ];

  // 1. toRankRows 过滤畸形行
  const rows0 = toRankRows('p', 'prod', projects[0].storeProducts[0].rankSnapshots);
  assert.equal(rows0.length, 2, '畸形行应被过滤');
  console.log('✓ toRankRows 过滤畸形');

  // 2. 首次导入：3 条有效（proj-a: 2 + 1，proj-a ios 1 条，proj-b 1 条 = 4? 计数）
  const imported = importRankHistoryToDb(store, projects as any);
  assert.equal(imported, 4, `首次导入应导入 4 行，实际 ${imported}`);
  assert.equal(store.snapshots.latestByKey('proj-a', 'proj-a:macos').length, 1);
  const iosLatest = store.snapshots.latestByKey('proj-a', 'proj-a:ios');
  assert.equal(iosLatest[0]?.rank, null, 'null rank 保留');
  console.log('✓ 首次导入 4 行');

  // 3. 幂等：重复导入不新增
  const again = importRankHistoryToDb(store, projects as any);
  assert.equal(again, 0, '重复导入应跳过');
  console.log('✓ 重复导入幂等');

  // 4. 双写：recordRankSnapshotToDb 增量追加（不影响导入跳过逻辑）
  const ok = recordRankSnapshotToDb(store, 'proj-a', 'proj-a:macos', {
    keyword: 'app', language: 'en', storefront: 'us', rank: 1, totalResults: 100, checkedAt: '2026-09-01T00:00:00Z',
  });
  assert.equal(ok, true);
  const latest = store.snapshots.latestByKey('proj-a', 'proj-a:macos');
  assert.equal(latest[0]?.rank, 1, '双写后最新 rank=1');
  console.log('✓ 双写增量');

  // 5. 项目名维度：DSH 侧（productId=null）读不到 Electron 专属 product 数据（隔离正确）
  const nullProd = store.snapshots.latestByKey('proj-a');
  assert.equal(nullProd.length, 0, 'productId 维度应隔离');
  console.log('✓ productId 维度隔离');

  store.close();
  console.log('rank-db-sync 单测全部通过 ✓');
}

main().catch((err) => {
  console.error('rank-db-sync 测试失败:', err);
  process.exit(1);
});
