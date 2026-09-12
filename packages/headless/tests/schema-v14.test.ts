import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../src/store';

const dbPath = join(mkdtempSync(join(tmpdir(), 'appilot-v14-')), 'appilot.db');
const old = new DatabaseSync(dbPath);
old.exec(`
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  INSERT INTO meta VALUES ('schemaVersion', '13');
  CREATE TABLE projects (
    name TEXT PRIMARY KEY, id TEXT, path TEXT NOT NULL, githubUrl TEXT, platform TEXT,
    languages TEXT NOT NULL DEFAULT '[]', lastResolvedAt TEXT NOT NULL, artworkUrl TEXT, updatedAt TEXT NOT NULL);
  CREATE TABLE project_meta (
    projectName TEXT PRIMARY KEY, githubUrl TEXT, headSha TEXT, headDate TEXT, lastReleaseSha TEXT,
    branch TEXT, headMessage TEXT, dirty INTEGER, description TEXT, updatedAt TEXT NOT NULL);
  CREATE TABLE product_records (
    projectName TEXT NOT NULL, productId TEXT NOT NULL, platform TEXT, trackId INTEGER, bundleId TEXT,
    trackName TEXT, artworkUrl TEXT, supportedLanguages TEXT NOT NULL DEFAULT '[]',
    trackedKeywords TEXT NOT NULL DEFAULT '[]', storeLinks TEXT NOT NULL DEFAULT '[]',
    submissionKeywords TEXT NOT NULL DEFAULT '[]', removedKeywords TEXT NOT NULL DEFAULT '[]',
    updatedAt TEXT NOT NULL, PRIMARY KEY (projectName, productId));
  CREATE TABLE rank_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT, projectName TEXT NOT NULL, productId TEXT, keyword TEXT NOT NULL,
    language TEXT NOT NULL, storefront TEXT NOT NULL, rank INTEGER, totalResults INTEGER NOT NULL DEFAULT 0,
    checkedAt TEXT NOT NULL);
  CREATE TABLE project_release_cache (projectName TEXT PRIMARY KEY, cacheJson TEXT NOT NULL, syncedAt TEXT NOT NULL);
  CREATE TABLE project_blobs (
    domain TEXT NOT NULL, projectKey TEXT NOT NULL, json TEXT NOT NULL, updatedAt TEXT NOT NULL,
    PRIMARY KEY (domain, projectKey));
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, intervalMinutes INTEGER NOT NULL, lastRunAt TEXT, nextRunAt TEXT,
    lastStatus TEXT NOT NULL DEFAULT 'never', lastSummary TEXT, runCount INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'dsh', kind TEXT, instance TEXT, enabled INTEGER NOT NULL DEFAULT 1, electronJson TEXT);

  INSERT INTO projects VALUES ('Old Name', 'stable-1', '/x/old', NULL, 'ios', '["en"]', '2026-09-01T00:00:00Z', NULL, '2026-09-01T00:00:00Z');
  INSERT INTO project_meta VALUES ('Old Name', NULL, 'abc', NULL, NULL, 'main', NULL, 0, NULL, '2026-09-01T00:00:00Z');
  INSERT INTO product_records VALUES ('Old Name', 'stable-1:ios', 'ios', 123, 'xingyu.wang.demo', 'Demo', NULL, '["en"]', '[]', '[]', '[]', '[]', '2026-09-01T00:00:00Z');
  INSERT INTO rank_snapshots (projectName, productId, keyword, language, storefront, rank, totalResults, checkedAt)
    VALUES ('Old Name', 'stable-1:ios', 'demo', 'en', 'us', 2, 10, '2026-09-01T00:00:00Z');
  INSERT INTO project_release_cache VALUES ('Old Name', '{"tag":"v1"}', '2026-09-01T00:00:00Z');
  INSERT INTO project_blobs VALUES ('storeSubmissionDrafts', 'Old Name', '[{"id":"d1"}]', '2026-09-01T00:00:00Z');
  INSERT INTO tasks VALUES (
    'github-sync:Old Name', 'GitHub 发布同步', 60, NULL, NULL, 'never', NULL, 0, 'electron', 'github-sync',
    '{"projectName":"Old Name","path":"/x/old"}', 1,
    '{"id":"github-sync:Old Name","projectName":"Old Name"}');
`);
old.close();

const store = openStore(dbPath);
assert.equal(store.projects.get('Old Name')?.id, 'stable-1');
assert.equal(store.meta.get('Old Name')?.projectId, 'stable-1');
assert.equal(store.products.listByProject('Old Name')[0]?.projectId, 'stable-1');
assert.equal(store.snapshots.latestByKey('Old Name', 'stable-1:ios')[0]?.projectId, 'stable-1');
assert.equal(store.releaseCache.get('Old Name')?.cache.tag, 'v1');
assert.deepEqual(store.blobs.get('storeSubmissionDrafts', 'stable-1'), [{ id: 'd1' }]);
assert.equal(store.tasks.get('github-sync:Old Name'), undefined);
assert.equal(store.tasks.get('github-sync:stable-1')?.instance?.projectId, 'stable-1');

assert.equal(store.projects.rename('Old Name', 'New Name'), true);
assert.equal(store.meta.get('New Name')?.headSha, 'abc');
assert.equal(store.products.listByProject('New Name').length, 1);
assert.equal(store.snapshots.latestByKey('New Name', 'stable-1:ios').length, 1);
assert.equal(store.releaseCache.get('New Name')?.cache.tag, 'v1');
store.close();

const check = new DatabaseSync(dbPath);
const projectCols = check.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string; pk: number }>;
assert.equal(projectCols.find((c) => c.name === 'id')?.pk, 1, 'projects.id 必须是主键');
assert.equal(projectCols.find((c) => c.name === 'name')?.pk, 0, 'name 不再是主键');
for (const table of ['project_meta', 'product_records', 'rank_snapshots', 'project_release_cache']) {
  const cols = check.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  assert.ok(cols.some((c) => c.name === 'projectId'), `${table} 应引用 projectId`);
  assert.ok(!cols.some((c) => c.name === 'projectName'), `${table} 不应再持久化 projectName`);
}
assert.equal((check.prepare("SELECT value FROM meta WHERE key = 'schemaVersion'").get() as any).value, '15');
assert.equal((check.prepare('PRAGMA quick_check').get() as any).quick_check, 'ok');
assert.deepEqual(check.prepare('PRAGMA foreign_key_check').all(), []);
check.close();

console.log('schema v13→v14 stable project id migration passed ✓');
