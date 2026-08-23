import { computeRankSchedulerStatus } from "../src/main/scheduler-status";

let errors = 0;
function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    errors++;
  } else {
    console.log(`✅ PASS: ${msg}`);
  }
}

const now = Date.parse("2026-08-23T12:00:00Z");
const future = new Date(now + 60_000).toISOString();
const past = new Date(now - 60_000).toISOString();
const earlier = new Date(now - 120_000).toISOString();

const tasks = [
  { kind: "rank", enabled: true, nextRunAt: past, lastStatus: "success" },
  { kind: "rank", enabled: true, nextRunAt: future, lastStatus: "success" },
  { kind: "rank", enabled: false, nextRunAt: past, lastStatus: "failed" },
  // Project-level GitHub sync must not affect the keyword-collection status.
  { kind: "github-sync", enabled: true, nextRunAt: earlier, lastStatus: "failed" },
];

async function runTests() {
  const status = computeRankSchedulerStatus(tasks, now);
  assert(status.total === 4, "total counts every task kind");
  assert(status.due === 1, "due only counts enabled rank tasks (sync excluded)");
  assert(status.failed === 2, "failed counts failed tasks of all kinds");
  assert(
    status.nextDueAt === past,
    "nextDueAt is the earliest rank task, ignoring an even earlier sync task",
  );

  const onlySync = computeRankSchedulerStatus(
    [{ kind: "github-sync", enabled: true, nextRunAt: past }],
    now,
  );
  assert(onlySync.due === 0, "a lone due sync task yields due=0");
  assert(onlySync.nextDueAt === null, "a lone sync task yields nextDueAt=null");

  if (errors === 0) console.log("\n🎉 All scheduler-status tests passed!");
  else process.exitCode = 1;
}

void runTests();
