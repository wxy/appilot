/**
 * snapshots.recent 测试：时间序列读取（降序、productId/keyword 过滤、limit）。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert';
import { openStore, createHeadlessService } from '../src/index.js';

function mk(projectName: string, productId: string | null, keyword: string, rank: number | null, checkedAt: string) {
  return { projectName, productId, keyword, language: 'en', storefront: 'us', rank, totalResults: 100, checkedAt };
}

async function main(): Promise<void> {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'recent-test-')), 'appilot.db');
  const store = openStore(dbPath);
  store.snapshots.add([
    // DSH 维度（productId null）
    mk('proj', null, 'app', 5, '2026-08-01T00:00:00Z'),
    mk('proj', null, 'app', 3, '2026-08-02T00:00:00Z'),
    mk('proj', null, 'app', 1, '2026-08-03T00:00:00Z'),
    mk('proj', null, 'other', 9, '2026-08-03T00:00:00Z'),
    // Electron 维度（productId 非空）——不应混入缺省查询
    mk('proj', 'proj:macos', 'app', 2, '2026-08-03T00:00:00Z'),
  ]);

  // 1. 缺省只看 productId NULL（DSH 维度），降序最新在前
  const rows = store.snapshots.recent('proj');
  assert.equal(rows.length, 4);
  assert.equal(rows[0].checkedAt, '2026-08-03T00:00:00Z');
  assert.equal(rows[0].keyword, 'other', '同刻按 id 兜底——other 后插入排前');
  assert.ok(rows.every((r) => r.productId === null), '缺省不应含 Electron 行');
  console.log('✓ 缺省 productId NULL 维度 + 降序');

  // 2. 按 productId 过滤 → 只看 Electron 行
  const electron = store.snapshots.recent('proj', { productId: 'proj:macos' });
  assert.equal(electron.length, 1);
  assert.equal(electron[0].productId, 'proj:macos');
  console.log('✓ productId 过滤');

  // 3. keyword 过滤 + limit
  const kw = store.snapshots.recent('proj', { keyword: 'app', limit: 2 });
  assert.equal(kw.length, 2);
  assert.ok(kw.every((r) => r.keyword === 'app'));
  console.log('✓ keyword + limit 过滤');

  // 4. service 透传一致
  const svc = createHeadlessService(store);
  const viaSvc = svc.snapshots.recent('proj', { keyword: 'app' });
  assert.equal(viaSvc.length, 3);
  console.log('✓ service 透传');

  store.close();
  console.log('snapshots.recent 测试全部通过 ✓');
}

main().catch((err) => {
  console.error('recent 测试失败:', err);
  process.exit(1);
});
