import assert from "node:assert/strict";
import {
  executeRegisteredAction,
  findRecordedActionExecution,
  listRegisteredActions,
  previewRegisteredAction,
  recommendationActionCatalog,
  registeredActionIds,
  type AppActionRequest,
} from "../src/main/action-registry";
import { briefRecommendationCapabilities } from "../packages/core/src/ai/overview-brief";
import type { AppStore } from "../src/main/store";

class MemoryStore implements AppStore {
  private values = new Map<string, unknown>();

  constructor(projects: any[]) {
    this.values.set("projects", projects);
  }

  get<T = any>(key: string): T {
    return this.values.get(key) as T;
  }

  set(key: string, value: unknown): void {
    this.values.set(key, value);
  }
}

const project = {
  id: "project-1",
  trackedKeywords: [
    { language: "en", keyword: "path of light", status: "active", rationale: "test" },
  ],
  removedKeywords: [],
  storeProducts: [
    {
      id: "product-1",
      platform: "ios",
      supportedLanguages: [{ code: "en" }, { code: "zh-Hans" }],
      trackedKeywords: [
        { language: "en", keyword: "path of light", status: "active", rationale: "test" },
      ],
      removedKeywords: [],
    },
  ],
};
const store = new MemoryStore([project]);
const request = (
  actionId: AppActionRequest["actionId"],
  input: AppActionRequest["input"] = { language: "en", keyword: "path of light" },
): AppActionRequest => ({
  actionId,
  projectId: "project-1",
  productId: "product-1",
  input,
  source: "copilot",
  suggestionId: "suggestion-2",
});

assert.deepEqual(
  registeredActionIds().sort(),
  briefRecommendationCapabilities().map((item) => item.kind).sort(),
  "every AI-eligible capability must have a main-process executor",
);
assert.equal(listRegisteredActions().length, 6);
assert.equal(recommendationActionCatalog().every((item) => item.recommendationEligible), true);
assert.equal(recommendationActionCatalog().every((item) => item.inputSchema.type === "object"), true);

const addKeywordRequest = request("keyword.track.add", {
  language: "en",
  keyword: "safe night walk",
  rationale: "与产品定位一致，且尚未跟踪",
});
assert.equal(previewRegisteredAction(store, addKeywordRequest).available, true);
const addedKeyword = executeRegisteredAction(store, addKeywordRequest);
assert.equal(addedKeyword.execution.status, "verified");
assert.equal(addedKeyword.updatedProject.trackedKeywords.some((item: any) => item.keyword === "safe night walk"), true);
assert.equal(previewRegisteredAction(store, addKeywordRequest).available, false);

const addPlanRequest = request("copy-plan.add", {
  title: "突出离线安心感",
  instruction: "在描述与宣传文本中更清楚地表达离线也能使用。",
  reason: "用户反馈中反复询问网络依赖",
  fields: ["promotionalText", "description"],
  languages: ["en"],
});
assert.equal(previewRegisteredAction(store, addPlanRequest).available, true);
const addedPlan = executeRegisteredAction(store, addPlanRequest);
assert.equal(addedPlan.execution.status, "verified");
assert.equal(addedPlan.updatedProject.copyPlans[0].source, "copilot");
assert.equal(previewRegisteredAction(store, addPlanRequest).available, false);

const pausePreview = previewRegisteredAction(store, request("keyword.pause"));
assert.equal(pausePreview.available, true);
assert.match(pausePreview.immediateEffect, /暂停/);

const paused = executeRegisteredAction(store, request("keyword.pause"));
assert.equal(paused.execution.status, "verified");
assert.equal(paused.updatedProject.trackedKeywords[0].status, "paused");
assert.equal(previewRegisteredAction(store, request("keyword.pause")).available, false);

const resumed = executeRegisteredAction(store, request("keyword.resume"));
assert.equal(resumed.execution.status, "verified");
assert.equal(resumed.updatedProject.trackedKeywords[0].status, "active");

const removed = executeRegisteredAction(store, request("keyword.remove"));
assert.equal(removed.execution.status, "verified");
assert.equal(removed.updatedProject.trackedKeywords.some((item: any) => item.keyword === "path of light"), false);
assert.equal(removed.updatedProject.storeProducts[0].trackedKeywords.some((item: any) => item.keyword === "path of light"), false);
assert.equal(removed.updatedProject.removedKeywords[0].keyword, "path of light");

const restored = executeRegisteredAction(store, request("keyword.restore"));
assert.equal(restored.execution.status, "verified");
assert.equal(restored.updatedProject.trackedKeywords.some((item: any) => item.keyword === "path of light"), true);
assert.equal(restored.updatedProject.removedKeywords.length, 0);

assert.equal(store.get<any[]>("appActionExecutions").length, 6);
assert.equal(findRecordedActionExecution(store, restored.execution.id)?.status, "verified");
assert.throws(
  () => previewRegisteredAction(store, { ...request("keyword.pause"), projectId: "other" }),
  /不属于当前项目/,
);

console.log("action registry tests passed");
