/**
 * task-db-sync 单测：Electron 调度任务状态 → 共享 SQLite tasks 表镜像。
 * 纯 node（不 import electron），临时 DB 验证映射与字段语义。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert';
import { openStore } from '@appilot-labs/appilot-headless';
import { mirrorTasksToDb, toTaskRow } from '../src/main/task-db-sync';

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

  // 5. 镜像 + 幂等（同 id upsert 不重复行）
  const n = mirrorTasksToDb(store, [rankTask, failed, neverRun, disabled, { id: 'x' }] as any);
  assert.equal(n, 4, `应镜像 4 行（1 非法跳过），实际 ${n}`);
  const all = store.tasks.all();
  assert.equal(all.length, 4, `tasks 表应 4 行，实际 ${all.length}`);
  mirrorTasksToDb(store, [rankTask] as any);
  assert.equal(store.tasks.all().length, 4, '重复镜像不应新增行');
  const mirroredRank = store.tasks.get('prod-x:macos:app:en:us');
  assert.equal(mirroredRank?.runCount, 5);
  console.log('✓ 镜像幂等 upsert');

  // 6. DSH 静态任务不被污染：release-sync/readiness 之外没有新「定义」
  const ids = store.tasks.all().map((t) => t.id);
  assert.ok(ids.every((id) => !id.startsWith('release') || id === 'release-sync'));
  console.log('✓ 共享 tasks 镜像不与 headless 任务冲突');

  store.close();
  console.log('task-db-sync 单测全部通过 ✓');
}

main().catch((err) => {
  console.error('task-db-sync 测试失败:', err);
  process.exit(1);
});
