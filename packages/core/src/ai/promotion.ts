import type { AIProvider } from "./ai-provider";
import { buildArchiveMessages, requestJson } from "./ai-request";
import type { ProjectProfile } from "../project-profile";
import { EngineError } from "../errors";
import {
  normalizePromotionAnalysis,
  xPostWeightedLength,
  type ProductPromotionProfile,
  type PromotionAnalysis,
  type PromotionAsset,
  type PromotionBrief,
  type PromotionDelivery,
  type PromotionPlatform,
  type PromotionSourceSnapshot,
  type RedditCommunitySuggestion,
  type XPromotionSeriesItem,
  type XPromotionSeriesItemKind,
} from "../promotion";

interface PromotionAiCallbacks {
  onProgress?: (received: { chars: number; phase: "reasoning" | "content" }) => void;
  onRetry?: () => void;
  signal?: AbortSignal;
}

export async function generateXPromotionSeriesPlan(
  provider: AIProvider,
  input: {
    campaignId: string;
    source: PromotionSourceSnapshot;
    profile: ProductPromotionProfile;
    projectProfile?: ProjectProfile;
  },
  callbacks: PromotionAiCallbacks = {},
): Promise<XPromotionSeriesItem[]> {
  const messages = buildArchiveMessages(
    input.projectProfile,
    [
      "You plan an X promotion series for a shipped app release.",
      "Create 1 to 5 independent post ideas. This is a plan only: do not write final public posts or image prompts.",
      "Use only supplied release facts. Never split trivial details into posts and never invent features, users, outcomes, awards, or performance.",
      "A small release may need only one item. A substantial release may include: one release overview, distinct feature spotlights, one real use-case angle, and one honest conversation question.",
      "Each item must have standalone value and must not repeat another item. Do not create a thread.",
      "Operator-facing title, objective, angle, and visualReason must be concise Simplified Chinese.",
      "Every planned post will include the supplied App Store link; always return linkStrategy:'store'.",
      "recommendedVisual is scenario, screenshot, or raw. Scenario means a separate use-scene image; screenshot means AI packaging around real screenshots; raw means the unmodified screenshot.",
      "Return ONLY JSON: {items:[{kind:'release|feature|use_case|conversation',title,objective,angle,sourceRefs:string[],linkStrategy:'store',recommendedVisual:'scenario|screenshot|raw',visualReason}]}",
    ].join("\n"),
    [
      `Release source:\n${JSON.stringify(input.source)}`,
      `Audience notes: ${input.profile.audienceNotes || "N/A"}`,
      `Tone notes: ${input.profile.toneNotes || "N/A"}`,
    ],
  );
  const raw = await requestJson(provider, messages, {
    temperature: 0.3,
    maxTokens: 2600,
    thinking: "disabled",
    onProgress: callbacks.onProgress,
    onRetry: callbacks.onRetry,
    signal: callbacks.signal,
  });
  const now = new Date().toISOString();
  const kinds: XPromotionSeriesItemKind[] = ["release", "feature", "use_case", "conversation"];
  const visuals = ["scenario", "screenshot", "raw"] as const;
  return (Array.isArray(raw?.items) ? raw.items : [])
    .slice(0, 5)
    .map((item: any, index: number): XPromotionSeriesItem => ({
      id: `${input.campaignId}:series:${index + 1}`,
      order: index,
      kind: kinds.includes(item?.kind) ? item.kind : index === 0 ? "release" : "feature",
      title: String(item?.title || `内容 ${index + 1}`).trim(),
      objective: String(item?.objective || "介绍一个明确的用户价值").trim(),
      angle: String(item?.angle || input.source.summary || input.source.whatsNew).trim(),
      sourceRefs: (Array.isArray(item?.sourceRefs) ? item.sourceRefs : [])
        .map((value: unknown) => String(value).trim())
        .filter(Boolean)
        .slice(0, 4),
      linkStrategy: "store",
      recommendedVisual: visuals.includes(item?.recommendedVisual) ? item.recommendedVisual : "screenshot",
      visualReason: String(item?.visualReason || "用真实画面支持这一条内容").trim(),
      post: "",
      alternateOpening: "",
      sceneImagePrompt: "",
      screenshotImagePrompt: "",
      selectedAssetIds: [],
      revision: 0,
      status: "planned",
      createdAt: now,
      updatedAt: now,
    }));
}

export async function generateXPromotionSeriesItem(
  provider: AIProvider,
  input: {
    source: PromotionSourceSnapshot;
    profile: ProductPromotionProfile;
    item: XPromotionSeriesItem;
    assets: PromotionAsset[];
    projectProfile?: ProjectProfile;
  },
  callbacks: PromotionAiCallbacks = {},
): Promise<XPromotionSeriesItem> {
  const assetFacts = input.assets.map((asset, index) => ({
    id: asset.id,
    role: index === 0 ? "primary screenshot" : "secondary screenshot",
    fileName: asset.fileName,
    width: asset.width,
    height: asset.height,
  }));
  const messages = buildArchiveMessages(
    input.projectProfile,
    [
      "You create one truthful, standalone X post from an approved promotion-series plan item.",
      "The public post and alternateOpening must be natural English. Target at most 260 weighted characters for the post, with a hard X limit of 280; every URL counts as 23 characters.",
      `The post must include this exact App Store URL once: ${input.source.storeUrl}`,
      "Use only supplied facts. Do not invent adoption, safety guarantees, outcomes, awards, performance, testimonials, or features.",
      input.assets.length
        ? "Create two distinct English image prompts, each usable independently."
        : "Create sceneImagePrompt normally and return an empty screenshotImagePrompt because no screenshot was supplied.",
      "sceneImagePrompt: generate a finished, concrete real-world use scene expressing the item angle. Do not embed an app screenshot and do not show invented or readable app UI on a device. It may use the screenshots only as visual-language references.",
      "screenshotImagePrompt: tell the operator to attach the named real screenshots and create a finished promotional composition around them. Keep every screenshot intact, flat, legible, and unmodified; add only surrounding background, light, depth, spacing, and restrained decoration.",
      "Both prompts must include all prohibitions inline. No separate negative prompt. No fake UI, text, numbers, badges, ratings, awards, logos, or watermarks.",
      "Return ONLY JSON: {post,alternateOpening,sceneImagePrompt,screenshotImagePrompt}.",
    ].join("\n"),
    [
      `Approved plan item:\n${JSON.stringify(input.item)}`,
      `Release source:\n${JSON.stringify(input.source)}`,
      `Selected screenshot metadata:\n${JSON.stringify(assetFacts)}`,
      `Audience notes: ${input.profile.audienceNotes || "N/A"}`,
      `Tone notes: ${input.profile.toneNotes || "N/A"}`,
    ],
  );
  const raw = await requestJson(provider, messages, {
    temperature: 0.4,
    maxTokens: 4200,
    thinking: "disabled",
    onProgress: callbacks.onProgress,
    onRetry: callbacks.onRetry,
    signal: callbacks.signal,
  });
  const now = new Date().toISOString();
  let post = String(raw?.post || "").trim();
  if (!post) throw new EngineError("AI 没有返回可用的 X 文案", "AI_RESPONSE_INVALID");
  if (xPostWeightedLength(post) > 280 || !post.includes(input.source.storeUrl)) {
    callbacks.onRetry?.();
    const shortened = await requestJson(
      provider,
      [
        {
          role: "system",
          content: [
            "You shorten an existing English X post without adding any new claims.",
            "Return ONLY JSON: {post}.",
            "The revised post must have a conservative X weighted length of at most 260 characters; every URL counts as 23 characters.",
            "Preserve the meaning and tone. Remove secondary wording or hashtags before removing the core user value.",
            `Include this exact App Store URL once: ${input.source.storeUrl}`,
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `Current X weighted length: ${xPostWeightedLength(post)}`,
            `Required App Store URL: ${input.source.storeUrl}`,
            `Post to shorten:\n${post}`,
          ].join("\n\n"),
        },
      ],
      {
        temperature: 0.1,
        maxTokens: 800,
        thinking: "disabled",
        onProgress: callbacks.onProgress,
        onRetry: callbacks.onRetry,
        signal: callbacks.signal,
      },
    );
    post = String(shortened?.post || "").trim();
    if (!post || xPostWeightedLength(post) > 280 || !post.includes(input.source.storeUrl)) {
      throw new EngineError("AI 修订后的 X 文案仍不符合链接或 280 字符限制，请重新生成", "AI_RESPONSE_INVALID");
    }
  }
  return {
    ...input.item,
    post,
    alternateOpening: String(raw?.alternateOpening || "").trim(),
    sceneImagePrompt: completeSceneImagePrompt(String(raw?.sceneImagePrompt || ""), input),
    screenshotImagePrompt: input.assets.length
      ? completeImagePrompt(
          String(raw?.screenshotImagePrompt || defaultImagePrompt(input.assets)),
          defaultNegativePrompt(),
          input.assets,
        )
      : "",
    selectedAssetIds: input.assets.map((asset) => asset.id),
    revision: input.item.revision + 1,
    status: "ready",
    updatedAt: now,
  };
}

function completeSceneImagePrompt(
  prompt: string,
  input: { source: PromotionSourceSnapshot; item: XPromotionSeriesItem },
): string {
  return [
    prompt.trim() || `Create a finished real-world use-scene image for ${input.source.appName}, expressing this angle: ${input.item.angle}.`,
    "The result must work as a complete promotional image without later compositing.",
    "Do not place an app screenshot in the scene and do not invent or render readable app UI on any device.",
    "No fake UI, added text, numbers, badges, ratings, awards, logos, or watermarks.",
  ].join(" ");
}

export async function suggestRedditCommunities(
  provider: AIProvider,
  input: {
    projectProfile: ProjectProfile;
    audienceNotes?: string;
    existingCommunities?: string[];
  },
  callbacks: PromotionAiCallbacks = {},
): Promise<RedditCommunitySuggestion[]> {
  const messages = buildArchiveMessages(
    input.projectProfile,
    [
      "You recommend relevant Reddit communities for an independent app developer's post-release promotion.",
      "Base the choices on the supplied product positioning, platform, audience, README, and keywords.",
      "Suggest 3 to 5 focused communities with strong audience fit. Avoid huge generic communities unless the fit is unusually strong.",
      "Names should be plausible existing subreddit names, but never claim that promotion is currently allowed or that rules were verified.",
      "Write reason and audienceFit in concise Simplified Chinese.",
      "Return ONLY JSON: {communities:[{name:'r/example',reason:string,audienceFit:string}]}",
    ].join("\n"),
    [
      `Operator audience notes: ${input.audienceNotes || "N/A"}`,
      `Already selected communities: ${(input.existingCommunities || []).join(", ") || "None"}`,
    ],
  );
  const raw = await requestJson(provider, messages, {
    temperature: 0.25,
    maxTokens: 1800,
    thinking: "low",
    onProgress: callbacks.onProgress,
    onRetry: callbacks.onRetry,
    signal: callbacks.signal,
  });
  const seen = new Set<string>();
  return (Array.isArray(raw?.communities) ? raw.communities : [])
    .map((item: any) => {
      const bare = String(item?.name || "").trim().replace(/^\/?r\//i, "").replace(/\/$/, "");
      return {
        name: bare ? `r/${bare}` : "",
        reason: String(item?.reason || "").trim(),
        audienceFit: String(item?.audienceFit || "").trim(),
      };
    })
    .filter((item: RedditCommunitySuggestion) => {
      const key = item.name.toLowerCase();
      if (!/^r\/[a-z0-9_]+$/i.test(item.name) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
}

export async function analyzePromotionValue(
  provider: AIProvider,
  input: {
    source: PromotionSourceSnapshot;
    profile: ProductPromotionProfile;
    projectProfile?: ProjectProfile;
  },
  callbacks: PromotionAiCallbacks = {},
): Promise<PromotionAnalysis> {
  const messages = buildArchiveMessages(
    input.projectProfile,
    [
      "You are Appilot's post-release promotion strategist.",
      "Decide whether this shipped release deserves strong promotion, a light update, or should be skipped.",
      "Use only the supplied release facts. Never invent features, adoption, performance, awards, or outcomes.",
      "The reason and primaryAngle must be concise Simplified Chinese for the operator UI.",
      "Return ONLY JSON: {recommendation:'strong|light|skip',reason:string,primaryAngle:string,recommendedPlatforms:['x'|'reddit'|'facebook'],recommendedScreenshotTypes:string[]}.",
      "Recommend at most two screenshot types. A small internal-only release should be skipped.",
    ].join("\n"),
    [
      `Release source:\n${JSON.stringify(input.source)}`,
      `Enabled platforms: ${input.profile.enabledPlatforms.join(", ")}`,
      `Audience notes: ${input.profile.audienceNotes || "N/A"}`,
      `Tone notes: ${input.profile.toneNotes || "N/A"}`,
    ],
  );
  const raw = await requestJson(provider, messages, {
    temperature: 0.2,
    maxTokens: 1400,
    thinking: "low",
    onProgress: callbacks.onProgress,
    onRetry: callbacks.onRetry,
    signal: callbacks.signal,
  });
  return normalizePromotionAnalysis(raw, input.profile.enabledPlatforms);
}

export async function generatePromotionPackage(
  provider: AIProvider,
  input: {
    campaignId: string;
    source: PromotionSourceSnapshot;
    profile: ProductPromotionProfile;
    platforms: PromotionPlatform[];
    primaryAngle: string;
    assets: PromotionAsset[];
    projectProfile?: ProjectProfile;
    revisionFeedback?: string;
    currentDelivery?: PromotionDelivery;
  },
  callbacks: PromotionAiCallbacks = {},
): Promise<{ brief: PromotionBrief; deliveries: PromotionDelivery[] }> {
  const targetLines = input.platforms.map((platform) => {
    if (platform === "reddit") return `Reddit targets: ${JSON.stringify(input.profile.reddit?.communities || [])}`;
    if (platform === "facebook") return `Facebook targets: ${JSON.stringify(input.profile.facebook?.surfaces || [])}`;
    return `X account: ${input.profile.x?.accountLabel || "configured account"}`;
  });
  const assetFacts = input.assets.map((asset, index) => ({
    id: asset.id,
    role: index === 0 ? "primary screenshot" : "secondary screenshot",
    fileName: asset.fileName,
    width: asset.width,
    height: asset.height,
  }));
  const messages = buildArchiveMessages(
    input.projectProfile,
    [
      "You create truthful social promotion packages for a shipped app release.",
      "The operator-facing brief fields (audience, userProblem, primaryAngle, valueStatement, evidence, callToAction, prohibitedClaims) must be concise Simplified Chinese.",
      "The public-facing platform content (post, alternateOpening, title, body) must be natural English. communityFit is operator-facing and must be Simplified Chinese.",
      "Use only supplied facts. Do not infer features from screenshots and do not claim unproved growth, popularity, performance, awards, or outcomes.",
      "Write platform-native content, not the same copy resized. Reddit must clearly disclose that the author is the developer and must fit the named community. Facebook must fit its named surface.",
      "X post should fit 280 characters including the supplied store URL. Do not generate a thread.",
      "Each imagePrompt must be a single self-contained English prompt for ChatGPT or another reference-image-capable generator.",
      "It must tell the operator to attach the named real screenshots and ask the model to compose them directly into a finished promotional image, not generate a background for later manual compositing.",
      "State which screenshot is primary and which is secondary, describe composition and whitespace, and include every prohibition directly in imagePrompt.",
      "Require preserving the attached screenshots as source assets without redrawing or altering their UI, text, numbers, colors, proportions, or layout. Never request fake features, badges, ratings, awards, logos, or watermarks.",
      "Set negativePrompt to an empty string; it exists only for backward compatibility and must not require a separate input field.",
      "Be concise and obey these hard output budgets: audience <= 60 Chinese characters; userProblem, primaryAngle, and valueStatement <= 80 Chinese characters each; at most 3 evidence items; at most 5 prohibitedClaims.",
      "For each delivery: alternateOpening <= 100 characters; Reddit title <= 140 characters; Reddit body and Facebook post <= 1200 characters; communityFit <= 100 Chinese characters; imagePrompt <= 1200 English characters.",
      "Return ONLY one JSON object with brief and deliveries.",
      "brief shape: {audience,userProblem,primaryAngle,valueStatement,evidence:[{statement,sourceRef}],callToAction,prohibitedClaims:string[]}.",
      "delivery shape: {platform,targetId,targetLabel,content:{post,alternateOpening,title,body,communityFit,developerDisclosure},imagePrompt,negativePrompt,aspectRatio}.",
    ].join("\n"),
    [
      `Confirmed angle: ${input.primaryAngle}`,
      `Release source:\n${JSON.stringify(input.source)}`,
      `Selected screenshot metadata:\n${JSON.stringify(assetFacts)}`,
      `Platforms: ${input.platforms.join(", ")}`,
      ...targetLines,
      `Audience notes: ${input.profile.audienceNotes || "N/A"}`,
      `Tone notes: ${input.profile.toneNotes || "N/A"}`,
      ...(input.currentDelivery
        ? [
            `Current ${input.currentDelivery.platform} delivery:\n${JSON.stringify(input.currentDelivery.content)}`,
            `Revision feedback: ${input.revisionFeedback || "Create a distinct, improved alternative while preserving every factual boundary."}`,
          ]
        : []),
    ],
  );
  const request = (maxTokens: number) => requestJson(provider, messages, {
    temperature: 0.45,
    maxTokens,
    // Promotion value was already analyzed in the previous step. Keeping
    // reasoning enabled here can consume the output budget before JSON starts,
    // especially on DeepSeek-compatible providers.
    thinking: "disabled",
    onProgress: callbacks.onProgress,
    onRetry: callbacks.onRetry,
    signal: callbacks.signal,
  });
  let raw: any;
  try {
    raw = await request(7000);
  } catch (error) {
    if (!(error instanceof EngineError) || error.code !== "AI_OUTPUT_TRUNCATED") throw error;
    callbacks.onRetry?.();
    raw = await request(14000);
  }
  return normalizePromotionPackage(raw, input);
}

export async function regeneratePromotionDelivery(
  provider: AIProvider,
  input: {
    source: PromotionSourceSnapshot;
    profile: ProductPromotionProfile;
    platform: PromotionPlatform;
    primaryAngle: string;
    assets: PromotionAsset[];
    current: PromotionDelivery;
    feedback: string;
    projectProfile?: ProjectProfile;
  },
  callbacks: PromotionAiCallbacks = {},
): Promise<PromotionDelivery> {
  const generated = await generatePromotionPackage(
    provider,
    {
      campaignId: input.current.id.split(":delivery:")[0] || input.current.id,
      source: input.source,
      profile: input.profile,
      platforms: [input.platform],
      primaryAngle: input.primaryAngle,
      assets: input.assets,
      projectProfile: input.projectProfile,
      revisionFeedback: input.feedback,
      currentDelivery: input.current,
    },
    callbacks,
  );
  const candidate = generated.deliveries[0];
  return {
    ...candidate,
    id: input.current.id,
    revision: input.current.revision + 1,
    createdAt: input.current.createdAt,
    updatedAt: new Date().toISOString(),
    content: candidate.content,
  };
}

function normalizePromotionPackage(
  raw: any,
  input: {
    campaignId: string;
    source: PromotionSourceSnapshot;
    platforms: PromotionPlatform[];
    primaryAngle: string;
    assets: PromotionAsset[];
    profile: ProductPromotionProfile;
  },
): { brief: PromotionBrief; deliveries: PromotionDelivery[] } {
  const now = new Date().toISOString();
  const briefRaw = raw?.brief || {};
  const brief: PromotionBrief = {
    audience: String(briefRaw.audience || input.profile.audienceNotes || "最可能从这次更新中受益的用户"),
    userProblem: String(briefRaw.userProblem || ""),
    primaryAngle: String(briefRaw.primaryAngle || input.primaryAngle),
    valueStatement: String(briefRaw.valueStatement || ""),
    evidence: (Array.isArray(briefRaw.evidence) ? briefRaw.evidence : [])
      .map((item: any) => ({ statement: String(item?.statement || ""), sourceRef: String(item?.sourceRef || "release") }))
      .filter((item: any) => item.statement),
    callToAction: String(briefRaw.callToAction || input.source.storeUrl || "Learn more"),
    prohibitedClaims: (Array.isArray(briefRaw.prohibitedClaims) ? briefRaw.prohibitedClaims : [])
      .map((item: unknown) => String(item).trim())
      .filter(Boolean),
  };
  const deliveriesRaw = Array.isArray(raw?.deliveries) ? raw.deliveries : [];
  const deliveries = input.platforms.map((platform) => {
    const item = deliveriesRaw.find((candidate: any) => candidate?.platform === platform) || {};
    const target = targetFor(input.profile, platform, item?.targetId);
    const content = item.content || {};
    return {
      id: `${input.campaignId}:delivery:${platform}`,
      platform,
      targetId: target?.id,
      targetLabel: target?.label,
      revision: 1,
      content: {
        post: String(content.post || ""),
        alternateOpening: String(content.alternateOpening || ""),
        title: String(content.title || ""),
        body: String(content.body || ""),
        communityFit: String(content.communityFit || ""),
        developerDisclosure: platform === "reddit" ? Boolean(content.developerDisclosure) : undefined,
      },
      imagePrompt: completeImagePrompt(
        String(item.imagePrompt || defaultImagePrompt(input.assets)),
        String(item.negativePrompt || defaultNegativePrompt()),
        input.assets,
      ),
      negativePrompt: "",
      aspectRatio: String(item.aspectRatio || (platform === "x" ? "16:9" : "1:1")),
      selectedAssetIds: input.assets.filter((asset) => asset.role === "screenshot").map((asset) => asset.id),
      status: "ready" as const,
      createdAt: now,
      updatedAt: now,
    };
  });
  return { brief, deliveries };
}

function targetFor(profile: ProductPromotionProfile, platform: PromotionPlatform, requested?: string) {
  const targets = platform === "reddit"
    ? profile.reddit?.communities || []
    : platform === "facebook"
      ? profile.facebook?.surfaces || []
      : [];
  return targets.find((item) => item.id === requested) || targets[0];
}

function defaultImagePrompt(assets: PromotionAsset[]): string {
  return [
    "Create a finished, clean, premium promotional image for an app announcement using the attached real product screenshots.",
    `${assets[0]?.fileName || "The first screenshot"} is the primary product image${assets[1] ? `; ${assets[1].fileName} is the secondary supporting image` : ""}.`,
    "Compose the screenshots into the final visual with intentional hierarchy, balanced whitespace, and a restrained background; no later manual compositing should be required.",
  ].join(" ");
}

function defaultNegativePrompt(): string {
  return "No fake UI, invented features, distorted text, altered numbers, ratings, awards, store badges, competitor logos, watermarks, or illegible typography.";
}

function completeImagePrompt(prompt: string, constraints: string, assets: PromotionAsset[]): string {
  const attachmentList = assets
    .map((asset, index) => `${index + 1}. ${asset.fileName} — ${index === 0 ? "primary screenshot" : "secondary screenshot"}`)
    .join("\n");
  return [
    `Attach these real screenshots to the image-generation request:\n${attachmentList}`,
    prompt.trim(),
    `Mandatory constraints: ${constraints.trim()}`,
    "If the model cannot preserve the screenshot content reliably, it must keep each screenshot intact and modify only the surrounding background and decorative elements.",
  ].filter(Boolean).join("\n\n");
}
