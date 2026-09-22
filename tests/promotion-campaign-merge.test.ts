import assert from "node:assert/strict";
import type { PromotionCampaign, PromotionSourceSnapshot, XPromotionSeriesItem } from "../packages/core/src/promotion";
import { mergePromotionCampaigns } from "../src/main/promotion-campaign-merge";
import { releasedPromotionDrafts } from "../src/main/promotion-releases";

const source: PromotionSourceSnapshot = {
  appName: "Example", appVersion: "2.0", releaseTag: "v2.0", storePublishedAt: "2026-09-22T00:00:00Z",
  storeUrl: "https://apps.apple.com/app/id1", summary: "", whatsNew: "", description: "", promotionAngles: [], screenshotTypes: [], rankBaseline: [],
};
const item: XPromotionSeriesItem = {
  id: "mac:1", order: 0, kind: "release", title: "发布", objective: "介绍", angle: "更新", sourceRefs: [], linkStrategy: "store",
  recommendedVisual: "raw", visualReason: "", post: "Ready post https://apps.apple.com/app/id1", alternateOpening: "",
  sceneImagePrompt: "", screenshotImagePrompt: "", selectedAssetIds: [], revision: 1, status: "ready",
  createdAt: "2026-09-22T00:00:00Z", updatedAt: "2026-09-22T00:00:00Z",
};

function campaign(overrides: Partial<PromotionCampaign>): PromotionCampaign {
  return {
    id: "old", projectId: "project", productId: "ios", releaseTag: "v2.0", appVersion: "2.0",
    storePublishedAt: source.storePublishedAt, sourceSnapshotHash: "hash", source, recommendedPlatforms: ["x"],
    recommendedScreenshotTypes: [], enabledPlatforms: ["x"], status: "draft", assets: [], deliveries: [],
    publicationEvents: [], createdAt: "2026-09-22T00:00:00Z", updatedAt: "2026-09-22T00:00:00Z", ...overrides,
  };
}

const blank = campaign({ id: "ios-task", productId: "ios", updatedAt: "2026-09-22T02:00:00Z" });
const generated = campaign({ id: "mac-task", productId: "macos", status: "ready", seriesItems: [item] });
const result = mergePromotionCampaigns(
  [blank, generated],
  { productIds: ["ios", "macos"], targetPlatforms: ["ios", "macos"] },
  () => "product-level-task",
);

assert.equal(result.campaigns.length, 1, "same-version per-platform tasks collapse into one");
assert.equal(result.campaigns[0].id, "product-level-task");
assert.equal(result.campaigns[0].seriesItems?.[0].post, item.post, "generated content wins over a newer blank task");
assert.deepEqual(result.campaigns[0].productIds, ["ios", "macos"]);
assert.deepEqual(result.campaigns[0].targetPlatforms, ["ios", "macos"]);
assert.equal(result.changed, true);

const releases = releasedPromotionDrafts({
  storeProducts: [
    { id: "ios", platform: "ios" },
    { id: "mac", platform: "macos" },
  ],
  storeSubmissionDrafts: [
    { id: "ios-2", productId: "ios", releaseTag: "v2.0.0", appVersion: "2.0.0", storeStatus: "prepared", ascSyncedAt: "2026-09-21T20:48:32.304Z", updatedAt: "2026-09-21T20:48:32.304Z" },
    { id: "mac-2", productId: "mac", releaseTag: "v2.0.0", appVersion: "2.0.0", storeStatus: "prepared", ascSyncedAt: "2026-09-21T20:48:36.954Z", updatedAt: "2026-09-21T20:48:36.954Z" },
    { id: "ios-1", productId: "ios", releaseTag: "v1.0.0", appVersion: "1.0.0", storeStatus: "released", updatedAt: "2026-08-01T00:00:00.000Z" },
  ],
});
assert.equal(releases.length, 2, "one promotion candidate is returned per app version");
assert.equal(releases.filter((release) => release.appVersion === "2.0.0").length, 1);
assert.equal(releases.find((release) => release.appVersion === "2.0.0")?.id, "mac-2", "macOS is the preferred source draft");

console.log("promotion campaign merge tests passed ✓");
