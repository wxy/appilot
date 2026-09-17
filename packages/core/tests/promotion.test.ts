import assert from "node:assert/strict";
import {
  derivePromotionCampaignStatus,
  normalizePromotionAnalysis,
  normalizePromotionProfile,
  promotionPlatformUrl,
  revisionGeneratedDeliveries,
  xPostWeightedLength,
  validatePromotionProfile,
  type PromotionCampaign,
} from "../src/promotion";

const profile = normalizePromotionProfile({
  productId: "product-1",
  enabledPlatforms: ["x", "reddit"],
  reddit: { communities: [{ id: "macapps", label: "r/macapps" }] },
});
assert.deepEqual(validatePromotionProfile(profile), []);
assert.deepEqual(
  validatePromotionProfile(normalizePromotionProfile({ productId: "p", enabledPlatforms: ["reddit"] })),
  ["启用 Reddit 时至少需要一个目标社区"],
);
assert.equal(promotionPlatformUrl("reddit", "r/macapps"), "https://www.reddit.com/r/macapps/submit");
assert.equal(xPostWeightedLength("Hello https://example.com/very/long/path"), 29);
assert.equal(xPostWeightedLength("你好 👨‍👩‍👧‍👦"), 7);

const analysis = normalizePromotionAnalysis(
  { recommendation: "strong", recommendedPlatforms: ["x", "linkedin"], recommendedScreenshotTypes: ["A", "B", "C"] },
  ["x", "reddit"],
);
assert.deepEqual(analysis.recommendedPlatforms, ["x"]);
assert.deepEqual(analysis.recommendedScreenshotTypes, ["A", "B"]);

const campaign = {
  id: "campaign",
  projectId: "project",
  productId: "product",
  releaseTag: "v1.0.0",
  appVersion: "1.0.0",
  storePublishedAt: "2026-09-14T00:00:00.000Z",
  sourceSnapshotHash: "hash",
  source: {} as any,
  recommendation: "strong",
  recommendedPlatforms: ["x"],
  recommendedScreenshotTypes: [],
  enabledPlatforms: ["x"],
  status: "ready",
  assets: [],
  brief: {} as any,
  deliveries: [{ status: "published" } as any],
  publicationEvents: [],
  createdAt: "2026-09-14T00:00:00.000Z",
  updatedAt: "2026-09-14T00:00:00.000Z",
} satisfies PromotionCampaign;
assert.equal(derivePromotionCampaignStatus(campaign), "published");
assert.equal(
  derivePromotionCampaignStatus({
    ...campaign,
    seriesItems: [
      { status: "published" } as any,
      { status: "ready" } as any,
      { status: "skipped" } as any,
    ],
  }),
  "partially_published",
);
assert.equal(
  derivePromotionCampaignStatus({
    ...campaign,
    seriesItems: [{ status: "skipped" } as any],
  }),
  "draft",
);
assert.equal(
  derivePromotionCampaignStatus({ ...campaign, brief: undefined, deliveries: [], assets: [{ id: "a" } as any] }),
  "draft",
);
assert.equal(
  derivePromotionCampaignStatus({
    ...campaign,
    deliveries: [{ status: "published" } as any, { status: "ready" } as any],
  }),
  "partially_published",
);

const revised = revisionGeneratedDeliveries(
  [{ platform: "x", revision: 1, createdAt: "new-created", imagePrompt: "new prompt" } as any],
  [{ platform: "x", revision: 3, createdAt: "original-created", imagePrompt: "old background prompt" } as any],
);
assert.equal(revised[0].revision, 4);
assert.equal(revised[0].createdAt, "original-created");
assert.equal(revised[0].imagePrompt, "new prompt");

console.log("promotion domain normalization and status passed ✓");
