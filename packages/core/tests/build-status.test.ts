import { buildStatusForVersion, mapBuildState, suggestedNextStep } from "../src/build-status";
import type { AscBuild, AscVersion } from "../src/asc-api";

let errors = 0;
function check(ok: boolean, msg: string) {
  if (ok) console.log(`✅ PASS: ${msg}`);
  else { console.error(`❌ FAIL: ${msg}`); errors++; }
}

check(mapBuildState("PROCESSING", null) === "processing", "PROCESSING → processing");
check(mapBuildState("VALID", null) === "available", "VALID → available");
check(mapBuildState("FAILED", null) === "rejected", "FAILED → rejected");
check(mapBuildState("VALID", "IN_REVIEW") === "inBetaReview", "beta IN_REVIEW → inBetaReview");
check(mapBuildState("VALID", "APPROVED") === "available", "beta APPROVED → available");
check(mapBuildState(null, null) === "unknown", "空值 → unknown");
check(suggestedNextStep("available")?.kind === "info", "available 有 info 建议");
check(suggestedNextStep("rejected")?.kind === "warning", "rejected 有 warning 建议");

const version: AscVersion = { id: "v1", versionString: "1.1.0", appStoreState: "READY_FOR_SALE", createdDate: null, buildId: "b9" };
const builds: AscBuild[] = [
  { id: "b9", version: "45", processingState: "VALID", uploadedDate: null, betaReviewState: null },
  { id: "b8", version: "44", processingState: "PROCESSING", uploadedDate: null, betaReviewState: null },
];
const info = buildStatusForVersion(version, builds);
check(info?.state === "available", "按 buildId 匹配到可用构建");
const noMatch = buildStatusForVersion(version, [{ id: "x", version: "99", processingState: "VALID", uploadedDate: null, betaReviewState: null }]);
check(noMatch?.state === "unknown", "未匹配构建 → unknown");
check(buildStatusForVersion(null, builds) === null, "无版本 → null");

if (errors) process.exit(1);
console.log("done");
