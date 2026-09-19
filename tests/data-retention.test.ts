/**
 * data-retention 单测：纯函数口径 + 临时 SQLite 的 DB 删除行为。
 * 纯 node（不 import electron），与 rank-db-sync.test 同模式。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import {
  deleteExpiredRankSnapshots,
  pruneDatedRows,
  rankRetentionCutoffIso,
} from '../packages/core/src/data-retention';
import { runDataRetention } from '../src/main/data-retention';

async function main(): Promise<void> {
  const NOW = Date.parse('2026-09-18T12:00:00.000Z');
  const DAY = 86400000;
  const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

  // ── 纯函数：pruneDatedRows ──
  const rows = [
    { checkedAt: at(400) }, // 过期
    { checkedAt: at(100) }, // 保留
    { checkedAt: at(1) },   // 保留
    { checkedAt: undefined }, // 无时间 → 保留（宁多留勿误删）
    { checkedAt: 'not-a-date' }, // 不可解析 → 保留
    null as unknown as { checkedAt: string }, // 畸形行 → 保留
  ];
  const cutoff = rankRetentionCutoffIso(NOW, 180);
  assert.equal(cutoff, new Date(NOW - 180 * DAY).toISOString(), 'cutoff 计算');
  const { kept, removed } = pruneDatedRows(rows, cutoff);
  assert.equal(removed.length, 1, '只删 400 天前的行');
  assert.equal(kept.length, 5, '其余全部保留');

  // 空输入
  assert.deepEqual(pruneDatedRows([], cutoff), { kept: [], removed: [] });
  assert.deepEqual(pruneDatedRows(null, cutoff), { kept: [], removed: [] });

  // 保留期为 0 → 全部视为未过期（截止时间 = now，恰好等于 now 的行保留）
  const cutoffZero = rankRetentionCutoffIso(NOW, 0);
  assert.deepEqual(pruneDatedRows([{ checkedAt: at(0) }], cutoffZero).removed.length, 0);

  // ── DB：临时 SQLite 走 deleteExpiredRankSnapshots ──
  const dbPath = join(mkdtempSync(join(tmpdir(), 'data-retention-test-')), 'appilot.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE IF NOT EXISTS rank_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT, projectId TEXT, productId TEXT,
    keyword TEXT, language TEXT, storefront TEXT, rank INTEGER,
    totalResults INTEGER DEFAULT 0, checkedAt TEXT)`);
  const insert = db.prepare(
    'INSERT INTO rank_snapshots (productId, keyword, language, storefront, rank, totalResults, checkedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  insert.run('prod1', 'old', 'en', 'us', 5, 200, at(400));
  insert.run('prod1', 'new', 'en', 'us', 8, 200, at(2));

  const removedDb = deleteExpiredRankSnapshots(db, rankRetentionCutoffIso(NOW, 180));
  assert.equal(removedDb, 1, '只删过期行');
  const left = db.prepare('SELECT keyword FROM rank_snapshots ORDER BY keyword').all() as { keyword: string }[];
  assert.deepEqual(left.map((r) => r.keyword), ['new'], 'fresh 行保留');

  db.close();

  // ── kv 侧 runDataRetention：全链（mock store.set 记录写入）──
  const writes: unknown[] = [];
  const kvStore = {
    get: (key: string) => (key === 'projects' ? [{ id: 'p1', storeProducts: [{ id: 'prod1', rankSnapshots: [{ checkedAt: at(400) }, { checkedAt: at(2) }] }] }] : undefined),
    set: (key: string, value: unknown) => {
      if (key === 'projects') writes.push(value);
    },
  } as any;
  const result = runDataRetention(kvStore, NOW);
  assert.equal(result.removedKv, 1, 'kv 侧剪除过期行');
  assert.equal(writes.length, 1, '有剪除才落盘');

  console.log('🎉 All data-retention tests passed!');
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
