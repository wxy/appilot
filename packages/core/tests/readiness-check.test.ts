import {
  findStoreFieldLimitIssues,
  runReadinessChecks,
  STORE_FIELD_LIMITS,
} from "../src/readiness-check";

let errors = 0;
function check(ok: boolean, msg: string) {
  if (ok) console.log(`✅ PASS: ${msg}`);
  else { console.error(`❌ FAIL: ${msg}`); errors++; }
}

check(STORE_FIELD_LIMITS.promotionalText === 170 && STORE_FIELD_LIMITS.keywords === 100, "字段限制常量正确");

check(
  findStoreFieldLimitIssues([{
    language: "en", name: "x".repeat(30), subtitle: "", promotionalText: "",
    keywords: "", description: "", whatsNew: "",
  }]).length === 0,
  "字段恰好达到上限时允许确定",
);

const directLimitIssues = findStoreFieldLimitIssues([{
  language: "zh-Hans", name: "", subtitle: "", promotionalText: "",
  keywords: "x".repeat(101), description: "", whatsNew: "",
}]);
check(
  directLimitIssues.length === 1 &&
    directLimitIssues[0].field === "keywords" &&
    directLimitIssues[0].length === 101 &&
    directLimitIssues[0].limit === 100,
  "可取得确认动作所需的超限字段详情",
);

const base = {
  localizations: [{
    language: "en", locale: "en-US", name: "GloWalk", subtitle: "Path of Light",
    promotionalText: "p", keywords: "walk, light", description: "d", whatsNew: "w",
  }, {
    language: "zh-Hans", locale: "zh-Hans", name: "GloWalk", subtitle: "光之路",
    promotionalText: "p", keywords: "走路, 光", description: "d", whatsNew: "w",
  }],
  supportedLanguages: ["en", "zh-Hans"],
  versionTag: "v1.1.0",
  ascVersion: "1.1.0",
  buildAttached: true,
};

const allPass = runReadinessChecks(base);
check(allPass.every((item) => item.status === "pass"), "完备输入全部 pass");

const overLimit = runReadinessChecks({
  ...base,
  localizations: [{ ...base.localizations[0], promotionalText: "x".repeat(171) }],
});
check(overLimit.some((item) => item.status === "fail" && item.id.startsWith("limit:en:promotionalText")), "Promotional Text 超限 → fail");

const missingLang = runReadinessChecks({ ...base, supportedLanguages: ["en", "ja"] });
check(missingLang.find((item) => item.id === "localizations")?.status === "warning", "缺少本地化 → warning");

const versionMismatch = runReadinessChecks({ ...base, ascVersion: "1.2.0" });
check(versionMismatch.find((item) => item.id === "version")?.status === "fail", "版本号不一致 → fail");

const noAsc = runReadinessChecks({ ...base, ascVersion: null });
check(noAsc.find((item) => item.id === "version")?.status === "unknown", "无 ASC 版本 → unknown");

const noBuild = runReadinessChecks({ ...base, buildAttached: false });
check(noBuild.find((item) => item.id === "build")?.status === "fail", "未挂载构建 → fail");

if (errors) process.exit(1);
console.log("done");
