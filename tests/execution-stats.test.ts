/**
 * 任务中心执行统计口径单测（入榜率 / 流量闪 0 修复的固化）。
 * 纯 node：npx tsx tests/execution-stats.test.ts
 */
import {
  computeExecutionStats,
  hasRankDimension,
} from "../src/main/execution-stats";

let errors = 0;
function check(ok: boolean, msg: string) {
  if (ok) console.log(`✅ PASS: ${msg}`);
  else {
    console.error(`❌ FAIL: ${msg}`);
    errors++;
  }
}

const HOUR = 3_600_000;
// 固定“now”为本地正午：下方部分块用 agoHours(≤3) 相对 fixture 断言“今日执行”，
// 若真实运行时刻落在零点后 3 小时内，条目会掉到昨天导致随 CI 时刻漂移
// （曾在 UTC 00:20 触发 FAIL）。正午保证所有相对 fixture 都留在当日。
const now = (() => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d.getTime();
})();
const t = (agoHours: number) => new Date(now - agoHours * HOUR).toISOString();

const rankExec = (
  partial: {
    agoHours: number;
    status?: string;
    rank?: number | null;
    keyword?: string;
    kind?: string;
    requestBytes?: number;
    responseBytes?: number;
    language?: string;
    storefront?: string;
  },
) => ({
  ts: t(partial.agoHours),
  taskId: "prod:en:us:kw",
  keyword: partial.keyword ?? "some keyword",
  language: partial.language ?? "en",
  storefront: partial.storefront ?? "us",
  status: partial.status ?? "success",
  rank: partial.rank ?? null,
  requestBytes: partial.requestBytes ?? 100,
  responseBytes: partial.responseBytes ?? 1000,
  durationMs: 500,
  ...(partial.kind ? { kind: partial.kind } : {}),
});

// ── hasRankDimension ────────────────────────────────────────────────────────
check(hasRankDimension({ keyword: "walk", language: "en", storefront: "us" }), "带 keyword 的条目 = 查排名的执行");
check(hasRankDimension({ kind: "rank" }), "kind=rank 即查排名的执行");
check(hasRankDimension({ language: "de", storefront: "de" }), "语言×商店指纹也算排名维度");
check(!hasRankDimension({ kind: "github-sync" }), "github-sync 无排名维度");
check(!hasRankDimension({ kind: "ops-sync" }), "ops-sync 无排名维度");
check(!hasRankDimension({}), "空条目无排名维度");
check(!hasRankDimension(null), "null 无排名维度");

// ── 入榜率：分母只算“查排名的成功执行” ────────────────────────────────────
{
  const executions = [
    rankExec({ agoHours: 1, keyword: "found", rank: 3 }),
    rankExec({ agoHours: 2, keyword: "missing", rank: null }),
    // 无排名维度的成功执行（github/ops 等）不得进分母稀释入榜率。
    { ts: t(1), taskId: "gh", kind: "github-sync", status: "success", durationMs: 10 },
    { ts: t(2), taskId: "ops", kind: "ops-sync", status: "success", durationMs: 10 },
  ];
  const stats = computeExecutionStats(executions as any, now);
  check(stats.hitRate === 50, `入榜率只统计查排名成功：2 次成功采集 1 次有排名 → 50%（实际 ${stats.hitRate}）`);
  check(stats.successRate === 100, "成功率仍按全部成功/全部计");
}

// ── 「重试」不计入执行次数/密度/成功率（daemon 侧瞬时抖动/限流的自动重试） ──
{
  const executions = [
    rankExec({ agoHours: 1, keyword: "ok", rank: 1 }),
    rankExec({ agoHours: 2, keyword: "ok2", rank: 2 }),
    rankExec({ agoHours: 2, status: "failed", rank: null }),
    // 瞬时抖动的自动重试：任务行不标红，统计也不该被稀释。
    rankExec({ agoHours: 3, status: "retry", rank: null }),
    rankExec({ agoHours: 3, status: "retry", rank: null }),
  ];
  const stats = computeExecutionStats(executions as any, now);
  check(stats.recentCount === 3, `重试不进近 24h 计数（实际 ${stats.recentCount}）`);
  check(stats.successRate === 67, `成功率 = 2 成功 / 3 有结论（实际 ${stats.successRate}%）`);
  check(stats.executedToday === 3, `今日执行同样排除重试（实际 ${stats.executedToday}）`);
}

// ── 入榜率：窗口内没有查排名成功 → null（UI 显示 —） ───────────────────────
{
  const executions = [
    rankExec({ agoHours: 1, status: "failed", rank: null }),
    { ts: t(1), taskId: "gh", kind: "github-sync", status: "success", durationMs: 10 },
  ];
  const stats = computeExecutionStats(executions as any, now);
  check(stats.hitRate === null, "无查排名成功时入榜率为 null（不显示 0% 误导）");
}

// ── 流量：近 24h 求和、字段缺失按 0、窗口外不计 ────────────────────────────
{
  const executions = [
    rankExec({ agoHours: 1, requestBytes: 300, responseBytes: 3000 }),
    rankExec({ agoHours: 25, requestBytes: 999999, responseBytes: 999999 }), // 窗口外
    { ts: t(2), taskId: "no-bytes", status: "success", durationMs: 5 }, // 无字节字段
  ];
  const stats = computeExecutionStats(executions as any, now);
  check(stats.requestBytes === 300, `请求流量只求和窗口内条目（实际 ${stats.requestBytes}）`);
  check(stats.responseBytes === 3000, `响应流量只求和窗口内条目（实际 ${stats.responseBytes}）`);
}

// ── 流量：窗口完全为空时沿用最近一次非空测量（不闪 0） ────────────────────
{
  const executions = [
    rankExec({ agoHours: 30, requestBytes: 200, responseBytes: 2222 }),
    rankExec({ agoHours: 40, requestBytes: 0, responseBytes: 0 }),
  ];
  const stats = computeExecutionStats(executions as any, now);
  check(stats.recentCount === 0, "窗口内确实无数据");
  check(stats.requestBytes === 200 && stats.responseBytes === 2222,
    `空窗口沿用最近一次非空测量（实际 ${stats.requestBytes}/${stats.responseBytes}）`);
}
{
  const stats = computeExecutionStats([] as any, now);
  check(stats.requestBytes === 0 && stats.responseBytes === 0, "从未有测量时仍为 0");
}

// ── 今日执行 / 平均耗时 / 密度 ─────────────────────────────────────────────
{
  // 固定“now”为本地当日 06:00，避免真实运行时刻贴近零点造成边界抖动。
  const fakeNow = new Date(now);
  fakeNow.setHours(6, 0, 0, 0);
  const d0 = new Date(fakeNow);
  d0.setHours(0, 0, 0, 0); // 本地今日零点
  const mk = (iso: string, durationMs: number) => ({
    ts: iso, taskId: "x", status: "success", keyword: "k", durationMs,
  });
  const executions = [
    mk(new Date(d0.getTime() + 60_000).toISOString(), 400), // 今日 00:01
    mk(new Date(d0.getTime() + 120_000).toISOString(), 800), // 今日 00:02
    mk(new Date(d0.getTime() - 60_000).toISOString(), 1200), // 昨日 23:59（仍在近 24h 窗口）
  ];
  const stats = computeExecutionStats(executions as any, fakeNow.getTime());
  check(stats.recentCount === 3, "近 24h 计数");
  check(stats.executedToday === 2, `今日执行只计零点后（实际 ${stats.executedToday}）`);
  check(stats.avgDurationMs === 800, `平均耗时 = round((400+800+1200)/3)（实际 ${stats.avgDurationMs}）`);
}

if (errors) process.exit(1);
console.log("execution-stats 单测全部通过 ✓");
