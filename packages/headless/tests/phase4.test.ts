import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openStore } from "../src/store";
import { createHeadlessService } from "../src/service";

const dir = mkdtempSync(join(tmpdir(), "headless-p4-"));
let failures = 0;
const pass = (n: string) => console.log(`✅ PASS: ${n}`);
const fail = (n: string, e: unknown) => {
  failures += 1;
  console.error(`❌ FAIL: ${n} — ${e instanceof Error ? e.message : String(e)}`);
};

/* v1→v2 迁移：手工建 v1 库（无 productId），重开应加列并升级版本 */
try {
  const dbPath = join(dir, "migrate.db");
  const v1 = new DatabaseSync(dbPath);
  v1.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE rank_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      projectName TEXT NOT NULL,
      keyword TEXT NOT NULL,
      language TEXT NOT NULL,
      storefront TEXT NOT NULL,
      rank INTEGER,
      totalResults INTEGER NOT NULL DEFAULT 0,
      checkedAt TEXT NOT NULL);
    CREATE TABLE projects (
      name TEXT PRIMARY KEY, path TEXT NOT NULL, githubUrl TEXT, platform TEXT,
      languages TEXT NOT NULL DEFAULT '[]', lastResolvedAt TEXT NOT NULL,
      artworkUrl TEXT, updatedAt TEXT NOT NULL);
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, intervalMinutes INTEGER NOT NULL,
      lastRunAt TEXT, nextRunAt TEXT, lastStatus TEXT NOT NULL DEFAULT 'never',
      lastSummary TEXT, runCount INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE lease (
      id INTEGER PRIMARY KEY CHECK (id = 1), leaderId TEXT NOT NULL, heartbeatAt TEXT NOT NULL);
    INSERT INTO meta (key, value) VALUES ('schemaVersion', '1');`);
  v1.close();
  const store = openStore(dbPath);
  const cols = (store as any)._pragma?.() ?? [];
  // 通过插入带 productId 的行验证列存在
  store.snapshots.add([{ projectName: "x", productId: "p1", keyword: "k", language: "en", storefront: "us", rank: 1, totalResults: 10, checkedAt: "2026-09-01T00:00:00.000Z" }]);
  const latest = store.snapshots.latestByKey("x", "p1");
  assert.equal(latest.length, 1);
  assert.equal(latest[0].productId, "p1");
  store.close();
  pass("schema v1→v2 migration adds productId");
} catch (e) {
  fail("schema v1→v2 migration adds productId", e);
}

/* v2→v3 迁移：手工建 v2 库（tasks 无 source），重开应加列、默认 'dsh' 并升级版本 */
try {
  const dbPath = join(dir, "migrate-v3.db");
  const v2 = new DatabaseSync(dbPath);
  v2.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, intervalMinutes INTEGER NOT NULL,
      lastRunAt TEXT, nextRunAt TEXT, lastStatus TEXT NOT NULL DEFAULT 'never',
      lastSummary TEXT, runCount INTEGER NOT NULL DEFAULT 0);
    INSERT INTO meta (key, value) VALUES ('schemaVersion', '2');`);
  v2.close();
  const store = openStore(dbPath);
  // 既有行默认 source='dsh'
  store.tasks.upsert({ id: "release-sync", title: "发布同步", intervalMinutes: 60, lastRunAt: null, nextRunAt: null, lastStatus: "never", lastSummary: null, runCount: 0 });
  assert.equal(store.tasks.get("release-sync")?.source, "dsh", "既有行默认 source=dsh");
  // 新行可写 electron 来源 + remove
  store.tasks.upsert({ id: "e:1", title: "排名采集", intervalMinutes: 60, lastRunAt: null, nextRunAt: null, lastStatus: "never", lastSummary: null, runCount: 0, source: "electron" });
  assert.equal(store.tasks.get("e:1")?.source, "electron");
  assert.equal(store.tasks.remove("e:1"), true);
  assert.equal(store.tasks.get("e:1"), undefined);
  store.close();
  pass("schema v2→v3 migration adds tasks.source");
} catch (e) {
  fail("schema v2→v3 migration adds tasks.source", e);
}

/* productId 过滤：同项目不同产品互不串 */
try {
  const store = openStore(join(dir, "prod.db"));
  store.snapshots.add([
    { projectName: "app", productId: "ios", keyword: "kw", language: "en", storefront: "us", rank: 1, totalResults: 10, checkedAt: "2026-09-01T00:00:00.000Z" },
    { projectName: "app", productId: "mac", keyword: "kw", language: "en", storefront: "us", rank: 5, totalResults: 10, checkedAt: "2026-09-01T00:00:00.000Z" },
    { projectName: "app", keyword: "kw", language: "en", storefront: "us", rank: 9, totalResults: 10, checkedAt: "2026-09-01T00:00:00.000Z" },
  ]);
  assert.equal(store.snapshots.latestByKey("app", "ios")[0].rank, 1);
  assert.equal(store.snapshots.latestByKey("app", "mac")[0].rank, 5);
  assert.equal(store.snapshots.latestByKey("app")[0].rank, 9);
  store.close();
  pass("snapshots productId filtering");
} catch (e) {
  fail("snapshots productId filtering", e);
}

/* 服务门面 */
try {
  const store = openStore(join(dir, "svc.db"));
  const svc = createHeadlessService(store);
  svc.projects.register({ name: "p", path: "/x/p", githubUrl: null, platform: "ios", languages: ["en"], lastResolvedAt: "2026-09-01T00:00:00.000Z", artworkUrl: null });
  assert.equal(svc.projects.list().length, 1);
  assert.ok("updatedAt" in svc.projects.get("p")!);
  svc.snapshots.record([{ projectName: "p", keyword: "k", language: "en", storefront: "us", rank: 3, totalResults: 10, checkedAt: "2026-09-01T00:00:00.000Z" }]);
  assert.equal(svc.snapshots.latest("p")[0].rank, 3);
  store.close();
  pass("service facade projects/snapshots");
} catch (e) {
  fail("service facade projects/snapshots", e);
}

rmSync(dir, { recursive: true, force: true });
if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
}
console.log("🎉 All Phase 4a headless tests passed!");
