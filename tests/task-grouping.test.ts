import { taskGroupKey, pickGroupNextRun } from "../src/renderer/lib/task-grouping";

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
  taskGroupKey({ ...base, kind: "build-status", groupKey: undefined }) === "P\u0000AI Pulse\u0000build-status",
  "build-status 按产品×类型分组",
);

// ── pickGroupNextRun：组级「下次执行」不再混入到期成员（修复 next<last 矛盾） ──
const now = new Date("2026-09-08T09:20:00Z");
const iso = (m: number) => new Date(now.getTime() + m * 60_000).toISOString();
const isoPast = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();

// 真实形态：某成员刚跑完（last=刚刚，next=明天），另一成员到期未跑
// （next 在过去 ≈ “下次执行”早于“上次执行”）。
{
  const members = [
    { nextRunAt: isoPast(1) }, // 到期未跑：上次刷新应显示为已到期，而非“下次执行”
    { nextRunAt: isoPast(7) },
    { nextRunAt: iso(14 * 60) }, // 未来排期
  ];
  const pick = pickGroupNextRun(members, now);
  check(pick.nextRunAt === iso(14 * 60), "到期成员不进“下次执行”，只取未来最小排期");
  check(pick.dueCount === 2, "到期成员数由 dueCount 呈现");
  check(
    pick.nextRunAt == null || new Date(pick.nextRunAt).getTime() > now.getTime(),
    "组级 nextRunAt 永不落在过去（next<last 矛盾消除）",
  );
}

// 整组到期（积压/暂停）：无未来排期 → null + dueCount=全部。
{
  const pick = pickGroupNextRun([{ nextRunAt: isoPast(3) }, { nextRunAt: isoPast(20) }], now);
  check(pick.nextRunAt === null && pick.dueCount === 2, "整组到期 → nextRunAt=null，UI 显示「已到期 ×2」");
}

// 全体已排到未来（一轮完成后新轮已排）：正常取最小未来值。
{
  const members = [
    { nextRunAt: iso(40) },
    { nextRunAt: iso(22 * 60) },
    { nextRunAt: iso(3 * 24 * 60) },
  ];
  const pick = pickGroupNextRun(members, now);
  check(pick.nextRunAt === iso(40) && pick.dueCount === 0, "全未来 → 最小未来排期，due=0");
}

// 无 nextRunAt / 非法值成员被跳过。
{
  const pick = pickGroupNextRun([{ nextRunAt: null }, { nextRunAt: "" }, { nextRunAt: iso(5) }], now);
  check(pick.nextRunAt === iso(5) && pick.dueCount === 0, "null/空 nextRunAt 忽略，不误计 due");
}

// 与「上次执行」语义对照：只要 next 在未来，必然晚于任何 last（<=now）。
{
  const lastRunAt = isoPast(2); // 该组 max(lastRunAt) ≈ 2 分钟前
  const pick = pickGroupNextRun([{ nextRunAt: iso(30) }], now);
  check(
    new Date(pick.nextRunAt!).getTime() > new Date(lastRunAt).getTime(),
    "未来排期必然晚于组内上次执行 → 展示不再自相矛盾",
  );
}

if (errors) process.exit(1);
console.log("done");
