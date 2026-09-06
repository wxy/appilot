/**
 * tasks 无损镜像单测：schema v12 enabled/electronJson 往返 + 引擎任务重建。
 * 纯 node（不 import electron）。
 */
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { openStore } from '@appilot-labs/appilot-headless';
import { toTaskRow, electronTaskFromRow, mirrorTasksToDb } from '../src/main/task-db-sync';

function tempDb() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'taskloss-'));
  return openStore(path.join(dir, 'app.db'));
}

async function main() {
  // 1. 富任务 → 行（enabled/electronJson）→ 无损重建
  {
    const store = tempDb();
    const task = {
      id: 'rank:ai:en:us:cost tracker',
      kind: 'rank',
      keyword: 'cost tracker',
      queryLanguage: 'en',
      storefront: 'us',
      intervalMinutes: 1440,
      nextRunAt: '2026-09-07T00:00:00Z',
      lastRunAt: '2026-09-06T00:00:00Z',
      executionCount: 3,
      lastStatus: 'success',
      enabled: false,
      extra: { groupKey: 'rank:ai:en:us' },
    };
    const row = toTaskRow(task as any);
    assert.ok(row);
    assert.equal(row.enabled, false);
    assert.ok(row.electronJson && row.electronJson.length > 20);

    store.tasks.upsert(row);
    const got = store.tasks.get(task.id)!;
    assert.equal(got.enabled, false, 'enabled 列往返');
    assert.equal(got.electronJson, row.electronJson, 'electronJson 列往返');

    const rebuilt = electronTaskFromRow(got);
    assert.deepEqual(rebuilt, task, 'electronJson 无损重建与原任务一致');
    store.close();
    console.log('✅ 富任务无损镜像 + 重建');
  }

  // 2. 无 electronJson 的旧行按列字段推导
  {
    const store = tempDb();
    const row = toTaskRow({ id: 'legacy', intervalMinutes: 60, nextRunAt: '2026-09-07T00:00:00Z' } as any)!;
    row.electronJson = null;
    store.tasks.upsert({ ...row, electronJson: null });
    const got = store.tasks.get('legacy')!;
    const derived = electronTaskFromRow(got);
    assert.equal(derived.id, 'legacy');
    assert.equal(derived.enabled, true);
    assert.equal(derived.intervalMinutes, 60);
    store.close();
    console.log('✅ 旧行按列推导');
  }

  // 3. 引擎装载等价：镜像任务列表 → DB 行 → 重建 = 原列表（DB-first 读取语义）
  {
    const store = tempDb();
    const tasks = [
      { id: 'a', kind: 'rank', keyword: 'k1', queryLanguage: 'en', storefront: 'us', intervalMinutes: 1440, nextRunAt: '2026-09-07T00:00:00Z', executionCount: 1, lastStatus: 'success', enabled: true },
      { id: 'b', intervalMinutes: 60, nextRunAt: '2026-09-08T00:00:00Z', executionCount: 2, lastStatus: 'success', enabled: false },
      { id: 'c', intervalMinutes: 300, lastRunAt: '2026-09-06T00:00:00Z', executionCount: 0, lastStatus: 'never', enabled: true },
    ];
    mirrorTasksToDb(store, tasks as any[]);
    const electron = store.tasks
      .all()
      .filter((r) => r.source === 'electron' && typeof r.electronJson === 'string' && r.electronJson)
      .map((r) => electronTaskFromRow(r))
      .filter((t) => t && typeof t.id === 'string');
    assert.equal(electron.length, tasks.length);
    assert.deepEqual(electron, tasks, 'DB 重建列表与引擎原列表一致（顺序按 id）');
    store.close();
    console.log('✅ 引擎装载等价（DB 重建 = 原列表）');
  }

  console.log('tasks-lossless 单测全部通过 ✓');
}

main().catch((err) => {
  console.error('tasks-lossless 测试失败:', err);
  process.exit(1);
});
