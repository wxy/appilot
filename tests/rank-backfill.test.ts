/**
 * rank-backfill 单测：DB rank_snapshots → electron-store product.rankSnapshots
 * 反向同步（P2b）。纯 node（不 import electron），隔离 DB。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert';
import { openStore } from '@appilot-labs/appilot-headless';
import { backfillRankSnapshotsToElectron } from '../src/main/rank-backfill';

function electronProject(rankSnapshots: any[]): any {
  return {
    name: 'ai-pulse-macos',
    storeProducts: [
      { id: 'projX:macos', platform: 'macos', rankSnapshots },
    ],
  };
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'rank-backfill-'));
  const store = openStore(join(dir, 'appilot.db'));

  const addRow = (keyword: string, rank: number | null, checkedAt: string) =>
    store.snapshots.add([
      { projectName: 'ai-pulse-macos', productId: 'projX:macos', keyword, language: 'en', storefront: 'us', rank, totalResults: 100, checkedAt },
    ]);

  // 1. 本地无快照 → 全量导入
  const p1 = electronProject([]);
  addRow('app', 5, '2026-09-01T00:00:00Z');
  addRow('app', 3, '2026-09-02T00:00:00Z');
  const n1 = backfillRankSnapshotsToElectron(store, [p1]);
  assert.equal(n1, 1, '应更新 1 个产品');
  assert.equal(p1.storeProducts[0].rankSnapshots.length, 2, '两行都应导入');
  console.log('✓ 本地空 → 全量导入');

  // 2. 本地已有旧点 → 只合并更新的点
  const p2 = electronProject([
    { keyword: 'app', language: 'en', storefront: 'us', rank: 3, totalResults: 100, checkedAt: '2026-09-02T00:00:00Z' },
  ]);
  addRow('app', 1, '2026-09-03T00:00:00Z'); // DB 更新点
  const n2 = backfillRankSnapshotsToElectron(store, [p2]);
  assert.equal(n2, 1);
  const snaps2 = p2.storeProducts[0].rankSnapshots;
  assert.equal(snaps2.length, 2, '旧点+新点合并');
  assert.equal(snaps2.find((s: any) => s.checkedAt === '2026-09-03T00:00:00Z')?.rank, 1);
  console.log('✓ 增量合并（只加更新的点）');

  // 3. 无更新 → 0
  const p3 = electronProject([
    { keyword: 'app', language: 'en', storefront: 'us', rank: 1, totalResults: 100, checkedAt: '2026-09-03T00:00:00Z' },
  ]);
  const n3 = backfillRankSnapshotsToElectron(store, [p3]);
  assert.equal(n3, 0, '无更新应跳过');
  console.log('✓ 无更新幂等');

  // 4. 畸形本地行清洗（缺字段）不崩
  const p4 = electronProject([{ keyword: 'app', storefront: 'us' }]); // 缺 language/checkedAt
  addRow('app', 9, '2026-09-04T00:00:00Z');
  const n4 = backfillRankSnapshotsToElectron(store, [p4]);
  assert.equal(n4, 1, '畸形行被清洗后仍可导入（本地空 → 全量）');
  assert.equal(p4.storeProducts[0].rankSnapshots.length, 4, 'DB 4 行全量导入（畸形行不入结果）');
  assert.ok(p4.storeProducts[0].rankSnapshots.every((s: any) => typeof s.checkedAt === 'string'), '畸形行被清洗');
  console.log('✓ 畸形行清洗 + 全量导入');

  store.close();
  console.log('rank-backfill 单测全部通过 ✓');
}

main().catch((err) => {
  console.error('rank-backfill 测试失败:', err);
  process.exit(1);
});
