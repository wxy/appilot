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
