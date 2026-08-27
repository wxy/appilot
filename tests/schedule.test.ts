import assert from "node:assert/strict";
import {
  bootstrapRoundState,
  emptySchedulerRoundState,
  hashString,
  markRoundTaskDone,
  nextRunAt,
  nextRankRunAt,
  nextRunWithinMinutes,
  prioritizeGroupCompletion,
  pruneRoundMembers,
  rankGroupKey,
  rebalanceCollapsedTasks,
} from "../src/main/schedule";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const localDay = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

console.log("✅ PASS: nextRunAt keeps a stable phase, once per interval (24h rank cadence)");
{
  const seed = "msszspx4-r12ipi:macos:en:fr:ai cost monitor mac";
  // This seed has hash % 1440 === 6: the old formula re-ran it every 7 minutes.
  assert.equal(hashString(seed) % 1440, 6, "fixture keeps a tiny hash slot");
  const t0 = Date.parse("2026-08-24T00:00:00Z");
  const run1 = Date.parse(nextRunAt(seed, 24 * 60, new Date(t0)));
  const run2 = Date.parse(nextRunAt(seed, 24 * 60, new Date(t0 + DAY)));
  assert.equal(run2 - run1, DAY, "daily cadence: next day same slot");
  assert.ok(run1 > t0, "next run is in the future");
}

console.log("✅ PASS: nextRunAt never returns a past time for sub-day intervals");
{
  const t0 = Date.parse("2026-08-24T10:37:00Z");
  const next = Date.parse(nextRunAt("github-sync:p1", 60, new Date(t0)));
  assert.ok(next > t0, "hourly sync is scheduled in the future");
  const next2 = Date.parse(nextRunAt("github-sync:p1", 60, new Date(next + 1000)));
  assert.equal(next2 - next, HOUR, "hourly sync stays hourly");
}

console.log("✅ PASS: nextRunWithinMinutes scatters within the window");
{
  const t0 = Date.parse("2026-08-24T12:00:00Z");
  const next = Date.parse(nextRunWithinMinutes("seed-a", 120, new Date(t0)));
  assert.ok(next > t0 && next <= t0 + 120 * MIN, "scatter lands in (now, now+120m]");
  const retry = Date.parse(nextRunWithinMinutes("seed-b", 30, new Date(t0)));
  assert.ok(retry > t0 && retry <= t0 + 30 * MIN, "retry lands in (now, now+30m]");
}

console.log("✅ PASS: nextRankRunAt with runsPerDay=1 never runs twice on one calendar day");
{
  const t0 = Date.parse("2026-08-24T10:00:00Z");
  // This seed's phase is shortly after midnight, well before t0.
  const seed = "msszspx4-r12ipi:macos:en:fr:ai cost monitor mac";
  const next = Date.parse(nextRankRunAt(seed, 1, new Date(t0)));
  assert.notEqual(localDay(next), localDay(t0), "next run is on another local day");
  assert.equal(Date.parse(nextRankRunAt(seed, 1, new Date(next + 1000))) - next, DAY, "stable 24h cadence");

  // Even when a phase is still ahead on the same day, the next run must not
  // land on the previous run's calendar day.
  const lateRun = Date.parse("2026-08-24T10:00:00Z");
  const seedLate = "msszspx4-r12ipi:ios:zh-Hant:tw:編碼成本"; // hash % 1440 = 1414 → phase 23:34
  const nextLate = Date.parse(nextRankRunAt(seedLate, 1, new Date(lateRun)));
  assert.notEqual(localDay(nextLate), localDay(lateRun), "skips today's phase after an early run");
}

console.log("✅ PASS: nextRankRunAt supports more runs per day when configured later");
{
  const t0 = Date.parse("2026-08-24T10:00:00Z");
  const seed = "some-keyword-seed";
  const first = Date.parse(nextRankRunAt(seed, 2, new Date(t0)));
  assert.ok(first > t0, "first phase is in the future");
  const second = Date.parse(nextRankRunAt(seed, 2, new Date(first + 1000)));
  assert.equal(second - first, 12 * HOUR, "two runs per day are 12h apart");
}

console.log("✅ PASS: prioritizeGroupCompletion runs one group's tasks back-to-back");
{
  const rank = (id: string, groupKey: string) => ({ id, kind: "rank", groupKey });
  const sync = (id: string) => ({ id, kind: "github-sync" });
  const input = [
    rank("g1-a", "g1"),
    sync("s1"),
    rank("g2-a", "g2"),
    rank("g1-b", "g1"),
    rank("g2-b", "g2"),
    rank("g1-c", "g1"),
  ];
  const ordered = prioritizeGroupCompletion(input).map((t) => t.id);
  const g1Indexes = [ordered.indexOf("g1-a"), ordered.indexOf("g1-b"), ordered.indexOf("g1-c")].sort((a, b) => a - b);
  assert.deepEqual(g1Indexes, [0, 1, 2], "first group is contiguous and starts first");
  assert.equal(ordered[3], "s1", "non-rank task keeps its due order");
  assert.equal(ordered[4], "g2-a", "second group follows");
  assert.deepEqual([ordered.indexOf("g2-a"), ordered.indexOf("g2-b")], [4, 5], "second group is contiguous too");
}

console.log("✅ PASS: rankGroupKey is stable and platform-aware");
{
  assert.equal(
    rankGroupKey("p1", "ios", "zh-Hans", "cn"),
    rankGroupKey("p1", "ios", "zh-Hans", "cn"),
  );
  assert.notEqual(
    rankGroupKey("p1", "ios", "zh-Hans", "cn"),
    rankGroupKey("p1", "macos", "zh-Hans", "cn"),
  );
  assert.equal(rankGroupKey("p1", undefined, "en", "us"), "rank:p1:unknown:en:us");
}

console.log("✅ PASS: pruneRoundMembers keeps progress for an unchanged group, restarts on change");
{
  const started = new Date("2026-08-24T01:00:00Z").toISOString();
  const state = {
    members: ["a", "b", "c"].sort(),
    done: ["a"],
    roundStartedAt: started,
    lastCompletedAt: null,
  };
  const kept = pruneRoundMembers(state, ["b", "c", "a"]);
  assert.deepEqual(kept.done, ["a"], "same membership keeps done tasks");
  assert.equal(kept.roundStartedAt, started);

  const changed = pruneRoundMembers(state, ["a", "b", "c", "d"]);
  assert.deepEqual(changed.done, [], "membership change restarts the round");
  assert.notEqual(changed.roundStartedAt, started);
  assert.equal(changed.lastCompletedAt, null);
}

console.log("✅ PASS: bootstrapRoundState seeds progress from existing lastRunAt values");
{
  const tasks = [
    { id: "a", lastRunAt: "2026-08-24T01:00:00.000Z" },
    { id: "b", lastRunAt: "2026-08-24T02:00:00.000Z" },
    { id: "c", lastRunAt: null },
    { id: "d" },
  ];
  const state = bootstrapRoundState(tasks);
  assert.equal(state.members.length, 4);
  assert.deepEqual(state.done, ["a", "b"], "3/10-style progress counts keywords that have run");
  assert.equal(state.lastCompletedAt, null);
}

console.log("✅ PASS: markRoundTaskDone completes a round only when every member ran");
{
  const t = (minute: number) => new Date(Date.parse("2026-08-24T02:00:00Z") + minute * MIN).toISOString();
  let state = emptySchedulerRoundState();
  state = pruneRoundMembers(state, ["a", "b", "c"]);

  const first = markRoundTaskDone(state, "a", t(1));
  assert.equal(first.completed, false);
  assert.deepEqual(first.state.done, ["a"]);

  const second = markRoundTaskDone(first.state, "b", t(2));
  assert.equal(second.completed, false);

  const third = markRoundTaskDone(second.state, "c", t(3));
  assert.equal(third.completed, true, "last member completes the round");
  assert.equal(third.state.lastCompletedAt, t(3));
  assert.deepEqual(third.state.done, [], "a fresh round starts");

  // A duplicate completion must not double-complete.
  const dup = markRoundTaskDone(third.state, "a", t(4));
  assert.equal(dup.completed, false);
}

console.log("✅ PASS: rebalanceCollapsedTasks spreads a collapsed batch to stable phases");
{
  const now = new Date("2026-08-24T02:00:00Z");
  const collapsedAt = new Date(now.getTime() + 23 * HOUR).toISOString();
  const tasks = Array.from({ length: 120 }, (_, i) => ({
    id: `rank:${i}`,
    kind: "rank",
    enabled: true,
    intervalMinutes: 1440,
    nextRunAt: collapsedAt,
  }));
  const { tasks: next, changed } = rebalanceCollapsedTasks(tasks, now);
  assert.equal(changed, true, "large same-minute batch is detected");
  const times = next.map((t) => Date.parse(t.nextRunAt)).sort((a, b) => a - b);
  assert.equal(next.length, 120);
  assert.ok(
    new Set(times.map((ts) => Math.floor(ts / MIN))).size > 100,
    "rebalanced times are spread across distinct minutes",
  );
  assert.ok(times[0] > now.getTime(), "next run stays in the future");
}

console.log("✅ PASS: rebalanceCollapsedTasks leaves small batches untouched");
{
  const now = new Date("2026-08-24T02:00:00Z");
  const shared = new Date(now.getTime() + 23 * HOUR).toISOString();
  const tasks = [
    { id: "a", kind: "rank", enabled: true, intervalMinutes: 1440, nextRunAt: shared },
    { id: "b", kind: "rank", enabled: true, intervalMinutes: 1440, nextRunAt: shared },
    { id: "c", kind: "rank", enabled: true, intervalMinutes: 1440, nextRunAt: shared },
  ];
  const { tasks: next, changed } = rebalanceCollapsedTasks(tasks, now);
  assert.equal(changed, false, "small batch is a normal phase collision, not a collapse");
  assert.deepEqual(next, tasks);
}

console.log("✅ PASS: rebalanceCollapsedTasks skips overdue and disabled tasks");
{
  const now = new Date("2026-08-24T02:00:00Z");
  const overdueAt = new Date(now.getTime() - HOUR).toISOString();
  const futureAt = new Date(now.getTime() + 23 * HOUR).toISOString();
  const tasks = [
    { id: "a", kind: "rank", enabled: true, intervalMinutes: 1440, nextRunAt: overdueAt },
    { id: "b", kind: "rank", enabled: false, intervalMinutes: 1440, nextRunAt: futureAt },
  ];
  const { tasks: next, changed } = rebalanceCollapsedTasks(tasks, now);
  assert.equal(changed, false);
  assert.equal(next[0].nextRunAt, overdueAt);
  assert.equal(next[1].nextRunAt, futureAt);
}

console.log("✅ PASS: rebalanceCollapsedTasks threshold scales with enabled task count");
{
  const now = new Date("2026-08-24T02:00:00Z");
  const collapsedAt = new Date(now.getTime() + 23 * HOUR).toISOString();
  // 3000 个启用任务时阈值按 5% 升到 150：150 个同分钟视为坍缩，
  // 100 个同分钟不视为坍缩（失败重试批的规模）。
  const big = Array.from({ length: 3000 }, (_, i) => ({
    id: `r:${i}`,
    kind: "rank",
    enabled: true,
    intervalMinutes: 1440,
    nextRunAt: i < 150 ? collapsedAt : new Date(now.getTime() + 25 * HOUR + i * MIN).toISOString(),
  }));
  const collapsed = rebalanceCollapsedTasks(big, now);
  assert.equal(collapsed.changed, true, "150 same-minute tasks trigger at scaled threshold");
  assert.equal(
    collapsed.tasks.filter((t) => t.nextRunAt === collapsedAt).length < 10,
    true,
    "collapsed batch is re-spread (only phase collisions remain)",
  );
  const small = Array.from({ length: 3000 }, (_, i) => ({
    id: `s:${i}`,
    kind: "rank",
    enabled: true,
    intervalMinutes: 1440,
    nextRunAt: i < 100 ? collapsedAt : new Date(now.getTime() + 25 * HOUR + i * MIN).toISOString(),
  }));
  const untouched = rebalanceCollapsedTasks(small, now);
  assert.equal(untouched.changed, false, "100 same-minute tasks stay below the scaled threshold");
}

console.log("\n🎉 All schedule tests passed!");
