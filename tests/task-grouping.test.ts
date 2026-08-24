import { taskGroupKey } from "../src/renderer/lib/task-grouping";

let errors = 0;
function check(ok: boolean, msg: string) {
  if (ok) console.log(`✅ PASS: ${msg}`);
  else { console.error(`❌ FAIL: ${msg}`); errors++; }
}

const base = {
  projectName: "P",
  productName: "AI Pulse",
  kind: "rank",
  groupKey: "rank:p1:macos:en:de",
};

check(
  taskGroupKey(base) === "rank\u0000rank:p1:macos:en:de",
  "rank 任务按 groupKey 分组（保留 产品×平台×语言×storefront 粒度）",
);
check(
  taskGroupKey({ ...base, groupKey: undefined }) === "P\u0000AI Pulse\u0000rank",
  "rank 任务无 groupKey 时回退到产品分组",
);
check(
  taskGroupKey({ ...base, kind: "github-sync", groupKey: undefined }) === "sync\u0000P",
  "github-sync 按项目分组",
);
check(
  taskGroupKey({ ...base, kind: "ops-sync", groupKey: undefined }) === "sync\u0000P",
  "ops-sync 按项目分组",
);
check(
  taskGroupKey({ ...base, kind: "reviews-sync", groupKey: undefined }) === "P\u0000AI Pulse\u0000reviews-sync",
  "reviews-sync 按产品×类型分组",
);
check(
  taskGroupKey({ ...base, kind: "build-status", groupKey: undefined }) === "P\u0000AI Pulse\u0000build-status",
  "build-status 按产品×类型分组",
);

if (errors) process.exit(1);
console.log("done");
