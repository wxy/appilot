import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store";

const dir = mkdtempSync(join(tmpdir(), "headless-store-"));
const dbPath = join(dir, "appilot.db");
let failures = 0;
function pass(name: string) {
  console.log(`✅ PASS: ${name}`);
}
function fail(name: string, err: unknown) {
  failures += 1;
  console.error(`❌ FAIL: ${name} — ${err instanceof Error ? err.message : String(err)}`);
}

/* ── 1. projects CRUD + upsert ── */
try {
  const store = openStore(dbPath);
  const base = {
    name: "appilot",
    path: "/x/appilot",
    githubUrl: "https://github.com/wxy/appilot",
    platform: null,
    languages: ["en", "zh-Hans"],
    lastResolvedAt: "2026-09-01T00:00:00.000Z",
    artworkUrl: null,
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
  store.projects.save(base);
  assert.equal(store.projects.list().length, 1);
  assert.equal(store.projects.get("appilot")?.path, "/x/appilot");
  // upsert：同 name 覆盖
  store.projects.save({ ...base, platform: "ios", languages: ["en"] });
  const after = store.projects.get("appilot");
  assert.equal(after?.platform, "ios");
  assert.deepEqual(after?.languages, ["en"]);
  assert.equal(store.projects.list().length, 1);
  // remove
  assert.equal(store.projects.remove("appilot"), true);
  assert.equal(store.projects.remove("appilot"), false);
  store.close();
  pass("projects CRUD + upsert");
} catch (err) {
  fail("projects CRUD + upsert", err);
}

/* ── 2. 持久化：重开连接数据仍在 ── */
try {
  const s1 = openStore(dbPath);
  s1.projects.save({
    name: "keep",
    path: "/x/keep",
    githubUrl: null,
    platform: "macos",
    languages: [],
    lastResolvedAt: "2026-09-01T00:00:00.000Z",
    artworkUrl: null,
    updatedAt: "2026-09-01T00:00:00.000Z",
  });
  s1.close();
  const s2 = openStore(dbPath);
  assert.equal(s2.projects.get("keep")?.platform, "macos");
  s2.close();
  pass("persistence across reopen");
} catch (err) {
  fail("persistence across reopen", err);
}

/* ── 3. snapshots add / latestByKey / prune ── */
try {
  const store = openStore(dbPath);
  const t1 = "2026-09-01T00:00:00.000Z";
  const t2 = "2026-09-02T00:00:00.000Z";
  store.snapshots.add([
    { projectName: "keep", keyword: "kw", language: "en", storefront: "us", rank: 10, totalResults: 100, checkedAt: t1 },
    { projectName: "keep", keyword: "kw", language: "en", storefront: "us", rank: 7, totalResults: 100, checkedAt: t2 },
    { projectName: "keep", keyword: "kw", language: "en", storefront: "gb", rank: 20, totalResults: 100, checkedAt: t2 },
  ]);
  const latest = store.snapshots.latestByKey("keep");
  assert.equal(latest.length, 2); // us + gb 各最新一条
  const us = latest.find((s) => s.storefront === "us");
  assert.equal(us?.rank, 7); // 后写者（t2）胜
  const pruned = store.snapshots.pruneOlderThan("keep", "2026-09-02T00:00:00.000Z");
  assert.ok(pruned >= 1);
  store.close();
  pass("snapshots add / latestByKey / prune");
} catch (err) {
  fail("snapshots add / latestByKey / prune", err);
}

/* ── 4. tasks upsert / all / get ── */
try {
  const store = openStore(dbPath);
  store.tasks.upsert({
    id: "release-sync",
    title: "发布同步",
    intervalMinutes: 60,
    lastRunAt: "2026-09-01T00:00:00.000Z",
    nextRunAt: "2026-09-01T01:00:00.000Z",
    lastStatus: "ok",
    lastSummary: "appilot: tag=v0.4.4",
    runCount: 1,
  });
  assert.equal(store.tasks.get("release-sync")?.lastStatus, "ok");
  store.tasks.upsert({ ...store.tasks.get("release-sync")!, runCount: 2 });
  assert.equal(store.tasks.all()[0].runCount, 2);
  store.close();
  pass("tasks upsert / all / get");
} catch (err) {
  fail("tasks upsert / all / get", err);
}

/* ── 5. 租约：单连接 acquire / heartbeat / 过期接管 ── */
try {
  const store = openStore(dbPath);
  assert.equal(store.lease.acquire("shell-a", 60_000), true);
  assert.equal(store.lease.leader(), "shell-a");
  assert.equal(store.lease.acquire("shell-b", 60_000), false); // 主未过期，b 抢不到
  assert.equal(store.lease.heartbeat("shell-a"), true);
  assert.equal(store.lease.heartbeat("shell-b"), false); // 非主不能续租
  store.close();
  // 过期后接管：写入过期心跳 → b 可接管
  const s2 = openStore(dbPath);
  s2.tasks.upsert({
    id: "lease-probe",
    title: "",
    intervalMinutes: 1,
    lastRunAt: null,
    nextRunAt: null,
    lastStatus: "never",
    lastSummary: null,
    runCount: 0,
  });
  // 直接改 heartbeatAt 为过期时间（模拟 a 崩溃后时间流逝）
  const db = new (require("node:sqlite").DatabaseSync)(dbPath);
  db.prepare("UPDATE lease SET heartbeatAt = ? WHERE id = 1").run(
    new Date(Date.now() - 120_000).toISOString(),
  );
  db.close();
  assert.equal(s2.lease.acquire("shell-b", 60_000), true);
  assert.equal(s2.lease.leader(), "shell-b");
  // 显式让位：仅当前主可 release；release 后其他主无需等 TTL 即可接管
  assert.equal(s2.lease.release("shell-b"), true, "当前主应能 release");
  assert.equal(s2.lease.leader(), null, "release 后无主");
  assert.equal(s2.lease.release("shell-b"), false, "非主 release 返回 false");
  const s3 = openStore(dbPath);
  assert.equal(s3.lease.acquire("shell-c", 60_000), true, "release 后新主立即接管（免 TTL）");
  assert.equal(s3.lease.leader(), "shell-c");
  s3.close();
  s2.close();
  pass("lease acquire / heartbeat / takeover / release");
} catch (err) {
  fail("lease acquire / heartbeat / takeover", err);
}

/* ── 6. 双连接（模拟双进程）：同文件并发写不损坏 + 租约互斥 ── */
try {
  const path2 = join(dir, "concurrent.db");
  const a = openStore(path2);
  const b = openStore(path2);
  // 并发写不同项目（WAL + busy_timeout 下不损坏）
  a.projects.save({ name: "from-a", path: "/a", githubUrl: null, platform: null, languages: [], lastResolvedAt: "2026-09-01T00:00:00.000Z", artworkUrl: null, updatedAt: "2026-09-01T00:00:00.000Z" });
  b.projects.save({ name: "from-b", path: "/b", githubUrl: null, platform: null, languages: [], lastResolvedAt: "2026-09-01T00:00:00.000Z", artworkUrl: null, updatedAt: "2026-09-01T00:00:00.000Z" });
  // 各自可见对方写入（同一 DB 文件）
  assert.equal(a.projects.get("from-b")?.name, "from-b");
  assert.equal(b.projects.get("from-a")?.name, "from-a");
  // 租约互斥：a 拿主后 b 抢不到；a 释放（过期）后 b 可拿
  assert.equal(a.lease.acquire("proc-a", 60_000), true);
  assert.equal(b.lease.acquire("proc-b", 60_000), false);
  const db2 = new (require("node:sqlite").DatabaseSync)(path2);
  db2.prepare("UPDATE lease SET heartbeatAt = ? WHERE id = 1").run(
    new Date(Date.now() - 120_000).toISOString(),
  );
  db2.close();
  assert.equal(b.lease.acquire("proc-b", 60_000), true);
  a.close();
  b.close();
  pass("dual-connection concurrency + lease exclusivity");
} catch (err) {
  fail("dual-connection concurrency + lease exclusivity", err);
}

if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
}
console.log("🎉 All headless store tests passed!");
