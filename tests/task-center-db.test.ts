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

  store.projects.save({ name: 'ai-pulse-macos', path: '/x/ai-pulse-macos', githubUrl: null, platform: 'macos', languages: [], lastResolvedAt: new Date().toISOString(), artworkUrl: null, updatedAt: new Date().toISOString() });
  // 产品（Electron 双写）供 productName 查询
  store.products.upsert({
    projectName: 'ai-pulse-macos', productId: 'projX:macos', platform: 'macos',
    trackId: 123, bundleId: 'com.x', trackName: 'AI Pulse', artworkUrl: null,
    supportedLanguages: ['en'], trackedKeywords: [], storeLinks: [],
    updatedAt: new Date().toISOString(),
  });
  const gA = 'rank:projX:macos:macos:en:us';
  // 时间用相对值（now 偏移）——固定日期会随真实时钟老化导致 overdue 断言漂移。
  const d = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
  // 关键：rank instance 不带 projectName（Electron sync 现状）——归项目靠 DB product 索引
  store.tasks.upsert({ id: 'projX:macos:en:us:app', title: '排名采集', intervalMinutes: 720, lastRunAt: d(-1), nextRunAt: d(1), lastStatus: 'ok', lastSummary: 's', runCount: 3, source: 'electron', kind: 'rank', instance: { productId: 'projX:macos', keyword: 'app', queryLanguage: 'en', storefront: 'us', platform: 'macos', groupKey: gA } });
  store.tasks.upsert({ id: 'projX:macos:en:us:kw2', title: '排名采集', intervalMinutes: 720, lastRunAt: null, nextRunAt: null, lastStatus: 'never', lastSummary: null, runCount: 0, source: 'electron', kind: 'rank', instance: { productId: 'projX:macos', keyword: 'kw2', queryLanguage: 'en', storefront: 'us', platform: 'macos', groupKey: gA } });
  store.tasks.upsert({ id: 'github-sync:msszspx4', title: 'GitHub 发布同步', intervalMinutes: 60, lastRunAt: d(-2), nextRunAt: d(-1), lastStatus: 'error', lastSummary: 'e', runCount: 2, source: 'electron', kind: 'github-sync', instance: { projectId: 'msszspx4', projectName: 'GloWalk', path: '/x' } });

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

  // kind-null 镜像行（Electron ops/reviews/build-status）按 id 前缀推断
  store.tasks.upsert({ id: 'ops-sync:msszspx4', title: '数据同步', intervalMinutes: 1440, lastRunAt: d(-2), nextRunAt: null, lastStatus: 'ok', lastSummary: null, runCount: 1, source: 'electron' });
  const tasks2 = taskCenterTasksFromDb(store);
  const ops = tasks2.find((t) => t.id === 'ops-sync:msszspx4');
  assert.equal(ops?.kind, 'ops-sync', 'kind-null 镜像行按 id 推断类型');

  const ov = taskCenterOverviewFromDb(store);
  assert.equal(ov.total, 4);
  assert.equal(ov.overdue, 1, 'nextRunAt <= now');
  assert.equal(ov.executed, 3);
  assert.equal(ov.byKind['rank'], 2);
  assert.equal(ov.byKind['ops-sync'], 1);
  assert.ok(ov.nextDueAt, '最近到期时间');

  store.close();
  console.log('task-center-db 单测全部通过 ✓');
}

main().catch((err) => {
  console.error('task-center-db 测试失败:', err);
  process.exit(1);
});
