/**
 * tasks 无损镜像单测：schema v12 enabled/electronJson 往返 + 引擎任务重建。
 * 纯 node（不 import electron）。
 */
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { openStore } from '@appilot-labs/appilot-headless';
import { toTaskRow, electronTaskFromRow, mirrorTasksToDb, backfillTaskHistoryFromExecutions } from '../src/main/task-db-sync';

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
    const expected = tasks.map((task) => ({
      ...task,
      lastRunAt: task.lastRunAt ?? null,
      nextRunAt: task.nextRunAt ?? null,
      executionCount: task.executionCount ?? 0,
      enabled: task.enabled !== false,
      lastStatus: task.lastRunAt ? 'success' : task.lastStatus === 'failed' ? 'failed' : 'never',
    }));
    assert.deepEqual(electron, expected, '富参数无损，调度状态按 DB 列规范化（顺序按 id）');
    store.close();
    console.log('✅ 引擎装载等价（DB 重建 = 原列表）');
  }

  // 4. 历史回填：executions → 无 lastRunAt 的 electron 任务行补历史（幂等/跳过已有）
  {
    const store = tempDb();
    const t1 = { id: 'rank:r1', intervalMinutes: 1440, nextRunAt: '2026-09-08T00:00:00Z' };
    const t2 = { id: 'rank:r2', intervalMinutes: 1440, nextRunAt: '2026-09-08T00:00:00Z' };
    mirrorTasksToDb(store, [t1, t2] as any[]);
    store.executions.add({ ts: '2026-09-06T10:00:00Z', taskId: 'rank:r1', status: 'success', durationMs: 100 });
    store.executions.add({ ts: '2026-09-06T11:00:00Z', taskId: 'rank:r1', status: 'success', durationMs: 90 });
    store.executions.add({ ts: '2026-09-06T12:00:00Z', taskId: 'rank:r2', status: 'failed', durationMs: 5 });
    const n = backfillTaskHistoryFromExecutions(store);
    assert.equal(n, 2, '两条无历史任务被回填');
    const g1 = store.tasks.get('rank:r1')!;
    assert.equal(g1.lastRunAt, '2026-09-06T11:00:00Z');
    assert.equal(g1.runCount, 2);
    assert.equal(g1.lastStatus, 'ok');
    const g2 = store.tasks.get('rank:r2')!;
    assert.equal(g2.lastStatus, 'error');
    // 幂等：再跑一次，无新补
    assert.equal(backfillTaskHistoryFromExecutions(store), 0, '已有历史的行不再补');
    store.close();
    console.log('✅ 历史回填（executions→任务行，幂等）');
  }

  console.log('tasks-lossless 单测全部通过 ✓');
}

main().catch((err) => {
  console.error('tasks-lossless 测试失败:', err);
  process.exit(1);
});
