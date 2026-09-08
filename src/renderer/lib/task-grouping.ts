/**
 * Pure grouping key for scheduler tasks shown in the task center.
 *
 * - rank tasks group by their scheduler round (product × platform × language
 *   × storefront), so the round-progress column stays meaningful;
 * - github-sync / ops-sync are project-scoped;
 * - reviews-sync / build-status are product-scoped.
 */
export function taskGroupKey(task: {
  kind?: string;
  groupKey?: string | null;
  projectName?: string;
  productName?: string;
}): string {
  const kind = task.kind || "unknown";
  if (kind === "rank" && task.groupKey) return `rank\u0000${task.groupKey}`;
  if (kind === "github-sync" || kind === "ops-sync") {
    return `sync\u0000${task.projectName || ""}`;
  }
  return `${task.projectName || ""}\u0000${task.productName || ""}\u0000${kind}`;
}

export interface NextRunPick {
  /**
   * 组内最早「已排到未来」的 nextRunAt；组内没有任何未来排期时为 null
   * （此时由 UI 用 dueCount 显示「已到期 ×N」，而不是把过去时间当下次执行）。
   */
  nextRunAt: string | null;
  /** 组内 nextRunAt 已到期（≤ now）的成员数。 */
  dueCount: number;
}

/**
 * 组级「下次执行」合并口径。
 *
 * 组行里「上次执行」= 各成员 lastRunAt 的最大值，而「下次执行」若直接取
 * 全体成员 nextRunAt 的最小值，会把不同成员的时间混在一起：扫组/积压期间
 * 部分成员仍到期未跑（nextRunAt 落在过去、数值上 < 已跑成员的 lastRunAt），
 * 于是任务列表出现「下次执行 < 上次执行」的矛盾展示（两者还都显示成过去）。
 *
 * 这里只考虑成员中已排到未来的最小 nextRunAt；到期成员由 dueCount 呈现
 * （引擎正在处理 / 已暂停，给不出可靠的下一次时间戳）。
 */
export function pickGroupNextRun(
  members: ReadonlyArray<{ nextRunAt?: string | null }>,
  now: Date = new Date(),
): NextRunPick {
  const nowMs = now.getTime();
  let best: string | null = null;
  let dueCount = 0;
  for (const member of members) {
    const raw = member?.nextRunAt;
    if (typeof raw !== "string" || raw.length === 0) continue;
    const t = new Date(raw).getTime();
    if (!Number.isFinite(t)) continue;
    if (t <= nowMs) {
      dueCount += 1;
      continue;
    }
    if (!best || t < new Date(best).getTime()) best = raw;
  }
  return { nextRunAt: best, dueCount };
}
