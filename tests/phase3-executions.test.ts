/**
 * rank 执行记录结构化（schema v9）单测：add/since/prune 与真实 headless store。
 * 纯 node（不 import electron）。
 */
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { openStore } from '@appilot-labs/appilot-headless';

function tempDb() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'exec-'));
  return openStore(path.join(dir, 'app.db'));
}

async function main() {
  // 1. add + since（窗口过滤、升序、原始字段保留）
  {
    const store = tempDb();
    store.executions.add({ ts: '2026-09-04T10:00:00Z', taskId: 't1', status: 'success', durationMs: 100, keyword: 'app' });
    store.executions.add({ ts: '2026-09-05T10:00:00Z', taskId: 't2', status: 'error', durationMs: 300 });
    store.executions.add({ ts: '2026-09-06T10:00:00Z', taskId: 't3', status: 'success', durationMs: 200 });

    const since = store.executions.since('2026-09-05T00:00:00Z');
    assert.equal(since.length, 2);
    assert.equal((since[0] as any).taskId, 't2');
    assert.equal((since[1] as any).taskId, 't3');
    assert.equal((since[0] as any).durationMs, 300);
    assert.equal((since[1] as any).keyword, undefined);
    // 未提列字段原样保留
    const full = store.executions.since('2026-09-04T00:00:00Z');
    assert.equal((full[0] as any).keyword, 'app');
    const summaries = store.executions.summaryByTask();
    assert.deepEqual(summaries, [
      { taskId: 't1', firstRunAt: '2026-09-04T10:00:00Z', lastRunAt: '2026-09-04T10:00:00Z', count: 1 },
      { taskId: 't2', firstRunAt: '2026-09-05T10:00:00Z', lastRunAt: '2026-09-05T10:00:00Z', count: 1 },
      { taskId: 't3', firstRunAt: '2026-09-06T10:00:00Z', lastRunAt: '2026-09-06T10:00:00Z', count: 1 },
    ]);
    store.close();
    console.log('✅ add + since + summaryByTask（窗口/升序/原字段保留/完整聚合）');
  }

  // 2. pruneBefore
  {
    const store = tempDb();
    store.executions.add({ ts: '2026-09-01T00:00:00Z', taskId: 'a', status: 'ok', durationMs: 1 });
    store.executions.add({ ts: '2026-09-05T00:00:00Z', taskId: 'b', status: 'ok', durationMs: 1 });
    const removed = store.executions.pruneBefore('2026-09-02T00:00:00Z');
    assert.equal(removed, 1);
    const left = store.executions.since('2026-01-01T00:00:00Z');
    assert.equal(left.length, 1);
    assert.equal((left[0] as any).taskId, 'b');
    store.close();
    console.log('✅ pruneBefore');
  }

  // 3. schema v9：rank_executions 表就绪、建表幂等（重复 open 不报错）
  {
    const store = tempDb();
    store.executions.add({ ts: '2026-09-06T00:00:00Z', taskId: 'x', status: 'success', durationMs: 5 });
    store.close();
    const store2 = openStore(store.path);
    const rows = store2.executions.since('2026-01-01T00:00:00Z');
    assert.equal(rows.length, 1);
    store2.close();
    console.log('✅ schema v9 就绪 + 重复打开幂等');
  }

  console.log('phase3-executions 单测全部通过 ✓');
}

main().catch((err) => {
  console.error('phase3-executions 测试失败:', err);
  process.exit(1);
});
