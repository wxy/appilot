import assert from "node:assert/strict";
import type { PromotionCampaign, XPromotionSeriesItem } from "../packages/core/src/promotion";
import {
  defaultPromotionStoreLink,
  hydrateCampaignStoreLinks,
  promotionStoreLinkOptions,
  storeLinkForItem,
} from "../src/main/promotion-store-links";

const project = {
  storeProducts: [
    { id: "ios", platform: "ios", storeLinks: [{ platform: "ios", url: "https://apps.apple.com/app/iphone/id1" }] },
    { id: "mac", platform: "macos", storeLinks: [{ platform: "macos", url: "https://apps.apple.com/app/mac/id2" }] },
  ],
};
const options = promotionStoreLinkOptions(project);
assert.equal(defaultPromotionStoreLink(options)?.productId, "mac", "macOS is the default promotion link");

const item: XPromotionSeriesItem = {
  id: "item", order: 0, kind: "release", title: "Release", objective: "Launch", angle: "Update",
  sourceRefs: [], linkStrategy: "store", recommendedVisual: "raw", visualReason: "", alternateOpening: "",
  post: "Available on iPhone https://apps.apple.com/app/iphone/id1", sceneImagePrompt: "", screenshotImagePrompt: "",
  selectedAssetIds: [], revision: 1, status: "ready", createdAt: "2026-09-22T00:00:00Z", updatedAt: "2026-09-22T00:00:00Z",
};
assert.equal(storeLinkForItem(item, options)?.productId, "ios", "an existing post keeps the link it actually contains");

const campaign = {
  id: "campaign", projectId: "project", productId: "ios", releaseTag: "v1", appVersion: "1",
  storePublishedAt: "2026-09-22T00:00:00Z", sourceSnapshotHash: "hash",
  source: { appName: "App", appVersion: "1", releaseTag: "v1", storePublishedAt: "2026-09-22T00:00:00Z", storeUrl: options[1].url, summary: "", whatsNew: "", description: "", promotionAngles: [], screenshotTypes: [], rankBaseline: [] },
  recommendedPlatforms: ["x"], recommendedScreenshotTypes: [], enabledPlatforms: ["x"], status: "ready",
  assets: [], deliveries: [], seriesItems: [item], publicationEvents: [], createdAt: "2026-09-22T00:00:00Z", updatedAt: "2026-09-22T00:00:00Z",
} satisfies PromotionCampaign;
const hydrated = hydrateCampaignStoreLinks(campaign, options);
assert.equal(hydrated.seriesItems?.[0].storeProductId, "ios");
assert.equal(hydrated.seriesItems?.[0].storeUrl, options[0].url);

console.log("promotion store link tests passed ✓");
