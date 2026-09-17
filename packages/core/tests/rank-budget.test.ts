import {
  RANK_BUDGET_HARD_LIMIT_DAILY,
  RANK_BUDGET_SOFT_LIMIT_DAILY,
  rankBudgetAdmissible,
  rankBudgetStatus,
  rankCostForLanguage,
} from "../src/rank-budget";
import { storefrontsForLanguage } from "../src/storefronts";

let errors = 0;
function check(condition: boolean, msg: string) {
  if (!condition) {
    errors += 1;
    console.error(`❌ FAIL: ${msg}`);
  } else {
    console.log(`✅ PASS: ${msg}`);
  }
}

const LANGS = [{ code: "en" }, { code: "zh-Hans" }, { code: "de" }];

function main() {
  // 成本模型：en 全局词覆盖全部本地化的商店；单语言词只计自身本地化。
  const enCost = rankCostForLanguage("en", LANGS);
  const deCost = rankCostForLanguage("de", LANGS);
  check(
    enCost ===
      storefrontsForLanguage("en").length +
        storefrontsForLanguage("zh-Hans").length +
        storefrontsForLanguage("de").length,
    "en 全局词成本 = 全部本地化商店之和",
  );
  check(deCost === storefrontsForLanguage("de").length, "de 词成本 = de 本地化商店数");
  check(enCost > deCost, "en 全局词比单语言词贵");

  // 预算状态：暂停/待复核关键词不计入。
  const keywords = [
    { language: "en", keyword: "global walk" },
    { language: "de", keyword: "spaziergang app" },
    { language: "en", keyword: "paused one", status: "paused" },
    {
      language: "zh-Hans",
      keyword: "pending one",
      pendingPausePlatforms: ["ios"],
    },
  ];
  const status = rankBudgetStatus(LANGS, "ios", keywords as any);
  check(status.activeKeywords === 2, "暂停/待复核关键词不计入活跃数");
  check(
    status.dailyInstances === enCost + deCost,
    "每日实例 = 活跃词成本之和（en + de）",
  );
  check(status.state === "ok" && status.remaining === RANK_BUDGET_HARD_LIMIT_DAILY - status.dailyInstances, "预算内状态 ok");

  // 采纳门控：预算内全收；超硬上限拒收尾部；与现有词去重。
  const adds = Array.from({ length: 200 }, (_, i) => ({
    language: "de",
    keyword: `new-de-${i}`,
  }));
  const admissible = rankBudgetAdmissible(LANGS, "ios", keywords as any, adds);
  check(admissible.accepted.length + admissible.rejected.length === adds.length, "采纳+拒绝 = 总数");
  check(
    admissible.dailyAfter <= RANK_BUDGET_HARD_LIMIT_DAILY,
    "采纳后不超过硬上限",
  );
  check(admissible.rejected.length > 0, "大批量新增会被硬上限裁剪");

  const duplicate = rankBudgetAdmissible(LANGS, "ios", keywords as any, [
    { language: "en", keyword: "global walk" },
  ]);
  check(duplicate.accepted.length === 0 && duplicate.rejected.length === 1, "与现有活跃词重复 → 拒收");

  // 软上限仅提示、硬上限才拦截（常量契约）。
  check(RANK_BUDGET_SOFT_LIMIT_DAILY < RANK_BUDGET_HARD_LIMIT_DAILY, "软上限 < 硬上限");

  console.log(`\n${errors === 0 ? "🎉 All rank budget tests passed!" : `❌ ${errors} test(s) failed`}`);
  process.exit(errors > 0 ? 1 : 0);
}

main();
