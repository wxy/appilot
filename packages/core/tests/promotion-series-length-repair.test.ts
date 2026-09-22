import assert from "node:assert/strict";
import type { AIProvider, ChatMessage } from "../src/ai/ai-provider";
import { generateXPromotionSeriesItem } from "../src/ai/promotion";
import { xPostWeightedLength, type ProductPromotionProfile, type PromotionAsset, type PromotionSourceSnapshot, type XPromotionSeriesItem } from "../src/promotion";

const source: PromotionSourceSnapshot = {
  appName: "Appilot", appVersion: "1.2.0", releaseTag: "v1.2.0", storePublishedAt: "2026-09-22T00:00:00.000Z",
  storeUrl: "https://apps.apple.com/app/id123456789", summary: "A focused release workflow.", whatsNew: "Improved release review.",
  description: "Review and publish app releases.", promotionAngles: ["Clear release review"], screenshotTypes: [], rankBaseline: [],
};
const item: XPromotionSeriesItem = {
  id: "campaign-1:series:1", order: 0, kind: "release", title: "发布概览", objective: "介绍发布价值",
  angle: "更清晰地检查发布内容", sourceRefs: [], linkStrategy: "store", recommendedVisual: "screenshot",
  visualReason: "展示真实发布界面", post: "", alternateOpening: "", sceneImagePrompt: "", screenshotImagePrompt: "",
  selectedAssetIds: [], revision: 0, status: "planned", createdAt: source.storePublishedAt, updatedAt: source.storePublishedAt,
};
const asset: PromotionAsset = {
  id: "asset-1", campaignId: "campaign-1", role: "screenshot", origin: "imported", managedPath: "/tmp/screenshot.png",
  sha256: "abc", mimeType: "image/png", fileName: "screenshot.png", width: 1200, height: 800, importedAt: source.storePublishedAt,
};
const profile: ProductPromotionProfile = { productId: "product-1", enabledPlatforms: ["x"], updatedAt: source.storePublishedAt };

function providerFor(responses: unknown[], calls: ChatMessage[][]): AIProvider {
  return { async chat(messages: ChatMessage[]) { calls.push(messages); return JSON.stringify(responses.shift() || {}); } } as AIProvider;
}

async function main() {
  const calls: ChatMessage[][] = [];
  let retries = 0;
  const shortenedPost = `A clearer release review is here. ${source.storeUrl}`;
  const generated = await generateXPromotionSeriesItem(
    providerFor([
      { post: `Launch update: ${"detail ".repeat(50)}${source.storeUrl}`, alternateOpening: "A better way to review releases.", sceneImagePrompt: "Show a developer preparing a release.", screenshotImagePrompt: "Frame the attached screenshot with restrained depth." },
      { post: shortenedPost },
    ], calls),
    { source, profile, item, assets: [asset] },
    { onRetry: () => { retries += 1; } },
  );
  assert.equal(calls.length, 2, "an over-limit post triggers one shortening request");
  assert.equal(retries, 1, "the UI is told that an automatic repair started");
  assert.equal(generated.post, shortenedPost);
  assert.ok(xPostWeightedLength(generated.post) <= 280);
  assert.match(calls[1][0].content, /at most 260 characters/);
  assert.match(calls[1][1].content, /Current X weighted length:/);
  assert.equal(generated.alternateOpening, "A better way to review releases.", "other generated fields survive shortening");

  await assert.rejects(
    () => generateXPromotionSeriesItem(
      providerFor([
        { post: "x".repeat(281), alternateOpening: "Alt", sceneImagePrompt: "Scene", screenshotImagePrompt: "Screenshot" },
        { post: "y".repeat(281) },
      ], []),
      { source, profile, item, assets: [asset] },
    ),
    /修订后的 X 文案仍不符合链接或 280 字符限制/,
  );

  const missingLinkCalls: ChatMessage[][] = [];
  const repairedMissingLink = await generateXPromotionSeriesItem(
    providerFor([
      { post: "A clearer release review is here.", alternateOpening: "Alt", sceneImagePrompt: "Scene", screenshotImagePrompt: "" },
      { post: shortenedPost },
    ], missingLinkCalls),
    { source, profile, item, assets: [] },
  );
  assert.equal(missingLinkCalls.length, 2, "a missing store link triggers repair");
  assert.ok(repairedMissingLink.post.includes(source.storeUrl));
  assert.equal(repairedMissingLink.screenshotImagePrompt, "", "screenshot prompt stays empty when no screenshot is selected");
  console.log("promotion AI length repair tests passed ✓");
}

main().catch((error) => { console.error(error); process.exit(1); });
