/**
 * task-center-db 单测：任务中心 DB 视图（renderer 结构兼容）。
 * 纯 node（不 import electron）。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert';
import { openStore } from '@appilot-labs/appilot-headless';
import { taskCenterTasksFromDb, taskCenterOverviewFromDb } from '../src/main/task-center-db';

async function main(): Promise<void> {
  const store = openStore(join(mkdtempSync(join(tmpdir(), 'task-center-db-')), 'appilot.db'));

  // 产品（Electron 双写）供 productName 查询
  store.products.upsert({
    projectName: 'ai-pulse-macos', productId: 'projX:macos', platform: 'macos',
    trackId: 123, bundleId: 'com.x', trackName: 'AI Pulse', artworkUrl: null,
    supportedLanguages: ['en'], trackedKeywords: [], storeLinks: [],
    updatedAt: new Date().toISOString(),
  });
  const gA = 'rank:projX:macos:macos:en:us';
  store.tasks.upsert({ id: 'projX:macos:en:us:app', title: '排名采集', intervalMinutes: 720, lastRunAt: '2026-09-03T00:00:00Z', nextRunAt: '2026-09-04T00:00:00Z', lastStatus: 'ok', lastSummary: 's', runCount: 3, source: 'electron', kind: 'rank', instance: { projectName: 'ai-pulse-macos', productId: 'projX:macos', keyword: 'app', queryLanguage: 'en', storefront: 'us', platform: 'macos', groupKey: gA } });
  store.tasks.upsert({ id: 'projX:macos:en:us:kw2', title: '排名采集', intervalMinutes: 720, lastRunAt: null, nextRunAt: null, lastStatus: 'never', lastSummary: null, runCount: 0, source: 'electron', kind: 'rank', instance: { projectName: 'ai-pulse-macos', productId: 'projX:macos', keyword: 'kw2', queryLanguage: 'en', storefront: 'us', platform: 'macos', groupKey: gA } });
  store.tasks.upsert({ id: 'github-sync:msszspx4', title: 'GitHub 发布同步', intervalMinutes: 60, lastRunAt: '2026-09-02T00:00:00Z', nextRunAt: '2026-09-03T00:00:00Z', lastStatus: 'error', lastSummary: 'e', runCount: 2, source: 'electron', kind: 'github-sync', instance: { projectId: 'msszspx4', projectName: 'GloWalk', path: '/x' } });

  const tasks = taskCenterTasksFromDb(store);
  assert.equal(tasks.length, 3);

  const rank = tasks.find((t) => t.id === 'projX:macos:en:us:app');
  assert.ok(rank, 'rank 行存在');
  assert.equal(rank.kind, 'rank');
  assert.equal(rank.lastStatus, 'success', 'ok → success（renderer 兼容）');
  assert.equal(rank.executionCount, 3);
  assert.equal(rank.enabled, true);
  assert.equal(rank.projectId, 'projX', 'productId 前缀推导 projectId');
  assert.equal(rank.projectName, 'ai-pulse-macos');
  assert.equal(rank.productName, 'AI Pulse', 'product_records trackName');
  assert.equal(rank.platform, 'macos');
  assert.deepEqual(rank.round, { done: 1, total: 2 }, 'round 由 DB rankProgress 计算');
  assert.equal(rank.keyword, 'app');

  const err = tasks.find((t) => t.id === 'github-sync:msszspx4');
  assert.equal(err?.lastStatus, 'failed', 'error → failed');
  assert.equal(err?.projectName, 'GloWalk');

  const ov = taskCenterOverviewFromDb(store);
  assert.equal(ov.total, 3);
  assert.equal(ov.overdue, 1, 'nextRunAt <= now');
  assert.equal(ov.executed, 2);
  assert.equal(ov.byKind['rank'], 2);
  assert.ok(ov.nextDueAt, '最近到期时间');

  store.close();
  console.log('task-center-db 单测全部通过 ✓');
}

main().catch((err) => {
  console.error('task-center-db 测试失败:', err);
  process.exit(1);
});
