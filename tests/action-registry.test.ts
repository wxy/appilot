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
      trackedKeywords: [
        { language: "en", keyword: "path of light", status: "active", rationale: "test" },
      ],
      removedKeywords: [],
    },
  ],
};
const store = new MemoryStore([project]);
const request = (actionId: AppActionRequest["actionId"]): AppActionRequest => ({
  actionId,
  projectId: "project-1",
  productId: "product-1",
  input: { language: "en", keyword: "path of light" },
  source: "copilot",
  suggestionId: "suggestion-2",
});

assert.deepEqual(
  registeredActionIds().sort(),
  briefRecommendationCapabilities().map((item) => item.kind).sort(),
  "every AI-eligible capability must have a main-process executor",
);
assert.equal(listRegisteredActions().length, 4);
assert.equal(recommendationActionCatalog().every((item) => item.recommendationEligible), true);

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
assert.equal(removed.updatedProject.trackedKeywords.length, 0);
assert.equal(removed.updatedProject.storeProducts[0].trackedKeywords.length, 0);
assert.equal(removed.updatedProject.removedKeywords[0].keyword, "path of light");

const restored = executeRegisteredAction(store, request("keyword.restore"));
assert.equal(restored.execution.status, "verified");
assert.equal(restored.updatedProject.trackedKeywords[0].keyword, "path of light");
assert.equal(restored.updatedProject.removedKeywords.length, 0);

assert.equal(store.get<any[]>("appActionExecutions").length, 4);
assert.equal(findRecordedActionExecution(store, restored.execution.id)?.status, "verified");
assert.throws(
  () => previewRegisteredAction(store, { ...request("keyword.pause"), projectId: "other" }),
  /不属于当前项目/,
);

console.log("action registry tests passed");
