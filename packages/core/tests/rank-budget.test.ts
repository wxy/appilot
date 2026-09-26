import {
  RANK_BUDGET_HARD_LIMIT_DAILY,
  RANK_BUDGET_SOFT_LIMIT_DAILY,
  rankBudgetSelection,
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

  // 采纳只去重，超过参考线也不能丢弃用户选择。
  const adds = Array.from({ length: 200 }, (_, i) => ({
    language: "de",
    keyword: `new-de-${i}`,
  }));
  const selection = rankBudgetSelection(LANGS, "ios", keywords as any, adds);
  check(selection.selected.length === adds.length && selection.duplicates.length === 0, "超参考线仍采纳所有非重复词");
  check(
    selection.dailyAfter === status.dailyInstances + adds.length * deCost,
    "采纳后采集量估算包含全部所选词",
  );
  check(selection.dailyAfter > RANK_BUDGET_HARD_LIMIT_DAILY, "采集量可以超过高负载参考线");

  const duplicate = rankBudgetSelection(LANGS, "ios", keywords as any, [
    { language: "en", keyword: "global walk" },
    { language: "de", keyword: "new term" },
    { language: "de", keyword: "new term" },
  ]);
  check(duplicate.selected.length === 1 && duplicate.duplicates.length === 2, "只过滤已有词和本批重复词");

  const overBudget = rankBudgetStatus(LANGS, "ios", [
    ...keywords,
    ...selection.selected,
  ]);
  check(overBudget.state === "hard" && overBudget.dailyInstances === selection.dailyAfter, "超参考线仍完整计入状态");
  check(RANK_BUDGET_SOFT_LIMIT_DAILY < RANK_BUDGET_HARD_LIMIT_DAILY, "软提醒线 < 高负载参考线");

  console.log(`\n${errors === 0 ? "🎉 All rank budget tests passed!" : `❌ ${errors} test(s) failed`}`);
  process.exit(errors > 0 ? 1 : 0);
}

main();
