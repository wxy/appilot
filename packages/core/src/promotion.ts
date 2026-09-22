export const PROMOTION_PLATFORMS = ["x", "reddit", "facebook"] as const;

export type PromotionPlatform = (typeof PROMOTION_PLATFORMS)[number];
export type PromotionRecommendation = "strong" | "light" | "skip";
export type PromotionCampaignStatus =
  | "suggested"
  | "draft"
  | "ready"
  | "partially_published"
  | "published"
  | "skipped";
export type PromotionDeliveryStatus = "draft" | "ready" | "published" | "skipped";
export type XPromotionSeriesItemKind = "release" | "feature" | "use_case" | "conversation";
export type XPromotionSeriesItemStatus = "planned" | "ready" | "published" | "skipped";
export type XPromotionLinkStrategy = "store" | "soft" | "none";

export interface PromotionTarget {
  id: string;
  kind?: "page" | "group" | "profile";
  label: string;
  audienceNote?: string;
  postingNote?: string;
}

export interface ProductPromotionProfile {
  productId: string;
  enabledPlatforms: PromotionPlatform[];
  audienceNotes?: string;
  toneNotes?: string;
  x?: { accountLabel?: string };
  reddit?: { communities: PromotionTarget[] };
  facebook?: { surfaces: PromotionTarget[] };
  updatedAt: string;
}

export interface RedditCommunitySuggestion {
  name: string;
  reason: string;
  audienceFit: string;
}

export interface PromotionSourceSnapshot {
  appName: string;
  appVersion: string;
  releaseTag: string;
  storePublishedAt: string;
  storeUrl: string;
  summary: string;
  whatsNew: string;
  description: string;
  promotionAngles: string[];
  screenshotTypes: Array<{ id: string; name: string; title: string; description: string }>;
  rankBaseline: Array<{ keyword: string; storefront: string; rank: number | null; checkedAt: string }>;
}

export interface PromotionAnalysis {
  recommendation: PromotionRecommendation;
  reason: string;
  primaryAngle: string;
  recommendedPlatforms: PromotionPlatform[];
  recommendedScreenshotTypes: string[];
}

export interface PromotionAsset {
  id: string;
  campaignId: string;
  role: "screenshot" | "generated";
  origin: "imported";
  managedPath: string;
  originalPath?: string;
  sha256: string;
  mimeType: string;
  fileName: string;
  width: number;
  height: number;
  importedAt: string;
}

export interface PromotionBrief {
  audience: string;
  userProblem: string;
  primaryAngle: string;
  valueStatement: string;
  evidence: Array<{ statement: string; sourceRef: string }>;
  callToAction: string;
  prohibitedClaims: string[];
}

export interface PromotionPlatformContent {
  post?: string;
  alternateOpening?: string;
  title?: string;
  body?: string;
  communityFit?: string;
  developerDisclosure?: boolean;
}

export interface PromotionDelivery {
  id: string;
  platform: PromotionPlatform;
  targetId?: string;
  targetLabel?: string;
  revision: number;
  content: PromotionPlatformContent;
  imagePrompt: string;
  negativePrompt: string;
  aspectRatio: string;
  selectedAssetIds: string[];
  status: PromotionDeliveryStatus;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface XPromotionSeriesItem {
  id: string;
  order: number;
  kind: XPromotionSeriesItemKind;
  title: string;
  objective: string;
  angle: string;
  sourceRefs: string[];
  linkStrategy: XPromotionLinkStrategy;
  recommendedVisual: "scenario" | "screenshot" | "raw";
  visualReason: string;
  post: string;
  alternateOpening: string;
  sceneImagePrompt: string;
  screenshotImagePrompt: string;
  selectedAssetIds: string[];
  revision: number;
  status: XPromotionSeriesItemStatus;
  publishedAt?: string;
  /** Canonical X status URL supplied by the operator after manual publication. */
  publishedUrl?: string;
  /** Store product/link chosen for this individual X post. */
  storeProductId?: string;
  storePlatform?: "ios" | "macos" | "unknown";
  storeUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PromotionPublishedEvent {
  id: string;
  campaignId: string;
  projectId: string;
  productId: string;
  releaseId: string;
  appVersion: string;
  platform: PromotionPlatform;
  deliveryId: string;
  contentRevision: number;
  promotionAngle: string;
  assetIds: string[];
  /** Platform post URL captured as evidence of the manual publication. */
  postUrl?: string;
  occurredAt: string;
  revertedAt?: string;
}

export interface PromotionCampaign {
  id: string;
  projectId: string;
  /** Store-product records covered by this product-level campaign. */
  productIds?: string[];
  /** User-facing Apple platforms covered by this campaign. */
  targetPlatforms?: Array<"ios" | "macos" | "unknown">;
  /** Primary product retained for compatibility and source/profile lookup. */
  productId: string;
  releaseTag: string;
  appVersion: string;
  storePublishedAt: string;
  sourceSnapshotHash: string;
  source: PromotionSourceSnapshot;
  recommendation?: PromotionRecommendation;
  recommendationReason?: string;
  primaryAngle?: string;
  recommendedPlatforms: PromotionPlatform[];
  recommendedScreenshotTypes: string[];
  enabledPlatforms: PromotionPlatform[];
  status: PromotionCampaignStatus;
  brief?: PromotionBrief;
  assets: PromotionAsset[];
  deliveries: PromotionDelivery[];
  /** X-first, independently publishable posts derived from this release. */
  seriesItems?: XPromotionSeriesItem[];
  publicationEvents: PromotionPublishedEvent[];
  skippedAt?: string;
  skipReason?: string;
  createdAt: string;
  updatedAt: string;
}

export function isPromotionPlatform(value: unknown): value is PromotionPlatform {
  return PROMOTION_PLATFORMS.includes(value as PromotionPlatform);
}

export function normalizePromotionProfile(
  value: Partial<ProductPromotionProfile> & { productId: string },
  now = new Date().toISOString(),
): ProductPromotionProfile {
  const enabledPlatforms = [...new Set((value.enabledPlatforms || []).filter(isPromotionPlatform))];
  return {
    productId: value.productId,
    enabledPlatforms,
    audienceNotes: String(value.audienceNotes || "").trim(),
    toneNotes: String(value.toneNotes || "").trim(),
    x: { accountLabel: String(value.x?.accountLabel || "").trim() },
    reddit: {
      communities: normalizeTargets(value.reddit?.communities, false),
    },
    facebook: {
      surfaces: normalizeTargets(value.facebook?.surfaces, true),
    },
    updatedAt: now,
  };
}

function normalizeTargets(value: PromotionTarget[] | undefined, facebook: boolean): PromotionTarget[] {
  return (Array.isArray(value) ? value : [])
    .map((item, index) => ({
      id: String(item?.id || `target-${index + 1}`),
      ...(facebook
        ? { kind: (["page", "group", "profile"].includes(String(item?.kind)) ? item.kind : "page") as PromotionTarget["kind"] }
        : {}),
      label: String(item?.label || "").trim(),
      audienceNote: String(item?.audienceNote || "").trim(),
      postingNote: String(item?.postingNote || "").trim(),
    }))
    .filter((item) => item.label);
}

export function validatePromotionProfile(profile: ProductPromotionProfile): string[] {
  const errors: string[] = [];
  if (profile.enabledPlatforms.length === 0) errors.push("请至少启用一个平台");
  if (profile.enabledPlatforms.includes("reddit") && !profile.reddit?.communities.length) {
    errors.push("启用 Reddit 时至少需要一个目标社区");
  }
  if (profile.enabledPlatforms.includes("facebook") && !profile.facebook?.surfaces.length) {
    errors.push("启用 Facebook 时至少需要一个目标位置");
  }
  return errors;
}

export function normalizePromotionAnalysis(
  raw: any,
  availablePlatforms: PromotionPlatform[],
): PromotionAnalysis {
  const recommendation: PromotionRecommendation = ["strong", "light", "skip"].includes(raw?.recommendation)
    ? raw.recommendation
    : "light";
  const recommended: PromotionPlatform[] = (Array.isArray(raw?.recommendedPlatforms) ? raw.recommendedPlatforms : [])
    .filter((item: unknown): item is PromotionPlatform => isPromotionPlatform(item))
    .filter((platform: PromotionPlatform) => availablePlatforms.includes(platform));
  return {
    recommendation,
    reason: String(raw?.reason || "这个版本适合一次克制、基于事实的更新。"),
    primaryAngle: String(raw?.primaryAngle || "介绍本次版本最重要的用户可见变化").trim(),
    recommendedPlatforms: [...new Set(recommended.length ? recommended : availablePlatforms.slice(0, recommendation === "strong" ? 3 : 1))],
    recommendedScreenshotTypes: (Array.isArray(raw?.recommendedScreenshotTypes)
      ? raw.recommendedScreenshotTypes
      : [])
      .map((item: unknown) => String(item).trim())
      .filter(Boolean)
      .slice(0, 2),
  };
}

export function derivePromotionCampaignStatus(campaign: PromotionCampaign): PromotionCampaignStatus {
  if (campaign.skippedAt) return "skipped";
  if (!campaign.recommendation) return "suggested";
  if (campaign.seriesItems?.length) {
    const active = campaign.seriesItems.filter((item) => item.status !== "skipped");
    const published = active.filter((item) => item.status === "published").length;
    if (active.length > 0 && published === active.length) return "published";
    if (published > 0) return "partially_published";
    return active.some((item) => item.status === "ready") ? "ready" : "draft";
  }
  if (!campaign.brief || campaign.deliveries.length === 0) return "draft";
  const active = campaign.deliveries.filter((item) => item.status !== "skipped");
  const published = active.filter((item) => item.status === "published").length;
  if (active.length > 0 && published === active.length) return "published";
  if (published > 0) return "partially_published";
  return "ready";
}

/**
 * A whole-package regeneration is a new revision, even when the AI generator
 * returns its default revision number. This makes mounted editors discard the
 * old local draft instead of auto-saving it over the regenerated delivery.
 */
export function revisionGeneratedDeliveries(
  generated: PromotionDelivery[],
  current: PromotionDelivery[],
): PromotionDelivery[] {
  return generated.map((delivery) => {
    const previous = current.find((item) => item.platform === delivery.platform);
    return {
      ...delivery,
      revision: (previous?.revision || 0) + 1,
      createdAt: previous?.createdAt || delivery.createdAt,
    };
  });
}

export function promotionPlatformUrl(
  platform: PromotionPlatform,
  targetLabel?: string,
): string {
  if (platform === "x") return "https://x.com/compose/post";
  if (platform === "reddit") {
    const community = String(targetLabel || "").replace(/^r\//i, "").trim();
    return community
      ? `https://www.reddit.com/r/${encodeURIComponent(community)}/submit`
      : "https://www.reddit.com/submit";
  }
  return "https://www.facebook.com/";
}

export function xComposeUrl(post: string): string {
  const url = new URL("https://x.com/intent/post");
  url.searchParams.set("text", post);
  return url.toString();
}

/** Accept only a concrete X/Twitter status URL, never a profile or compose URL. */
export function normalizeXPostUrl(value: string): string | null {
  try {
    const url = new URL(String(value || "").trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (url.protocol !== "https:" || !["x.com", "twitter.com"].includes(host)) return null;
    if (!/^\/[A-Za-z0-9_]+\/status\/\d+\/?$/.test(url.pathname)) return null;
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function promotionPlatformLabel(platform: PromotionPlatform): string {
  return platform === "x" ? "X" : platform === "reddit" ? "Reddit" : "Facebook";
}

export function promotionRecommendationLabel(value?: PromotionRecommendation): string {
  if (value === "strong") return "强推广";
  if (value === "light") return "轻量更新";
  if (value === "skip") return "建议跳过";
  return "尚未分析";
}

/**
 * X-compatible weighted length for the MVP's English-first posts. URLs use
 * the platform's fixed t.co length; CJK and emoji graphemes use weight 2.
 * Keeping this deterministic makes UI and main-process validation agree.
 */
export function xPostWeightedLength(value: string): number {
  const normalized = String(value || "").normalize("NFC");
  const urlPattern = /https?:\/\/[^\s]+/giu;
  let total = 0;
  let cursor = 0;
  for (const match of normalized.matchAll(urlPattern)) {
    const index = match.index ?? cursor;
    total += weightedTextLength(normalized.slice(cursor, index));
    total += 23;
    cursor = index + match[0].length;
  }
  return total + weightedTextLength(normalized.slice(cursor));
}

function weightedTextLength(value: string): number {
  const segments = new Intl.Segmenter("en", { granularity: "grapheme" }).segment(value);
  let total = 0;
  for (const { segment } of segments) {
    const weighted = /\p{Extended_Pictographic}/u.test(segment) || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(segment);
    total += weighted ? 2 : 1;
  }
  return total;
}
