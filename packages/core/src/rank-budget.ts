/**
 * 关键词采集预算（排名任务的容量治理，2026-09-17）。
 *
 * 排名任务的量 = Σ 活跃关键词 × 其语言覆盖的商店数（en 全局词在**每个**
 * 本地化下都计费）。一个应用堆太多关键词 × 多商店时任务会堆积——即便采集
 * 有全局节拍也可能积压，且并非每个关键词都值得跟踪。因此在建议/新增入口
 * 展示采集量估算，配合既有的「连续未在榜 → 待复核暂停」生命周期策略：
 *
 * - 软提醒线（默认 240 实例/天）：提示关注采集量；
 * - 高负载参考线（默认 360 实例/天）：提示可能积压，但不拒绝用户采纳、
 *   加入或恢复的关键词。调度器会为所有活跃词创建任务。
 *
 * 预算为纯前端/主进程共用的纯函数，数字是常量，后续可暴露到设置。
 */
import { storefrontsForLanguage } from "./storefronts";

/** 软提醒线（实例/天）。 */
export const RANK_BUDGET_SOFT_LIMIT_DAILY = 240;
/** 高负载参考线（实例/天）；保留原有名称以兼容预算状态消费者。 */
export const RANK_BUDGET_HARD_LIMIT_DAILY = 360;

export interface RankBudgetKeywordInput {
  language: string;
  keyword: string;
  status?: string | null;
  pendingPausePlatforms?: string[] | null;
  pausedPlatforms?: string[] | null;
}

export interface RankBudgetStatus {
  /** 参与采集的关键词数（本平台未暂停/待复核）。 */
  activeKeywords: number;
  /** 每日 rank 任务数（采集成本的真实单位）。 */
  dailyInstances: number;
  softLimit: number;
  hardLimit: number;
  /** 距高负载参考线的差值（实例/天），不是可采纳额度。 */
  remaining: number;
  state: "ok" | "soft" | "hard";
}

/** 关键词语言在产品各本地化下的商店覆盖数（en 全局词 = 全部本地化之和）。 */
export function rankCostForLanguage(
  language: string,
  supportedLanguages: { code: string }[],
): number {
  let count = 0;
  for (const loc of supportedLanguages) {
    const queryLanguages = loc.code === "en" ? ["en"] : [loc.code, "en"];
    if (queryLanguages.includes(language)) {
      count += storefrontsForLanguage(loc.code).length;
    }
  }
  return count;
}

/** 关键词是否参与本平台的采集（与 reconcileRankTasks 的跳过规则一致）。 */
function isActiveOnPlatform(item: RankBudgetKeywordInput, platform: string): boolean {
  if (item.status === "paused") return false;
  const platformKey = platform || "unknown";
  return (
    !(item.pendingPausePlatforms || []).includes(platformKey) &&
    !(item.pausedPlatforms || []).includes(platformKey)
  );
}

/** 预算状态：按 reconcile 的同一成本模型估算每日任务数。 */
export function rankBudgetStatus(
  supportedLanguages: { code: string }[],
  platform: string,
  trackedKeywords: RankBudgetKeywordInput[],
): RankBudgetStatus {
  const seen = new Set<string>();
  let dailyInstances = 0;
  let activeKeywords = 0;
  for (const item of trackedKeywords || []) {
    if (!item?.keyword || !isActiveOnPlatform(item, platform)) continue;
    const key = `${item.language}\u0000${item.keyword}`;
    if (seen.has(key)) continue;
    seen.add(key);
    activeKeywords += 1;
    dailyInstances += rankCostForLanguage(item.language, supportedLanguages);
  }
  const state =
    dailyInstances >= RANK_BUDGET_HARD_LIMIT_DAILY
      ? "hard"
      : dailyInstances >= RANK_BUDGET_SOFT_LIMIT_DAILY
        ? "soft"
        : "ok";
  return {
    activeKeywords,
    dailyInstances,
    softLimit: RANK_BUDGET_SOFT_LIMIT_DAILY,
    hardLimit: RANK_BUDGET_HARD_LIMIT_DAILY,
    remaining: Math.max(0, RANK_BUDGET_HARD_LIMIT_DAILY - dailyInstances),
    state,
  };
}

export interface RankBudgetSelectionResult<T> {
  /** 可采纳的非重复关键词，保持传入顺序。 */
  selected: T[];
  /** 已在采集或在本批次中重复的关键词。 */
  duplicates: T[];
  /** 采纳后的每日任务估算；允许高于参考线。 */
  dailyAfter: number;
}

/**
 * 对用户选中的新增词去重并估算采集量。参考线仅用于提示，不裁剪选择。
 */
export function rankBudgetSelection<T extends { language: string; keyword: string }>(
  supportedLanguages: { code: string }[],
  platform: string,
  trackedKeywords: RankBudgetKeywordInput[],
  adds: T[],
): RankBudgetSelectionResult<T> {
  const base = rankBudgetStatus(supportedLanguages, platform, trackedKeywords);
  const existing = new Set(
    (trackedKeywords || [])
      .filter((item) => isActiveOnPlatform(item, platform))
      .map((item) => `${item.language}\u0000${item.keyword}`),
  );
  const selected: T[] = [];
  const duplicates: T[] = [];
  let daily = base.dailyInstances;
  for (const add of adds || []) {
    const key = `${add.language}\u0000${add.keyword}`;
    if (existing.has(key)) {
      duplicates.push(add);
      continue;
    }
    daily += rankCostForLanguage(add.language, supportedLanguages);
    existing.add(key);
    selected.push(add);
  }
  return { selected, duplicates, dailyAfter: daily };
}
