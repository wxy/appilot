/**
 * 任务中心「执行统计」共享口径（纯 node，无 electron，可单测）。
 *
 * scheduler:overview 与 scheduler:list 必须用同一份函数计算同组统计——
 * 事件驱动刷新（appilot:data-changed → scheduler:overview）此前用**不含**
 * hitRate / requestBytes / responseBytes 的“轻量 overview”整块覆盖全量
 * scheduler:list 结果，导致这两个卡片在每次更新瞬间闪成空/0（其它卡片
 * 因为字段仍在轻量 payload 里而不归零）。本模块让两个 handler 输出同一
 * 组完整字段，杜绝字段集漂移。
 *
 * 口径：
 * - hitRate（入榜率）：只在「真正查排名的执行」上计算——条目带 keyword /
 *   kind=rank / 语言×商店等采集指纹。github-sync / ops / reviews / build
 *   等无排名维度的成功执行不进分母，否则会把入榜率稀释并随其批次抖动；
 * - status='retry'（daemon 侧瞬时抖动/限流的自动重试，任务行不标红）不计入
 *   执行次数/密度/成功率；
 * - 流量（requestBytes/responseBytes）：近 24h 求和（条目字段缺失按 0）；
 *   窗口内**完全无数据**时沿用最近一次非空测量，避免展示瞬态归零。
 */

export const EXEC_STATS_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ExecutionRecord {
  ts?: unknown;
  taskId?: unknown;
  status?: unknown;
  rank?: unknown;
  keyword?: unknown;
  language?: unknown;
  storefront?: unknown;
  kind?: unknown;
  durationMs?: unknown;
  requestBytes?: unknown;
  responseBytes?: unknown;
}

/**
 * 该执行条目是否是一次「排名采集」（具备查排名的字段指纹）。
 * 非排名任务（github-sync / ops-sync / reviews-sync / build-status）的
 * 执行记录没有 keyword / 语言×商店，kind 也不是 'rank'。
 */
export function hasRankDimension(entry: ExecutionRecord | null | undefined): boolean {
  if (entry == null || typeof entry !== "object") return false;
  if (entry.kind === "rank") return true;
  const kw = typeof entry.keyword === "string" ? entry.keyword.trim() : "";
  if (kw.length > 0) return true;
  const lang = typeof entry.language === "string" ? entry.language.trim() : "";
  const sf = typeof entry.storefront === "string" ? entry.storefront.trim() : "";
  return lang.length > 0 && sf.length > 0;
}

export interface ExecutionStats {
  /** 近 24h 内条目数（全部任务种类）。 */
  recentCount: number;
  successRate: number | null;
  hitRate: number | null;
  avgDurationMs: number;
  densityPerHour: number;
  /** 今日（本地时区零点起）执行次数。 */
  executedToday: number;
  requestBytes: number;
  responseBytes: number;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function msOf(ts: unknown): number {
  if (typeof ts !== "string") return Number.NaN;
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : Number.NaN;
}

/**
 * 由近 24h 窗口计算任务中心统计。executions 应按时间升序（如
 * sharedStore().executions.latest() 的语义：升序返回、最近 20000 条）。
 */
export function computeExecutionStats(
  executions: readonly ExecutionRecord[],
  now: number,
  windowMs: number = EXEC_STATS_WINDOW_MS,
): ExecutionStats {
  const recent: ExecutionRecord[] = [];
  let executedToday = 0;
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();

  for (const entry of executions) {
    if (entry == null || typeof entry !== "object") continue;
    // 「重试」不是一次有结论的执行（瞬时抖动/限流的自动重试；任务行也不标红）：
    // 不计入执行次数/密度/成功率，否则上游抖一下成功率就被稀释。
    if (entry.status === "retry") continue;
    const t = msOf(entry.ts);
    if (!Number.isFinite(t)) continue;
    if (t >= todayStartMs) executedToday += 1;
    if (t >= now - windowMs) recent.push(entry);
  }

  const success = recent.filter((e) => e.status === "success");
  const successRate = recent.length
    ? Math.round((success.length / recent.length) * 100)
    : null;

  // 入榜率：只在成功且「查排名的执行」上计算。
  const rankSuccess = success.filter(hasRankDimension);
  const hitRate = rankSuccess.length
    ? Math.round(
        (rankSuccess.filter((e) => e.rank != null).length / rankSuccess.length) *
          100,
      )
    : null;

  const avgDurationMs = recent.length
    ? Math.round(
        recent.reduce((sum, e) => sum + num(e.durationMs), 0) / recent.length,
      )
    : 0;
  const densityPerHour =
    Math.round((recent.length / (windowMs / 3_600_000)) * 10) / 10;

  let requestBytes = 0;
  let responseBytes = 0;
  for (const e of recent) {
    requestBytes += num(e.requestBytes);
    responseBytes += num(e.responseBytes);
  }
  if (recent.length === 0) {
    // 窗口内完全无数据：沿用最近一次非空测量（executions 按时间升序，
    // 从尾部倒找最后一次记录到字节数的条目），避免展示归零。
    for (let i = executions.length - 1; i >= 0; i--) {
      const rb = num(executions[i]?.requestBytes);
      const pb = num(executions[i]?.responseBytes);
      if (rb > 0 || pb > 0) {
        requestBytes = rb;
        responseBytes = pb;
        break;
      }
    }
  }

  return {
    recentCount: recent.length,
    successRate,
    hitRate,
    avgDurationMs,
    densityPerHour,
    executedToday,
    requestBytes,
    responseBytes,
  };
}
