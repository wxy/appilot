import {
  buildStatusTaskId,
  IN_FLIGHT_STORE_STATUSES,
  opsSyncTaskId,
  reviewsSyncTaskId,
  seedScheduledTask,
} from "../src/main/schedule";

let errors = 0;
function check(ok: boolean, msg: string) {
  if (ok) console.log(`✅ PASS: ${msg}`);
  else { console.error(`❌ FAIL: ${msg}`); errors++; }
}

check(opsSyncTaskId("p1") === "ops-sync:p1", "ops-sync id 稳定");
check(reviewsSyncTaskId("p1:ios") === "reviews-sync:p1:ios", "reviews-sync id 稳定");
check(buildStatusTaskId("p1:ios") === "build-status:p1:ios", "build-status id 稳定");
check(IN_FLIGHT_STORE_STATUSES.includes("submitted") && IN_FLIGHT_STORE_STATUSES.length === 4, "在途状态集合正确");

const existing = [
  { id: "ops-sync:p1", intervalMinutes: 1440, lastRunAt: "2026-08-23T01:00:00Z", firstRunAt: "2026-08-20T01:00:00Z", executionCount: 3, lastStatus: "success", enabled: true, consecutiveFailures: 0, lastDurationMs: 500 },
];
const seeded = seedScheduledTask(existing, { id: "ops-sync:p1", kind: "ops-sync", projectId: "p1", intervalMinutes: 1440 });
check(seeded.executionCount === 3 && seeded.lastRunAt === "2026-08-23T01:00:00Z", "seed 保留上次运行字段");
const fresh = seedScheduledTask(existing, { id: "reviews-sync:p1:ios", kind: "reviews-sync", productId: "p1:ios", intervalMinutes: 1440 });
check(fresh.nextRunAt && fresh.firstRunAt === null && fresh.executionCount === 0, "新任务生成 nextRunAt 且无历史字段");
check(new Date(fresh.nextRunAt).getTime() > Date.now(), "nextRunAt 在未来");

if (errors) process.exit(1);
console.log("done");
