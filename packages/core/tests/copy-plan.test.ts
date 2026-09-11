import assert from "node:assert/strict";
import {
  copyPlanMaterial,
  copyPlansForProduct,
  createCopyPlanItem,
  deleteCopyPlan,
  markCopyPlansUsed,
  normalizeCopyPlanInput,
  upsertCopyPlan,
} from "../src/copy-plan";

const input = normalizeCopyPlanInput({
  title: "突出离线安心感",
  instruction: "说明无需网络也能继续记录。",
  reason: "用户关心网络依赖",
  fields: ["description", "whatsNew", "keywords"],
  languages: ["en", "unsupported"],
}, ["en", "zh-Hans"]);

assert.ok(input);
assert.deepEqual(input.fields, ["description", "keywords"], "更新内容不是文案计划可选字段");
assert.deepEqual(input.languages, ["en"], "只保留产品支持的语言");

const item = createCopyPlanItem({
  projectId: "project-1",
  productId: "product-1",
  input,
  source: "manual",
  now: "2026-09-11T01:00:00.000Z",
  id: "plan-1",
});
const project: any = { copyPlans: [] };
upsertCopyPlan(project, item);
assert.deepEqual(copyPlansForProduct(project, "product-1").map((plan) => plan.id), ["plan-1"]);
assert.equal(copyPlanMaterial(project.copyPlans, "en")[0].includes("无需网络"), true);
assert.equal(copyPlanMaterial(project.copyPlans, "zh-Hans").length, 0, "按语言筛选生成素材");

assert.equal(markCopyPlansUsed(project, "product-1", "draft-1", ["en"], "2026-09-11T02:00:00.000Z"), 1);
assert.equal(project.copyPlans[0].lastUsedDraftId, "draft-1");
assert.equal(deleteCopyPlan(project, "product-1", "plan-1"), true);
assert.equal(project.copyPlans.length, 0, "删除计划不依赖草稿且只删除目标记录");

console.log("copy plan tests passed");
