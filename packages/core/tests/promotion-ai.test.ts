import assert from "node:assert/strict";
import {
  analyzePromotionValue,
  generatePromotionPackage,
  generateXPromotionImagePrompt,
  generateXPromotionSeriesItem,
  generateXPromotionSeriesPlan,
  regeneratePromotionDelivery,
  suggestRedditCommunities,
} from "../src/ai/promotion";
import { buildProjectProfile } from "../src/project-profile";
import { EngineError } from "../src/errors";
import type { ProductPromotionProfile, PromotionAsset, PromotionSourceSnapshot } from "../src/promotion";

const source: PromotionSourceSnapshot = {
  appName: "Example",
  appVersion: "1.2.0",
  releaseTag: "v1.2.0",
  storePublishedAt: "2026-09-14T00:00:00.000Z",
  storeUrl: "https://apps.apple.com/app/id1",
  summary: "A visible dashboard update",
  whatsNew: "Adds a cost dashboard.",
  description: "An app for developers.",
  promotionAngles: [],
  screenshotTypes: [{ id: "dashboard", name: "Dashboard", title: "Costs", description: "See usage" }],
  rankBaseline: [],
};
const profile: ProductPromotionProfile = {
  productId: "product",
  enabledPlatforms: ["x", "reddit"],
  reddit: { communities: [{ id: "macapps", label: "r/macapps" }] },
  updatedAt: "2026-09-14T00:00:00.000Z",
};
const assets: PromotionAsset[] = [{
  id: "asset-1",
  campaignId: "campaign",
  role: "screenshot",
  origin: "imported",
  managedPath: "/tmp/managed.png",
  sha256: "hash",
  mimeType: "image/png",
  fileName: "dashboard.png",
  width: 1290,
  height: 2796,
  importedAt: "2026-09-14T00:00:00.000Z",
}];

let lastMessages: any[] = [];
let lastOptions: any = null;
const provider = {
  chat: async (messages: any[], options: any) => {
    lastMessages = messages;
    lastOptions = options;
    if (messages[0].content.includes("Reddit communities")) {
      return JSON.stringify({ communities: [
        { name: "r/macapps", reason: "面向 Mac 应用用户", audienceFit: "Mac power users" },
        { name: "/r/macapps/", reason: "重复项", audienceFit: "重复" },
        { name: "not a subreddit", reason: "无效", audienceFit: "无效" },
      ] });
    }
    if (messages[0].content.includes("promotion strategist")) {
      return JSON.stringify({
        recommendation: "strong",
        reason: "用户可见的新能力",
        primaryAngle: "看清成本",
        recommendedPlatforms: ["x", "linkedin"],
        recommendedScreenshotTypes: ["Dashboard"],
      });
    }
    if (messages[0].content.includes("plan an X promotion series")) {
      return JSON.stringify({ items: [
        {
          kind: "feature",
          title: "成本看板",
          objective: "说明用户可以看清使用成本",
          angle: "让开发成本更透明",
          sourceRefs: ["whatsNew"],
          linkStrategy: "soft",
          recommendedVisual: "screenshot",
          visualReason: "真实界面最能证明功能已发布",
        },
        {
          kind: "conversation",
          title: "询问成本困扰",
          objective: "了解开发者如何查看成本",
          angle: "你如何追踪模型使用成本？",
          sourceRefs: ["description"],
          linkStrategy: "none",
          recommendedVisual: "scenario",
          visualReason: "用工作场景帮助代入",
        },
      ] });
    }
    if (messages[0].content.includes("one truthful, standalone X post")) {
      return JSON.stringify({
        post: "The cost dashboard is now live in Example. https://apps.apple.com/app/id1",
        alternateOpening: "A clearer view of AI costs.",
      });
    }
    if (messages[0].content.includes("one complete English image-generation prompt")) {
      return JSON.stringify({ imagePrompt: "Use dashboard.png as the intact central screenshot with restrained depth and generous whitespace." });
    }
    return JSON.stringify({
      brief: {
        audience: "需要了解开发成本的开发者",
        userProblem: "成本信息不透明",
        primaryAngle: "看清成本",
        valueStatement: "了解使用情况",
        evidence: [{ statement: "已发布成本看板", sourceRef: "whatsNew" }],
        callToAction: "查看应用",
        prohibitedClaims: ["未经证实的节省效果"],
      },
      deliveries: [
        {
          platform: "x",
          content: { post: "The cost dashboard is live. https://apps.apple.com/app/id1", alternateOpening: "Now shipping" },
          imagePrompt: "Use the attached screenshot to compose a finished promotional image.",
          negativePrompt: "No fake UI",
          aspectRatio: "16:9",
        },
        {
          platform: "reddit",
          targetId: "macapps",
          content: { title: "I built a cost dashboard", body: "I am the developer.", communityFit: "Native Mac app", developerDisclosure: true },
          imagePrompt: "Use the attached screenshot to compose a finished promotional image.",
          negativePrompt: "No fake UI",
          aspectRatio: "1:1",
        },
      ],
    });
  },
} as any;

async function main() {
  const communities = await suggestRedditCommunities(provider, {
    projectProfile: buildProjectProfile({ name: "Example", supportedLanguages: ["en"], description: "Mac developer app" }),
    audienceNotes: "Independent Mac developers",
  });
  assert.deepEqual(communities, [{ name: "r/macapps", reason: "面向 Mac 应用用户", audienceFit: "Mac power users" }]);

  const analysis = await analyzePromotionValue(provider, { source, profile });
  assert.deepEqual(analysis.recommendedPlatforms, ["x"]);

  const series = await generateXPromotionSeriesPlan(provider, {
    campaignId: "campaign",
    source,
    profile,
  });
  assert.equal(series.length, 2);
  assert.equal(series[0].status, "planned");
  assert.equal(series[0].post, "");
  assert.equal(series[1].linkStrategy, "store");
  assert.equal(lastOptions.thinking, "disabled");

  const seriesItem = await generateXPromotionSeriesItem(provider, {
    source,
    profile,
    item: series[0],
  });
  assert.equal(seriesItem.status, "ready");
  assert.equal(seriesItem.revision, 1);
  assert.equal(seriesItem.imagePrompt, "", "post generation does not create image work");
  const imagePrompt = await generateXPromotionImagePrompt(provider, {
    source,
    profile,
    item: seriesItem,
    kind: "screenshot",
    assets,
  });
  assert.match(imagePrompt, /Attach these real screenshots/i);
  assert.match(imagePrompt, /dashboard\.png/);
  await assert.rejects(
    () => generateXPromotionImagePrompt(provider, { source, profile, item: seriesItem, kind: "screenshot", assets: [] }),
    /请先选择至少一张参考截图/,
  );
  const scenePrompt = await generateXPromotionImagePrompt(provider, { source, profile, item: seriesItem, kind: "scene", assets: [] });
  assert.match(scenePrompt, /Do not place an app screenshot/i);

  const generated = await generatePromotionPackage(provider, {
    campaignId: "campaign",
    source,
    profile,
    platforms: ["x", "reddit"],
    primaryAngle: "看清成本",
    assets,
  });
  assert.equal(generated.deliveries.length, 2);
  assert.equal(generated.brief.audience, "需要了解开发成本的开发者");
  assert.equal(generated.deliveries[1].targetLabel, "r/macapps");
  assert.deepEqual(generated.deliveries[0].selectedAssetIds, ["asset-1"]);
  assert.match(generated.deliveries[0].imagePrompt, /Attach these real screenshots/);
  assert.match(generated.deliveries[0].imagePrompt, /Mandatory constraints: No fake UI/);
  assert.doesNotMatch(generated.deliveries[0].imagePrompt, /generate only a background/i);
  assert.equal(generated.deliveries[0].negativePrompt, "");
  assert.match(lastMessages[0].content, /operator-facing brief fields.*Simplified Chinese/i);
  assert.match(lastMessages[0].content, /hard output budgets/i);
  assert.equal(lastOptions.thinking, "disabled");

  let truncationAttempts = 0;
  let retryMaxTokens = 0;
  const truncatingProvider = {
    chat: async (messages: any[], options: any) => {
      truncationAttempts += 1;
      retryMaxTokens = options.maxTokens;
      if (truncationAttempts === 1) {
        throw new EngineError("truncated", "AI_OUTPUT_TRUNCATED");
      }
      return provider.chat(messages, options);
    },
  } as any;
  await generatePromotionPackage(truncatingProvider, {
    campaignId: "campaign-retry",
    source,
    profile,
    platforms: ["x"],
    primaryAngle: "看清成本",
    assets,
  });
  assert.equal(truncationAttempts, 2);
  assert.equal(retryMaxTokens, 14000);

  await regeneratePromotionDelivery(provider, {
    source,
    profile,
    platform: "x",
    primaryAngle: "看清成本",
    assets,
    current: generated.deliveries[0],
    feedback: "Less marketing language",
  });
  assert.match(lastMessages[1].content, /Less marketing language/);

  console.log("promotion AI request boundaries passed ✓");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
