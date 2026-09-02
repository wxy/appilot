import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store";
import { createLeaseScheduler, type ScheduledJob } from "../src/scheduler";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function main() {
  let failures = 0;
  const pass = (name: string) => console.log(`✅ PASS: ${name}`);
  const fail = (name: string, err: unknown) => {
    failures += 1;
    console.error(`❌ FAIL: ${name} — ${err instanceof Error ? err.message : String(err)}`);
  };

  const dir = mkdtempSync(join(tmpdir(), "headless-sched-"));
  const dbPath = join(dir, "appilot.db");
  const mkJob = (id: string): ScheduledJob => ({
    id,
    title: id,
    intervalMinutes: 1,
    run: async () => `${id}-ran`,
  });

  (async () => {
    try {
      const storeA = openStore(dbPath);
      const storeB = openStore(dbPath);
      const schedA = createLeaseScheduler({
        store: storeA,
        leaderId: "shell-a",
        jobs: [mkJob("job-a")],
        heartbeatMs: 200,
        ttlMs: 800,
      });
      const schedB = createLeaseScheduler({
        store: storeB,
        leaderId: "shell-b",
        jobs: [mkJob("job-b")],
        heartbeatMs: 200,
        ttlMs: 800,
      });

      schedA.start();
      schedB.start();
      await sleep(150);
      assert.equal(schedA.isLeader(), true, "A 先启动应成为主");
      assert.equal(schedB.isLeader(), false, "B 不应同时是主");

      await sleep(600);
      assert.ok((storeA.tasks.get("job-a")?.runCount ?? 0) >= 1, "主 A 应执行自己的任务");
      assert.equal(storeB.tasks.get("job-b")?.runCount ?? 0, 0, "从者 B 不应执行任务");

      schedA.dispose();
      storeA.close();
      // 轮询等待接管（最坏延迟 ≈ ttl + heartbeatMs；轮询避免固定 sleep 时序抖动）
      let tookOver = false;
      for (let i = 0; i < 50 && !tookOver; i++) {
        await sleep(100);
        tookOver = schedB.isLeader();

      }
      assert.equal(tookOver, true, "A 崩溃后 B 应接管");
      const bRow = storeB.tasks.get("job-b");
      assert.ok(bRow && bRow.runCount >= 1, "B 接管后应执行任务");
      assert.equal(bRow.lastStatus, "ok");

      schedB.dispose();
      storeB.close();
      pass("lease scheduler: single leader runs jobs, takeover after crash");
    } catch (err) {
      fail("lease scheduler: single leader runs jobs, takeover after crash", err);
    }
    if (failures > 0) {
      console.error(`\n${failures} test(s) FAILED`);
      process.exit(1);
    }
    console.log("🎉 All headless scheduler tests passed!");
  })();
}

main();
