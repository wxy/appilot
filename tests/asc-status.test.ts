import { ascStateMeta } from "../src/renderer/lib/asc-status";

let errors = 0;
function check(ok: boolean, msg: string) {
  if (ok) console.log(`✅ PASS: ${msg}`);
  else { console.error(`❌ FAIL: ${msg}`); errors++; }
}

check(ascStateMeta("READY_FOR_SALE")?.label === "已上架", "READY_FOR_SALE → 已上架");
check(ascStateMeta("IN_REVIEW")?.tone === "amber", "IN_REVIEW → amber");
check(ascStateMeta("REJECTED")?.tone === "red", "REJECTED → red");
check(ascStateMeta("UNKNOWN_STATE")?.label === "UNKNOWN_STATE", "未知状态回退原值");
check(ascStateMeta(null) === null, "null → null");
check(ascStateMeta(undefined) === null, "undefined → null");

if (errors) process.exit(1);
console.log("done");
