/**
 * 关键词采集预算（排名任务的容量治理，2026-09-17）。
 *
 * 排名任务的量 = Σ 活跃关键词 × 其语言覆盖的商店数（en 全局词在**每个**
 * 本地化下都计费）。一个应用堆太多关键词 × 多商店时任务会堆积——即便采集
 * 有全局节拍也跑不完，且并非每个关键词都值得跟踪。因此在**建议/新增入口**
 * 就用预算约束，配合既有的「连续未在榜 → 待复核暂停」生命周期策略：
 *
 * - 软上限（默认 240 实例/天）：接近采集预算，建议面板提示清理低价值词；
 * - 硬上限（默认 360 实例/天）：拒绝新增采集任务（AI 建议采纳 / 候选加入 /
 *   恢复暂停词都受限）；核心词（商店关键词/名称/副标题来源）优先保留。
 *
 * 预算为纯前端/主进程共用的纯函数，数字是常量，后续可暴露到设置。
 */
import { storefrontsForLanguage } from "./storefronts";

/** 软上限（实例/天）：超过后 UI 提示接近预算、建议清理。 */
export const RANK_BUDGET_SOFT_LIMIT_DAILY = 240;
/** 硬上限（实例/天）：超过后拒绝新增采集任务。 */
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
  /** 距硬上限的剩余额度（实例/天）。 */
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

export interface RankBudgetAdmissibleResult<T> {
  /** 预算内可采纳的（按传入顺序优先保留）。 */
  accepted: T[];
  /** 超出硬上限被拒的。 */
  rejected: T[];
  /** 采纳后的每日任务数。 */
  dailyAfter: number;
}

/**
 * 在硬预算内按传入顺序放行新增（调用方控制优先级：核心词在前、AI 词在后）。
 * 每条新增的成本 = 其语言在产品本地化下的商店覆盖数；与现有活跃词去重。
 */
export function rankBudgetAdmissible<T extends { language: string; keyword: string }>(
  supportedLanguages: { code: string }[],
  platform: string,
  trackedKeywords: RankBudgetKeywordInput[],
  adds: T[],
): RankBudgetAdmissibleResult<T> {
  const base = rankBudgetStatus(supportedLanguages, platform, trackedKeywords);
  const existing = new Set(
    (trackedKeywords || [])
      .filter((item) => isActiveOnPlatform(item, platform))
      .map((item) => `${item.language}\u0000${item.keyword}`),
  );
  const accepted: T[] = [];
  const rejected: T[] = [];
  let daily = base.dailyInstances;
  for (const add of adds || []) {
    const key = `${add.language}\u0000${add.keyword}`;
    if (existing.has(key)) {
      rejected.push(add); // 已在采集中，无需重复采纳
      continue;
    }
    const cost = rankCostForLanguage(add.language, supportedLanguages);
    if (daily + cost > RANK_BUDGET_HARD_LIMIT_DAILY) {
      rejected.push(add);
      continue;
    }
    daily += cost;
    existing.add(key);
    accepted.push(add);
  }
  return { accepted, rejected, dailyAfter: daily };
}
