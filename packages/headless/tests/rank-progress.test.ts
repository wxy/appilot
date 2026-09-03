/**
 * rankProgress 单测：rank 组进度（rounds DB 表达）聚合。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { openStore, createHeadlessService } from '../src/index.js';

function rankTask(id: string, inst: Record<string, unknown>, status: 'never' | 'ok' | 'error', lastRunAt: string | null = null): any {
  return { id, title: '排名采集', intervalMinutes: 720, lastRunAt, nextRunAt: null, lastStatus: status, lastSummary: null, runCount: 1, source: 'electron', kind: 'rank', instance: inst };
}

async function main(): Promise<void> {
  const store = openStore(join(mkdtempSync(join(tmpdir(), 'rank-prog-')), 'appilot.db'));
  const groupA = 'rank:projA:macos:macos:en:us';
  const groupB = 'rank:projB:ios:ios:en:us';
  store.tasks.upsert(rankTask('t1', { projectName: 'projA', productId: 'projA:macos', keyword: 'k1', queryLanguage: 'en', storefront: 'us', groupKey: groupA }, 'ok', '2026-09-03T00:00:00Z'));
  store.tasks.upsert(rankTask('t2', { projectName: 'projA', productId: 'projA:macos', keyword: 'k2', queryLanguage: 'en', storefront: 'us', groupKey: groupA }, 'never'));
  store.tasks.upsert(rankTask('t3', { projectName: 'projA', productId: 'projA:macos', keyword: 'k3', queryLanguage: 'en', storefront: 'us', groupKey: groupA }, 'error', '2026-09-02T00:00:00Z'));
  store.tasks.upsert(rankTask('t4', { projectName: 'projB', productId: 'projB:ios', keyword: 'k1', queryLanguage: 'en', storefront: 'us', groupKey: groupB }, 'ok', '2026-09-03T01:00:00Z'));

  const svc = createHeadlessService(store);
  const all = svc.tasks.rankProgress();
  assert.equal(all.length, 2, '两组');
  const a = all.find((g) => g.groupKey === groupA);
  assert.deepEqual({ total: a?.total, ok: a?.ok, error: a?.error, pending: a?.pending }, { total: 3, ok: 1, error: 1, pending: 1 });
  assert.equal(a?.lastRunAt, '2026-09-03T00:00:00Z', '组最近运行时间');
  assert.equal(a?.projectName, 'projA');
  const byProject = svc.tasks.rankProgress({ projectName: 'projB' });
  assert.equal(byProject.length, 1);
  assert.equal(byProject[0].productId, 'projB:ios');
  console.log('✓ rankProgress 聚合（组/ok/error/pending/lastRunAt + 过滤）');

  store.close();
  console.log('rank-progress 单测全部通过 ✓');
}

main().catch((err) => {
  console.error('rank-progress 测试失败:', err);
  process.exit(1);
});
