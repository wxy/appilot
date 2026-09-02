/**
 * rich-data-sync 单测：Electron 富数据（storeProducts/repo）→ 共享 DB 双写。
 * 纯 node（不 import electron），隔离 DB。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert';
import { openStore } from '@appilot-labs/appilot-headless';
import { toProductRows, toProjectMeta, syncRichDataToDb } from '../src/main/rich-data-sync';

function electronProject(): any {
  return {
    name: 'ai-pulse-macos',
    localPath: '/Users/dev/ai-pulse-macos',
    repo: { githubUrl: 'https://github.com/wxy/ai-pulse-macos', headSha: 'abc123', headDate: '2026-09-01T00:00:00Z' },
    lastReleaseSha: 'def456',
    storeProducts: [
      {
        id: 'proj1:macos',
        platform: 'macos',
        trackId: 123456,
        bundleId: 'com.demo',
        trackName: 'AI Pulse',
        artworkUrl: 'https://x/art.png',
        supportedLanguages: [{ code: 'en', name: 'English' }, { code: 'zh-Hans', name: '简体中文' }],
        trackedKeywords: [{ keyword: 'app', language: 'en', status: 'active' }],
        storeLinks: [{ platform: 'macos', url: 'https://apps.apple.com/us/app/x/id123456' }],
      },
      { id: 'proj1:ios', platform: 'ios', trackId: null, bundleId: null, trackName: null, artworkUrl: null, supportedLanguages: [], trackedKeywords: [], storeLinks: [] },
    ],
  };
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'rich-sync-test-'));

  // 1. v4→v5 迁移：旧库重开出现新表
  const dbPath = join(dir, 'migrate-v5.db');
  const v4 = new DatabaseSync(dbPath);
  v4.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, intervalMinutes INTEGER NOT NULL,
      lastRunAt TEXT, nextRunAt TEXT, lastStatus TEXT NOT NULL DEFAULT 'never',
      lastSummary TEXT, runCount INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'dsh',
      kind TEXT, instance TEXT);
    INSERT INTO meta (key, value) VALUES ('schemaVersion', '4');`);
  v4.close();
  const migrated = openStore(dbPath);
  migrated.meta.save({ projectName: 'p', githubUrl: null, headSha: null, headDate: null, lastReleaseSha: null, updatedAt: new Date().toISOString() });
  assert.ok(migrated.meta.get('p'), 'v4→v5 后 project_meta 可写');
  migrated.close();
  console.log('✓ schema v4→v5 migration（project_meta/product_records）');

  // 2. 映射：electron project → meta + products
  const p = electronProject();
  const m = toProjectMeta(p);
  assert.equal(m?.projectName, 'ai-pulse-macos');
  assert.equal(m?.githubUrl, 'https://github.com/wxy/ai-pulse-macos');
  assert.equal(m?.lastReleaseSha, 'def456');
  const rows = toProductRows(p);
  assert.equal(rows.length, 2);
  const mac = rows.find((r) => r.productId === 'proj1:macos');
  assert.equal(mac?.platform, 'macos');
  assert.equal(mac?.trackId, 123456);
  assert.deepEqual(mac?.supportedLanguages, ['en', 'zh-Hans']);
  assert.deepEqual(mac?.trackedKeywords, [{ keyword: 'app', language: 'en', status: 'active' }], 'trackedKeywords 对象保留');
  assert.deepEqual(mac?.storeLinks, [{ platform: 'macos', url: 'https://apps.apple.com/us/app/x/id123456' }]);
  console.log('✓ electron 富数据 → meta/product 行映射');

  // 3. 双写 + 读回（JSON 往返）
  const db2 = openStore(join(dir, 'appilot.db'));
  const res = syncRichDataToDb(db2, [p]);
  assert.deepEqual(res, { meta: 1, products: 2 });
  const back = db2.products.listByProject('ai-pulse-macos');
  assert.equal(back.length, 2);
  const macBack = back.find((r) => r.productId === 'proj1:macos');
  assert.deepEqual(macBack?.trackedKeywords, [{ keyword: 'app', language: 'en', status: 'active' }]);
  assert.equal(db2.meta.get('ai-pulse-macos')?.lastReleaseSha, 'def456');
  // 幂等覆盖更新（无重复行）
  syncRichDataToDb(db2, [p]);
  assert.equal(db2.products.listByProject('ai-pulse-macos').length, 2);
  console.log('✓ 双写 + JSON 往返 + 幂等');

  // 4. 无 name/localPath 项目跳过
  const skip = syncRichDataToDb(db2, [{ storeProducts: [] }]);
  assert.deepEqual(skip, { meta: 0, products: 0 });
  console.log('✓ 无效项目跳过');

  db2.close();
  console.log('rich-data-sync 单测全部通过 ✓');
}

main().catch((err) => {
  console.error('rich-data-sync 测试失败:', err);
  process.exit(1);
});
