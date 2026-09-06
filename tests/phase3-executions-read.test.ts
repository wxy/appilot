/**
 * rankExecutions 读侧切换与导入单测：latest 语义、唯一约束幂等、导入 helper。
 * 纯 node（不 import electron）。
 */
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { openStore } from '@appilot-labs/appilot-headless';
import { syncRankExecutionsToDb, RANK_EXEC_IMPORT_MARK } from '../src/main/sync-rank-executions';

function tempDb() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'exec2-'));
  return openStore(path.join(dir, 'app.db'));
}

function mk(ts: string, taskId: string, status = 'success'): Record<string, unknown> {
  return { ts, taskId, status, durationMs: 100 };
}

async function main() {
  // 1. latest：最近 N 条按升序返回（镜像 kv slice(-N)）
  {
    const store = tempDb();
    for (let i = 1; i <= 5; i++) {
      store.executions.add(mk(`2026-09-0${i}T00:00:00Z`, `t${i}`));
    }
    const latest = store.executions.latest(3);
    assert.equal(latest.length, 3);
    assert.equal((latest[0] as any).taskId, 't3', '升序（最早的保留段开头）');
    assert.equal((latest[2] as any).taskId, 't5');
    store.close();
    console.log('✅ latest：最近 N 条升序');
  }

  // 2. 唯一约束 (ts, taskId)：重复 add 幂等
  {
    const store = tempDb();
    store.executions.add(mk('2026-09-06T00:00:00Z', 't1'));
    store.executions.add(mk('2026-09-06T00:00:00Z', 't1')); // 同 ts+taskId → ignore
    store.executions.add(mk('2026-09-06T00:00:00Z', 't2')); // 不同 taskId → 新增
    assert.equal(store.executions.latest(10).length, 2);
    store.close();
    console.log('✅ 唯一约束幂等');
  }

  // 3. 导入 helper：kv 全量入 DB，重复调用幂等，标记由调用方管理
  {
    const store = tempDb();
    const kv = [mk('2026-09-01T00:00:00Z', 'a'), mk('2026-09-02T00:00:00Z', 'b'), mk('2026-09-03T00:00:00Z', 'a')];
    const n1 = syncRankExecutionsToDb(store, kv);
    assert.equal(n1, 3);
    const n2 = syncRankExecutionsToDb(store, kv); // 重复导入 → ignore
    assert.equal(n2, 3); // 尝试条数不变
    assert.equal(store.executions.latest(10).length, 3, '库内不重复');
    assert.equal(store.kv.get(RANK_EXEC_IMPORT_MARK), undefined, '标记由调用方写入');
    store.close();
    console.log('✅ 导入幂等（库内无重复）');
  }

  console.log('phase3-executions-read 单测全部通过 ✓');
}

main().catch((err) => {
  console.error('phase3-executions-read 测试失败:', err);
  process.exit(1);
});
