/**
 * task-db-sync 单测：Electron 调度任务状态 → 共享 SQLite tasks 表镜像。
 * 纯 node（不 import electron），临时 DB 验证映射与字段语义。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert';
import { openStore } from '@appilot-labs/appilot-headless';
import { mirrorTasksToDb, toTaskRow, electronTaskFromRow, clearElectronFailures, purgeOrphanProjectTasks, backfillTaskHistoryOnce, TASK_HISTORY_BACKFILL_MARK } from '../src/main/task-db-sync';

async function main(): Promise<void> {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'task-db-sync-test-')), 'appilot.db');
  const store = openStore(dbPath);

  // 1. 合法 rank 任务 → ok 状态行
  const rankTask = {
    id: 'prod-x:macos:app:en:us',
    kind: 'rank',
    keyword: 'app',
    queryLanguage: 'en',
    storefront: 'us',
    intervalMinutes: 720,
    lastRunAt: '2026-09-01T10:00:00Z',
    nextRunAt: '2026-09-02T10:00:00Z',
    executionCount: 5,
    lastStatus: 'success',
    enabled: true,
  };
  const row = toTaskRow(rankTask as any);
  assert.equal(row?.title, '排名采集: app @ us (en)');
  assert.equal(row?.lastStatus, 'ok');
  assert.equal(row?.runCount, 5);
  assert.equal(row?.intervalMinutes, 720);
  console.log('✓ toTaskRow rank 任务');

  // 2. failed → error；无 lastRunAt → never
  const failed = toTaskRow({
    id: 't1', kind: 'github-sync', intervalMinutes: 60,
    executionCount: 2, lastStatus: 'failed', enabled: true,
  } as any);
  assert.equal(failed?.lastStatus, 'error');
  assert.equal(failed?.title, 'GitHub 发布同步');
  const neverRun = toTaskRow({
    id: 't2', kind: 'ops-sync', intervalMinutes: 1440,
    executionCount: 0, lastStatus: undefined, enabled: true,
  } as any);
  assert.equal(neverRun?.lastStatus, 'never');
  console.log('✓ 状态映射 success→ok / failed→error / 未跑→never');

  // 3. 停用任务 → title 后缀
  const disabled = toTaskRow({
    id: 't3', kind: 'build-status', intervalMinutes: 60,
    executionCount: 0, enabled: false,
  } as any);
  assert.ok(disabled?.title.endsWith('（已停用）'));
  console.log('✓ 停用标记');

  // 4. 非法任务跳过
  assert.equal(toTaskRow({ id: 42, intervalMinutes: 60 } as any), null);
  assert.equal(toTaskRow({ id: 'x', intervalMinutes: 'bad' } as any), null);
  assert.equal(toTaskRow(null as any), null);
  console.log('✓ 非法行跳过');

  // 5. 镜像 + 幂等（同 id upsert 不重复行）+ source 标记
  const first = mirrorTasksToDb(store, [rankTask, failed, neverRun, disabled, { id: 'x' }] as any);
  assert.deepEqual(first, { mirrored: 4, pruned: 0 }, `应镜像 4 行（1 非法跳过），实际 ${JSON.stringify(first)}`);
  let all = store.tasks.all();
  assert.equal(all.length, 4, `tasks 表应 4 行，实际 ${all.length}`);
  assert.ok(all.every((t) => t.source === 'electron'), '镜像行应标 source=electron');
  const again = mirrorTasksToDb(store, [rankTask] as any);
  assert.deepEqual(again, { mirrored: 1, pruned: 3 }, '重复镜像不新增行；源中缺失的 3 行被清理');
  all = store.tasks.all();
  assert.equal(all.length, 1, `清理后应只剩 rankTask 1 行，实际 ${all.length}`);
  const mirroredRank = store.tasks.get('prod-x:macos:app:en:us');
  assert.equal(mirroredRank?.runCount, 5);
  // DB 列是调度状态真相：daemon 更新列后，重建不能被旧 electronJson 状态盖回去。
  store.tasks.upsert({
    ...mirroredRank!, lastRunAt: '2026-09-03T00:00:00Z', nextRunAt: '2026-09-04T00:00:00Z',
    lastStatus: 'error', lastSummary: 'upstream failed', runCount: 6,
  });
  const rebuilt = electronTaskFromRow(store.tasks.get('prod-x:macos:app:en:us'));
  assert.equal(rebuilt.lastRunAt, '2026-09-03T00:00:00Z');
  assert.equal(rebuilt.lastStatus, 'failed');
  assert.equal(rebuilt.executionCount, 6);
  assert.equal(rebuilt.lastSummary, 'upstream failed');
  console.log('✓ 镜像幂等 upsert + source 标记 + 幽灵行清理');

  // 6. DSH 静态任务不被污染/不被误清
  store.tasks.upsert({ id: 'release-sync', title: '发布同步', intervalMinutes: 60, lastRunAt: null, nextRunAt: null, lastStatus: 'never', lastSummary: null, runCount: 0, source: 'dsh' });
  const withDsh = mirrorTasksToDb(store, [rankTask] as any);
  assert.equal(withDsh.pruned, 0, 'DSH 行不应被清理');
  assert.equal(store.tasks.all().length, 2, 'DSH 行应保留');
  console.log('✓ DSH 静态任务行不受镜像清理影响');

  // 7. P1：kind 非空的 electron 实例行（reconcile 管理）不被镜像 prune
  store.tasks.upsert({ id: 'github-sync:p1', title: 'GitHub 发布同步', intervalMinutes: 60, lastRunAt: '2026-09-01T00:00:00Z', nextRunAt: '2026-09-02T00:00:00Z', lastStatus: 'ok', lastSummary: 's', runCount: 2, source: 'electron', kind: 'github-sync', instance: { projectId: 'p1', projectName: 'p1', path: '/x/p1' } });
  const withKind = mirrorTasksToDb(store, [rankTask] as any);
  assert.equal(withKind.pruned, 0, 'kind 实例行不应被镜像清理（源里没有也保留）');
  assert.ok(store.tasks.get('github-sync:p1'), '实例行应保留');
  console.log('✓ kind 实例行不受镜像 prune 影响（P1）');

  // 8. 清除失败（双源修复的 electron 源侧）：failed → 无状态；reschedule 摊铺
  const failedTasks = [
    { id: 't1', kind: 'rank', intervalMinutes: 720, nextRunAt: '2026-09-05T00:00:00Z', lastRunAt: '2026-09-04T00:00:00Z', lastStatus: 'failed' },
    { id: 't2', kind: 'rank', intervalMinutes: 720, nextRunAt: '2026-09-05T00:00:00Z', lastStatus: 'failed' },
    { id: 'ok1', kind: 'rank', intervalMinutes: 720, lastStatus: 'success' },
  ] as any;
  const cleared = clearElectronFailures(failedTasks, 'clear');
  assert.equal(cleared.cleared, 2, 'clear 应清除 2 个 failed');
  assert.equal(cleared.tasks[0].lastStatus, undefined, 'failed 状态应清除');
  assert.equal(cleared.tasks[0].lastRunAt, undefined, 'lastRunAt 应清除（防 mirror 误标 ok）');
  assert.equal(cleared.tasks[0].nextRunAt, '2026-09-05T00:00:00Z', 'clear 保留原排期');
  assert.equal(cleared.tasks[2].lastStatus, 'success', '非 failed 行不动');
  // reschedule：nextRunAt 落到未来 30–210min 窗口
  const rs = clearElectronFailures(failedTasks, 'reschedule');
  assert.equal(rs.cleared, 2);
  for (const t of rs.tasks) {
    if (t.id === 'ok1') continue;
    const ms = new Date(t.nextRunAt as string).getTime() - Date.now();
    assert.ok(ms >= 30 * 60_000 && ms <= 210 * 60_000, `重排应在 30–210min: ${t.id} ${ms}`);
  }
  // 清除后镜像映射 → DB 不再出现 failed/error
  const dbRow = toTaskRow(cleared.tasks[0]);
  assert.equal(dbRow?.lastStatus, 'never', '清除后 mirror 映射为 never');
  console.log('✓ clearElectronFailures（clear/reschedule/镜像映射）');

  // 9. 孤儿任务清理：引用已删除项目/产品的行删除；活项目行与无引用静态行保留
  const purgeStore = openStore(join(mkdtempSync(join(tmpdir(), 'task-purge-')), 'appilot.db'));
  purgeStore.projects.save({ name: 'GloWalk', id: 'p1', path: '/x/glowalk', githubUrl: null, platform: null, languages: [], lastResolvedAt: '2026-09-01T00:00:00Z', artworkUrl: null, updatedAt: '2026-09-01T00:00:00Z' });
  purgeStore.products.upsert({
    projectName: 'GloWalk', productId: 'p1:ios', platform: 'ios', trackId: 1, bundleId: 'com.g', trackName: 'Glow', artworkUrl: null,
    supportedLanguages: ['en'], trackedKeywords: [], storeLinks: [], updatedAt: '2026-09-01T00:00:00Z',
  });
  purgeStore.tasks.upsert({ id: 'github-sync:demo', title: 'GitHub 发布同步', intervalMinutes: 60, lastRunAt: '2026-09-04T05:27:17.421Z', nextRunAt: null, lastStatus: 'ok', lastSummary: null, runCount: 18, source: 'dsh', kind: 'github-sync', instance: { projectName: 'demo', path: '/path/to/git-repo' } });
  purgeStore.tasks.upsert({ id: 'github-sync:GloWalk', title: 'GitHub 发布同步', intervalMinutes: 60, lastRunAt: '2026-09-04T05:27:17.421Z', nextRunAt: null, lastStatus: 'ok', lastSummary: null, runCount: 18, source: 'dsh', kind: 'github-sync', instance: { projectId: 'p1', projectName: 'GloWalk', path: '/x/glowalk' } });
  purgeStore.tasks.upsert({ id: 'ops-sync:p1', title: '数据同步', intervalMinutes: 1440, lastRunAt: '2026-09-06T10:35:09.238Z', nextRunAt: null, lastStatus: 'ok', lastSummary: null, runCount: 11, source: 'electron', electronJson: JSON.stringify({ id: 'ops-sync:p1', kind: 'ops-sync', projectId: 'p1', intervalMinutes: 1440, executionCount: 11, lastStatus: 'success', enabled: true }) });
  purgeStore.tasks.upsert({ id: 'reviews-sync:ghost:ios', title: '评价同步', intervalMinutes: 1440, lastRunAt: null, nextRunAt: null, lastStatus: 'never', lastSummary: null, runCount: 0, source: 'electron', electronJson: JSON.stringify({ id: 'reviews-sync:ghost:ios', kind: 'reviews-sync', productId: 'ghost:ios', intervalMinutes: 1440, executionCount: 0, enabled: true }) });
  purgeStore.tasks.upsert({ id: 'static-1', title: '静态任务', intervalMinutes: 60, lastRunAt: null, nextRunAt: null, lastStatus: 'never', lastSummary: null, runCount: 0, source: 'cli' });
  // 注册表为空 → 不删（首启保护）
  const emptyStore = openStore(join(mkdtempSync(join(tmpdir(), 'task-purge-empty-')), 'appilot.db'));
  emptyStore.tasks.upsert({ id: 'github-sync:demo', title: 'GitHub 发布同步', intervalMinutes: 60, lastRunAt: null, nextRunAt: null, lastStatus: 'never', lastSummary: null, runCount: 0, source: 'dsh', kind: 'github-sync', instance: { projectName: 'demo', path: '/path/to/git-repo' } });
  assert.deepEqual(purgeOrphanProjectTasks(emptyStore), [], '注册表为空时跳过清理');
  emptyStore.close();

  const removed = purgeOrphanProjectTasks(purgeStore);
  assert.equal(removed.length, 2, `应清理 2 个孤儿任务（demo + ghost 产品），实际 ${JSON.stringify(removed)}`);
  assert.ok(removed.includes('github-sync:demo'), 'demo 项目残留任务应被清理');
  assert.ok(removed.includes('reviews-sync:ghost:ios'), '已删产品/项目的镜像任务应被清理');
  assert.ok(purgeStore.tasks.get('github-sync:GloWalk'), '活项目 github-sync 行保留');
  assert.ok(purgeStore.tasks.get('ops-sync:p1'), '活项目 ops-sync 镜像行保留');
  assert.ok(purgeStore.tasks.get('static-1'), '无项目引用的静态行保留');
  // 幂等：再次执行不再删
  assert.deepEqual(purgeOrphanProjectTasks(purgeStore), [], '二次清理应为空（幂等）');
  purgeStore.close();
  console.log('✓ purgeOrphanProjectTasks（孤儿清理/注册表保护/幂等）');

  // 10. 历史回填「只跑一次」守卫：清除失败后重启不再被 executions 历史复活
  const bf = openStore(join(mkdtempSync(join(tmpdir(), 'task-backfill-once-')), 'appilot.db'));
  // seed：electron 镜像行、无 lastRunAt（= 用户刚「清除失败」后的状态），但其
  // taskId 在 rank_executions 里留有 failed 历史——旧代码每次启动都会把它复活。
  const seedJson = { id: 'rank:resurrect', kind: 'rank', intervalMinutes: 1440 };
  bf.tasks.upsert({
    id: 'rank:resurrect', title: '排名采集', intervalMinutes: 1440, lastRunAt: null,
    nextRunAt: null, lastStatus: 'never', lastSummary: null, runCount: 0,
    source: 'electron', electronJson: JSON.stringify(seedJson),
  });
  bf.executions.add({ ts: '2026-09-08T09:34:00Z', taskId: 'rank:resurrect', status: 'failed', durationMs: 246, entryJson: '{}' });

  // 首次调用：回填 failed 历史（旧行为本身）+ 置「只跑一次」标记
  const n1 = backfillTaskHistoryOnce(bf);
  assert.equal(n1, 1, '首次应回填 1 行历史');
  assert.equal(bf.tasks.get('rank:resurrect')?.lastStatus, 'error', '旧行为：failed 历史被填回 error');
  const mark = bf.kv.get(TASK_HISTORY_BACKFILL_MARK);
  assert.ok(mark && !Number.isNaN(Date.parse(mark)), '首次后应写入标记（ISO）');

  // 用户再次「清除失败」（置空状态/lastRunAt + 清理 electronJson）……
  bf.tasks.upsert({
    id: 'rank:resurrect', title: '排名采集', intervalMinutes: 1440, lastRunAt: null,
    nextRunAt: null, lastStatus: 'never', lastSummary: null, runCount: 0,
    source: 'electron', electronJson: JSON.stringify(seedJson),
  });
  // ……重启后第二次调用：标记已存在 → 直接跳过，不再复活
  const n2 = backfillTaskHistoryOnce(bf);
  assert.equal(n2, 0, '标记存在 → 跳过回填');
  assert.equal(bf.tasks.get('rank:resurrect')?.lastStatus, 'never', '清除后重启不再被 failed 历史复活');
  bf.close();
  console.log('✓ backfillTaskHistoryOnce（只跑一次：清除后重启不复活）');

  store.close();
  console.log('task-db-sync 单测全部通过 ✓');
}

main().catch((err) => {
  console.error('task-db-sync 测试失败:', err);
  process.exit(1);
});
