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

  // —— kv schedulerRounds（引擎轮次状态）接入：真实本轮进度 + 上轮完成时间 ——
  store.kv.set('schedulerRounds', JSON.stringify({
    [gA]: {
      members: ['projX:macos:en:us:app', 'projX:macos:en:us:kw2', 'projX:macos:en:us:extra'],
      done: ['projX:macos:en:us:app'],
      roundStartedAt: '2026-09-01T08:00:00.000Z',
      lastCompletedAt: '2026-08-30T15:55:17.537Z',
    },
  }));
  const tasksKv = taskCenterTasksFromDb(store);
  const rankKv = tasksKv.find((t) => t.id === 'projX:macos:en:us:app');
  assert.deepEqual(
    rankKv?.round,
    { done: 1, total: 3, lastCompletedAt: '2026-08-30T15:55:17.537Z', roundStartedAt: '2026-09-01T08:00:00.000Z' },
    'kv 轮次状态优先于 rankProgress（含上轮完成时间，非累计成功数）',
  );
  // 同组其他成员行共享同一 kv 轮次状态。
  const tasksKv2 = taskCenterTasksFromDb(store);
  const rankKv2 = tasksKv2.find((t) => t.id === 'projX:macos:en:us:kw2');
  assert.deepEqual(
    rankKv2?.round,
    { done: 1, total: 3, lastCompletedAt: '2026-08-30T15:55:17.537Z', roundStartedAt: '2026-09-01T08:00:00.000Z' },
    '同组其他成员共享 kv 轮次状态',
  );
  store.kv.delete('schedulerRounds');

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

  // —— 镜像行（instance 为空）归项目 + firstRunAt 兜底 ——
  // 注册表补 id：ops-sync 镜像行只有 electronJson.projectId（= 注册表 id）可归属。
  store.projects.save({ name: 'GloWalk', id: 'msszspx4', path: '/x/glowalk', githubUrl: null, platform: null, languages: [], lastResolvedAt: d(0), artworkUrl: null, updatedAt: d(0) });
  // ops 历史执行：最早 08-10，用于 firstRunAt 兜底（electronJson.firstRunAt 为 null）。
  store.executions.add({ taskId: 'ops-sync:msszspx4', ts: '2026-08-10T08:00:00.000Z', status: 'success', durationMs: 120 });
  store.executions.add({ taskId: 'ops-sync:msszspx4', ts: '2026-08-11T08:00:00.000Z', status: 'success', durationMs: 90 });
  // 产品级镜像行：reviews-sync 带 productId（`projId:platform` 惯例）但从未执行。
  store.tasks.upsert({
    id: 'reviews-sync:msszspx4:ios', title: '评价同步', intervalMinutes: 1440, lastRunAt: null, nextRunAt: d(1), lastStatus: 'never', lastSummary: null, runCount: 0, source: 'electron',
    electronJson: JSON.stringify({ id: 'reviews-sync:msszspx4:ios', kind: 'reviews-sync', productId: 'msszspx4:ios', intervalMinutes: 1440, executionCount: 0, enabled: true }),
  });
  // 覆盖已有 ops-sync:msszspx4 行（补 electronJson 供归属/首次时间解析）。
  store.tasks.upsert({
    id: 'ops-sync:msszspx4', title: '数据同步', intervalMinutes: 1440, lastRunAt: d(-2), nextRunAt: null, lastStatus: 'ok', lastSummary: null, runCount: 2, source: 'electron',
    electronJson: JSON.stringify({ id: 'ops-sync:msszspx4', kind: 'ops-sync', projectId: 'msszspx4', intervalMinutes: 1440, lastRunAt: '2026-09-01T08:00:00.000Z', firstRunAt: null, executionCount: 2, lastStatus: 'success', enabled: true }),
  });

  const tasks3 = taskCenterTasksFromDb(store);
  const ops3 = tasks3.find((t) => t.id === 'ops-sync:msszspx4');
  assert.equal(ops3?.kind, 'ops-sync');
  assert.equal(ops3?.projectName, 'GloWalk', 'instance 为空的镜像行按 electronJson.projectId 归项目（不再显示已删除项目）');
  assert.equal(ops3?.productId, null, 'ops 为项目级任务（无 productId）');
  assert.equal(ops3?.firstRunAt, '2026-08-10T08:00:00.000Z', 'electronJson/instance 无 firstRunAt → 用最早执行时间兜底');
  const rev3 = tasks3.find((t) => t.id === 'reviews-sync:msszspx4:ios');
  assert.equal(rev3?.projectName, 'GloWalk', 'reviews-sync 按 productId 前缀归项目');
  assert.equal(rev3?.productId, 'msszspx4:ios');
  assert.equal(rev3?.platform, 'ios', 'productId 后缀推导平台（无 instance 时）');
  assert.equal(rev3?.firstRunAt, null, '从未执行的产品任务无首次时间');
  // 已执行任务仍优先 electronJson.firstRunAt（真实首次 > 执行记录兜底）
  store.tasks.upsert({
    id: 'build-status:msszspx4:ios', title: '构建状态', intervalMinutes: 60, lastRunAt: '2026-09-06T11:58:24.757Z', nextRunAt: null, lastStatus: 'ok', lastSummary: null, runCount: 1, source: 'electron',
    electronJson: JSON.stringify({ id: 'build-status:msszspx4:ios', kind: 'build-status', productId: 'msszspx4:ios', intervalMinutes: 60, lastRunAt: '2026-09-06T11:58:24.757Z', firstRunAt: '2026-09-06T11:58:24.757Z', executionCount: 1, lastStatus: 'success', enabled: true }),
  });
  const tasks4 = taskCenterTasksFromDb(store);
  const build4 = tasks4.find((t) => t.id === 'build-status:msszspx4:ios');
  assert.equal(build4?.firstRunAt, '2026-09-06T11:58:24.757Z', 'electronJson.firstRunAt 优先');
  assert.equal(build4?.projectName, 'GloWalk');

  store.close();
  console.log('task-center-db 单测全部通过 ✓');
}

main().catch((err) => {
  console.error('task-center-db 测试失败:', err);
  process.exit(1);
});
