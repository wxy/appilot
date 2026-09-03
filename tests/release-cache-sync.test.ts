/**
 * release-cache-sync 单测：Electron githubSyncCache → 共享 DB 发布缓存。
 * 纯 node（不 import electron），隔离 DB。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert';
import { openStore } from '@appilot-labs/appilot-headless';
import { syncReleaseCachesToDb } from '../src/main/release-cache-sync';

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'rel-cache-test-'));

  // 1. v5→v6 迁移：旧库重开出现 project_release_cache
  const dbPath = join(dir, 'migrate-v6.db');
  const v5 = new DatabaseSync(dbPath);
  v5.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, intervalMinutes INTEGER NOT NULL,
      lastRunAt TEXT, nextRunAt TEXT, lastStatus TEXT NOT NULL DEFAULT 'never',
      lastSummary TEXT, runCount INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'dsh');
    INSERT INTO meta (key, value) VALUES ('schemaVersion', '5');`);
  v5.close();
  const migrated = openStore(dbPath);
  migrated.releaseCache.save('p', { tag: 'v1' });
  assert.equal(migrated.releaseCache.get('p')?.cache.tag, 'v1', 'v5→v6 后 releaseCache 可写');
  migrated.close();
  console.log('✓ schema v5→v6 migration（project_release_cache）');

  // 2. 映射同步：cacheByProjectId → DB（projectName 维度）
  const store = openStore(join(dir, 'appilot.db'));
  const projects = [
    { id: 'projA-id', name: 'ai-pulse-macos' },
    { id: 'projB-id', name: 'GloWalk' },
    { name: 'no-id' }, // 缺 id → 跳过
  ];
  const cacheByProjectId = {
    'projA-id': { tag: 'v1.2.8', releases: [{ tag: 'v1.2.8', draft: false }], pullRequests: [], repoCapabilities: { push: true }, lastSeenSha: 'abc', syncedAt: '2026-09-02T00:00:00Z' },
    'projB-id': { tag: 'v0.4.4', releases: [], pullRequests: [], repoCapabilities: null, lastSeenSha: null, syncedAt: '2026-09-02T00:00:00Z' },
  };
  const n = syncReleaseCachesToDb(store, projects as any, cacheByProjectId as any);
  assert.equal(n, 2, '应同步 2 个有 id 项目的缓存');
  const a = store.releaseCache.get('ai-pulse-macos');
  assert.equal(a?.cache.tag, 'v1.2.8');
  assert.deepEqual(a?.cache.releases, [{ tag: 'v1.2.8', draft: false }], 'releases 数组 JSON 保留');
  assert.equal(a?.syncedAt, '2026-09-02T00:00:00Z', 'syncedAt 应保留条目自带时间（非 now）');
  assert.equal(store.releaseCache.get('no-id'), undefined);
  // 幂等覆盖更新
  syncReleaseCachesToDb(store, projects as any, { 'projA-id': { tag: 'v1.3.0', releases: [], pullRequests: [], repoCapabilities: null, lastSeenSha: 'x', syncedAt: '2026-09-02T06:00:00Z' } } as any);
  assert.equal(store.releaseCache.get('ai-pulse-macos')?.cache.tag, 'v1.3.0', '覆盖更新');
  assert.equal(store.releaseCache.get('ai-pulse-macos')?.syncedAt, '2026-09-02T06:00:00Z', '覆盖后 syncedAt 仍取条目值');
  console.log('✓ cacheByProjectId → DB 映射 + 幂等覆盖 + syncedAt 保留');

  store.close();
  console.log('release-cache-sync 单测全部通过 ✓');
}

main().catch((err) => {
  console.error('release-cache-sync 测试失败:', err);
  process.exit(1);
});
