import { app, dialog, ipcMain, nativeImage } from "electron";
import { createHash, randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import type { StoreSubmissionDraft } from "@appilot-labs/appilot-core/store-submission";
import {
  derivePromotionCampaignStatus,
  normalizePromotionProfile,
  normalizeXPostUrl,
  promotionPlatformUrl,
  revisionGeneratedDeliveries,
  X_POST_MAX_IMAGES,
  X_PROMOTION_MAX_REFERENCE_IMAGES,
  xPostWeightedLength,
  validatePromotionProfile,
  type ProductPromotionProfile,
  type PromotionAsset,
  type PromotionCampaign,
  type PromotionPlatform,
  type PromotionSourceSnapshot,
} from "@appilot-labs/appilot-core/promotion";
import {
  analyzePromotionValue,
  generateXPromotionImagePrompt,
  generateXPromotionSeriesItem,
  generateXPromotionSeriesPlan,
  generatePromotionPackage,
  regeneratePromotionDelivery,
  suggestRedditCommunities,
} from "@appilot-labs/appilot-core/ai/promotion";
import { createAiProvider } from "../ai-service";
import { withAiOperation } from "../ai-cancel";
import { notifyDataChanged } from "../data-sync";
import { getStore, type AppStore } from "../store";
import { buildProjectProfileFor } from "../release-service";
import { assertNonEmptyString } from "../util";
import { mergePromotionCampaigns } from "../promotion-campaign-merge";
import { releasedPromotionDrafts } from "../promotion-releases";
import { canUsePublicStoreVersion, latestScopedAscSnapshot } from "../store-product-scope";
import { ascStoreLiveVersion } from "@appilot-labs/appilot-core/version-status";
import {
  defaultPromotionStoreLink,
  hydrateCampaignStoreLinks,
  promotionStoreLinkOptions,
  storeLinkForItem,
} from "../promotion-store-links";

type PromotionProfiles = Record<string, ProductPromotionProfile>;
type PromotionCampaigns = Record<string, PromotionCampaign[]>;

function profiles(s: AppStore): PromotionProfiles {
  const value = s.get<PromotionProfiles>("promotionProfiles");
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function profileForProject(s: AppStore, projectId: string, productId: string): ProductPromotionProfile | null {
  const all = profiles(s);
  if (all[projectId]) return all[projectId];
  if (all[productId]) return all[productId];
  const { project } = findContext(s, projectId, productId);
  for (const product of project.storeProducts || []) {
    if (all[product.id]) return all[product.id];
  }
  return null;
}

function campaigns(s: AppStore): PromotionCampaigns {
  const value = s.get<PromotionCampaigns>("promotionCampaigns");
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function findContext(s: AppStore, projectId: string, productId: string) {
  const projects: any[] = s.get("projects") || [];
  const project = projects.find((item) => item.id === projectId);
  if (!project) throw new Error("Project not found");
  const product = (project.storeProducts || []).find((item: any) => item.id === productId);
  if (!product) throw new Error("Store product not found");
  return { project, product };
}

function storeUrlForProduct(product: any): string {
  return String(
    product.storeLinks?.find((link: any) => link.platform === product.platform)?.url ||
    product.storeLinks?.[0]?.url ||
    "",
  );
}

async function currentVersionForPromotionProduct(s: AppStore, project: any, product: any) {
  const asc = latestScopedAscSnapshot(project, product, (s.get("ascCache") || {})[product.id]);
  const ascVersion = ascStoreLiveVersion(asc?.versions);
  if (ascVersion) return { version: ascVersion, currentVersionReleaseDate: null };
  if (!canUsePublicStoreVersion(project, product)) return null;
  return import("@appilot-labs/appilot-core/app-store-discovery")
    .then(({ fetchStoreCurrentVersion }) => fetchStoreCurrentVersion(product.trackId))
    .catch(() => null);
}

function sourceFromDraft(
  project: any,
  product: any,
  draft: StoreSubmissionDraft,
  storePublishedAt?: string | null,
): PromotionSourceSnapshot {
  const primary = draft.localizations?.[0];
  const screenshotLanguage = draft.screenshotCopy?.sourceLanguage || primary?.language || "en";
  const screenshotTypes = (draft.screenshotCopy?.items || []).map((item: any) => {
    const copy = item.copies?.[screenshotLanguage] || {};
    return {
      id: String(item.id || ""),
      name: String(item.name || ""),
      title: String(copy.title || ""),
      description: String(copy.description || ""),
    };
  });
  const rankBaseline = (product.rankSnapshots || [])
    .slice()
    .sort((a: any, b: any) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime())
    .slice(0, 20)
    .map((item: any) => ({
      keyword: String(item.keyword || ""),
      storefront: String(item.storefront || ""),
      rank: typeof item.rank === "number" ? item.rank : null,
      checkedAt: String(item.checkedAt || ""),
    }));
  return {
    appName: String(product.trackName || project.name || "App"),
    appVersion: String(draft.appVersion || draft.releaseTag || "").replace(/^v/i, ""),
    releaseTag: String(draft.releaseTag || ""),
    storePublishedAt: String(storePublishedAt || draft.ascSyncedAt || draft.storeSyncedAt || draft.updatedAt || ""),
    storeUrl: storeUrlForProduct(product),
    summary: String(draft.summary || ""),
    whatsNew: String(primary?.whatsNew || draft.whatsNew || ""),
    description: String(primary?.description || draft.description || ""),
    promotionAngles: (draft.promotionAngles || []).map(String).filter(Boolean),
    screenshotTypes,
    rankBaseline,
  };
}

function sourceHash(source: PromotionSourceSnapshot): string {
  return createHash("sha256").update(JSON.stringify(source)).digest("hex");
}

function campaignId(projectId: string, source: PromotionSourceSnapshot): string {
  const identity = `${projectId}\u0000${source.appVersion || source.releaseTag}`;
  return `promotion-${createHash("sha256").update(identity).digest("hex").slice(0, 20)}`;
}

function projectProductScope(project: any): {
  productIds: string[];
  targetPlatforms: Array<"ios" | "macos" | "unknown">;
} {
  const products = Array.isArray(project.storeProducts) ? project.storeProducts : [];
  return {
    productIds: [...new Set<string>(products.map((item: any) => String(item.id || "")).filter(Boolean))],
    targetPlatforms: [...new Set(products.map((item: any) =>
      item.platform === "ios" || item.platform === "macos" ? item.platform : "unknown",
    ))] as Array<"ios" | "macos" | "unknown">,
  };
}

/** Collapse the former per-platform campaigns into one product-level campaign per version. */
function mergeProjectCampaigns(s: AppStore, project: any): PromotionCampaign[] {
  const all = campaigns(s);
  const current = all[project.id] || [];
  const scope = projectProductScope(project);
  const { campaigns: merged, changed } = mergePromotionCampaigns(
    current,
    scope,
    (source) => campaignId(project.id, source),
  );
  const linkOptions = promotionStoreLinkOptions(project);
  const hydrated = merged.map((campaign) => hydrateCampaignStoreLinks(campaign, linkOptions));
  const linksChanged = JSON.stringify(hydrated) !== JSON.stringify(merged);
  if (changed || linksChanged) {
    all[project.id] = hydrated;
    s.set("promotionCampaigns", all);
  }
  return hydrated;
}

function saveCampaign(s: AppStore, campaign: PromotionCampaign): PromotionCampaign {
  const all = campaigns(s);
  const list = all[campaign.projectId] || [];
  const normalized = {
    ...campaign,
    status: derivePromotionCampaignStatus(campaign),
    updatedAt: new Date().toISOString(),
  };
  all[campaign.projectId] = [normalized, ...list.filter((item) => item.id !== campaign.id)].slice(0, 100);
  s.set("promotionCampaigns", all);
  notifyDataChanged("promotion");
  return normalized;
}

function findCampaign(s: AppStore, projectId: string, campaignIdValue: string): PromotionCampaign {
  const found = (campaigns(s)[projectId] || []).find((item) => item.id === campaignIdValue);
  if (!found) throw new Error("Promotion campaign not found");
  return found;
}

function emitProgress(event: Electron.IpcMainInvokeEvent, progress: any) {
  if (!event.sender.isDestroyed()) event.sender.send("promotion:progress", progress);
}

export function registerPromotionHandlers(): void {
  ipcMain.handle("promotion:list", async (_event, projectId: string, productId: string) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    productId = assertNonEmptyString(productId, "productId");
    const s = await getStore();
    const { project, product } = findContext(s, projectId, productId);
    const defaultLink = defaultPromotionStoreLink(promotionStoreLinkOptions(project));
    const linkProduct = (project.storeProducts || []).find((item: any) => item.id === defaultLink?.productId) || product;
    const currentStore = await currentVersionForPromotionProduct(s, project, linkProduct);
    const currentVersion = String(currentStore?.version || "").replace(/^v/i, "");
    const allCampaigns = mergeProjectCampaigns(s, project)
      .sort((a, b) => new Date(b.storePublishedAt).getTime() - new Date(a.storePublishedAt).getTime());
    const campaignByVersion = new Map(allCampaigns.map((item) => [item.appVersion, item]));
    const releases = releasedPromotionDrafts(project, currentVersion).map((draft) => {
      const draftVersion = String(draft.appVersion || "").replace(/^v/i, "");
      const draftProduct = (project.storeProducts || []).find((item: any) => item.id === draft.productId) || linkProduct;
      const source = sourceFromDraft(
        project,
        draftProduct,
        draft,
        draftProduct.id === linkProduct.id && draftVersion === currentVersion
          ? currentStore?.currentVersionReleaseDate : null,
      );
      return {
        id: campaignId(projectId, source),
        releaseTag: source.releaseTag,
        appVersion: source.appVersion,
        storePublishedAt: source.storePublishedAt,
        source,
        campaign: campaignByVersion.get(source.appVersion) || null,
      };
    });
    return {
      profile: profileForProject(s, projectId, productId),
      campaigns: allCampaigns,
      releases,
    };
  });

  ipcMain.handle("promotion:saveProfile", async (_event, projectId: string, productId: string, value: any) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    productId = assertNonEmptyString(productId, "productId");
    const s = await getStore();
    findContext(s, projectId, productId);
    const profile = normalizePromotionProfile({ ...value, productId });
    const errors = validatePromotionProfile(profile);
    if (errors.length) throw new Error(errors[0]);
    const all = profiles(s);
    all[projectId] = profile;
    s.set("promotionProfiles", all);
    notifyDataChanged("promotion");
    return profile;
  });

  ipcMain.handle(
    "promotion:suggestRedditCommunities",
    async (
      event,
      projectId: string,
      productId: string,
      context: { audienceNotes?: string; existingCommunities?: string[] } | undefined,
      operationId: string,
    ) => {
      projectId = assertNonEmptyString(projectId, "projectId");
      productId = assertNonEmptyString(productId, "productId");
      operationId = assertNonEmptyString(operationId, "operationId");
      const s = await getStore();
      const { project, product } = findContext(s, projectId, productId);
      emitProgress(event, { kind: "phase", phase: "reddit-communities", status: "started" });
      return withAiOperation(operationId, async (signal) => {
        const [provider, projectProfile] = await Promise.all([
          createAiProvider(s),
          buildProjectProfileFor(project, product),
        ]);
        const suggestions = await suggestRedditCommunities(
          provider,
          {
            projectProfile,
            audienceNotes: String(context?.audienceNotes || ""),
            existingCommunities: Array.isArray(context?.existingCommunities)
              ? context.existingCommunities.map(String)
              : [],
          },
          {
            signal,
            onProgress: (progress) => emitProgress(event, { kind: "chars", ...progress }),
            onRetry: () => emitProgress(event, { kind: "retry" }),
          },
        );
        emitProgress(event, { kind: "phase", phase: "reddit-communities", status: "completed" });
        return suggestions;
      });
    },
  );

  ipcMain.handle(
    "promotion:analyze",
    async (event, projectId: string, productId: string, releaseTag: string, operationId: string) => {
      projectId = assertNonEmptyString(projectId, "projectId");
      productId = assertNonEmptyString(productId, "productId");
      releaseTag = assertNonEmptyString(releaseTag, "releaseTag");
      operationId = assertNonEmptyString(operationId, "operationId");
      const s = await getStore();
      const { project, product } = findContext(s, projectId, productId);
      const defaultLink = defaultPromotionStoreLink(promotionStoreLinkOptions(project));
      const linkProduct = (project.storeProducts || []).find((item: any) => item.id === defaultLink?.productId) || product;
      const profile = profileForProject(s, projectId, productId);
      if (!profile) throw new Error("请先设置推广平台");
      const xProfile = { ...profile, enabledPlatforms: ["x" as const] };
      const errors = validatePromotionProfile(xProfile);
      if (errors.length) throw new Error(errors[0]);
      const currentStore = await currentVersionForPromotionProduct(s, project, linkProduct);
      const currentVersion = String(currentStore?.version || "").replace(/^v/i, "");
      const draft = releasedPromotionDrafts(project, currentVersion).find((item) => item.releaseTag === releaseTag);
      if (!draft) throw new Error("这个版本尚未确认上架，不能创建推广活动");
      const draftVersion = String(draft.appVersion || "").replace(/^v/i, "");
      const draftProduct = (project.storeProducts || []).find((item: any) => item.id === draft.productId) || linkProduct;
      const source = sourceFromDraft(
        project,
        draftProduct,
        draft,
        draftProduct.id === linkProduct.id && draftVersion === currentVersion
          ? currentStore?.currentVersionReleaseDate : null,
      );
      if (!source.storeUrl) throw new Error("这个产品还没有可用的 App Store 链接");
      const now = new Date().toISOString();
      const existing = (campaigns(s)[projectId] || []).find(
        (item) => item.appVersion === source.appVersion,
      );
      let campaign: PromotionCampaign = existing || {
        id: campaignId(projectId, source),
        projectId,
        ...projectProductScope(project),
        productId,
        releaseTag,
        appVersion: source.appVersion,
        storePublishedAt: source.storePublishedAt,
        sourceSnapshotHash: sourceHash(source),
        source,
        recommendedPlatforms: [],
        recommendedScreenshotTypes: [],
        enabledPlatforms: ["x"],
        status: "suggested",
        assets: [],
        deliveries: [],
        publicationEvents: [],
        createdAt: now,
        updatedAt: now,
      };
      campaign = saveCampaign(s, { ...campaign, source, sourceSnapshotHash: sourceHash(source) });
      emitProgress(event, { kind: "phase", phase: "analysis", status: "started" });
      return withAiOperation(operationId, async (signal) => {
        const [provider, projectProfile] = await Promise.all([
          createAiProvider(s),
          buildProjectProfileFor(project, product, undefined, source.description),
        ]);
        const analysis = await analyzePromotionValue(
          provider,
          { source, profile: xProfile, projectProfile },
          {
            signal,
            onProgress: (progress) => emitProgress(event, { kind: "chars", ...progress }),
            onRetry: () => emitProgress(event, { kind: "retry" }),
          },
        );
        emitProgress(event, { kind: "phase", phase: "analysis", status: "completed" });
        emitProgress(event, { kind: "phase", phase: "series-plan", status: "started" });
        const seriesItems = await generateXPromotionSeriesPlan(
          provider,
          { campaignId: campaign.id, source, profile: xProfile, projectProfile },
          {
            signal,
            onProgress: (progress) => emitProgress(event, { kind: "chars", ...progress }),
            onRetry: () => emitProgress(event, { kind: "retry" }),
          },
        );
        if (!seriesItems.length) throw new Error("AI 没有返回可用的 X 系列计划，请重试");
        emitProgress(event, { kind: "phase", phase: "series-plan", status: "completed" });
        return saveCampaign(s, {
          ...campaign,
          recommendation: analysis.recommendation,
          recommendationReason: analysis.reason,
          primaryAngle: analysis.primaryAngle,
          recommendedPlatforms: analysis.recommendedPlatforms,
          recommendedScreenshotTypes: analysis.recommendedScreenshotTypes,
          enabledPlatforms: ["x"],
          seriesItems: seriesItems.map((item) => defaultLink ? {
            ...item,
            storeProductId: defaultLink.productId,
            storePlatform: defaultLink.platform,
            storeUrl: defaultLink.url,
          } : item),
          skippedAt: undefined,
          skipReason: undefined,
          status: "draft",
        });
      });
    },
  );

  ipcMain.handle("promotion:saveCampaign", async (_event, projectId: string, value: PromotionCampaign) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    if (!value || value.projectId !== projectId || !value.id) throw new Error("Invalid promotion campaign");
    const s = await getStore();
    const current = findCampaign(s, projectId, value.id);
    if (current.productId !== value.productId || current.releaseTag !== value.releaseTag) {
      throw new Error("Promotion campaign identity cannot be changed");
    }
    const { project } = findContext(s, projectId, current.productId);
    const linkOptions = promotionStoreLinkOptions(project);
    const assetIds = new Set(current.assets.map((item) => item.id));
    const deliveries = (Array.isArray(value.deliveries) ? value.deliveries : current.deliveries).map((delivery) => ({
      ...delivery,
      selectedAssetIds: (delivery.selectedAssetIds || []).filter((id) => assetIds.has(id)),
    }));
    const seriesItems = (Array.isArray(value.seriesItems) ? value.seriesItems : current.seriesItems)?.map((item) => {
      const target = storeLinkForItem(item, linkOptions, current.source.storeUrl);
      const referenceAssetIds = (item.referenceAssetIds || []).filter((id: string) => assetIds.has(id)).slice(0, X_PROMOTION_MAX_REFERENCE_IMAGES);
      const finalAssetIds = (item.finalAssetIds || item.selectedAssetIds || []).filter((id: string) => assetIds.has(id)).slice(0, X_POST_MAX_IMAGES);
      return {
        ...item,
        ...(target ? { storeProductId: target.productId, storePlatform: target.platform, storeUrl: target.url } : {}),
        referenceAssetIds,
        finalAssetIds,
        selectedAssetIds: finalAssetIds,
      };
    });
    return saveCampaign(s, {
      ...value,
      id: current.id,
      projectId: current.projectId,
      productId: current.productId,
      releaseTag: current.releaseTag,
      appVersion: current.appVersion,
      storePublishedAt: current.storePublishedAt,
      source: current.source,
      sourceSnapshotHash: current.sourceSnapshotHash,
      assets: current.assets,
      deliveries,
      seriesItems,
      createdAt: current.createdAt,
    });
  });

  ipcMain.handle("promotion:skip", async (_event, projectId: string, campaignIdValue: string, reason?: string) => {
    const s = await getStore();
    const campaign = findCampaign(s, projectId, campaignIdValue);
    return saveCampaign(s, {
      ...campaign,
      skippedAt: new Date().toISOString(),
      skipReason: String(reason || campaign.recommendationReason || "本次不推广"),
      status: "skipped",
    });
  });

  ipcMain.handle(
    "promotion:importAssets",
    async (_event, projectId: string, campaignIdValue: string, role: "screenshot" | "generated") => {
      const s = await getStore();
      const campaign = findCampaign(s, projectId, campaignIdValue);
      const result = await dialog.showOpenDialog({
        title: role === "generated" ? "导入外部生成成品" : "选择 1–2 张推广截图",
        properties: role === "generated" ? ["openFile"] : ["openFile", "multiSelections"],
        filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "heic"] }],
      });
      if (result.canceled || result.filePaths.length === 0) return campaign;
      if (role === "screenshot" && result.filePaths.length > 2) {
        throw new Error("一次最多选择两张截图，请重新选择");
      }
      const imported = result.filePaths.map((sourcePath) => importAsset(campaign.id, sourcePath, role));
      const assets = [...campaign.assets];
      for (const asset of imported) {
        if (!assets.some((item) => item.sha256 === asset.sha256 && item.role === role)) assets.push(asset);
      }
      if (assets.filter((asset) => asset.role === "screenshot").length > 2) {
        throw new Error("推广活动最多保管两张来源截图，请先移除或替换现有截图");
      }
      return saveCampaign(s, { ...campaign, assets });
    },
  );

  ipcMain.handle(
    "promotion:importSeriesAssets",
    async (
      _event,
      projectId: string,
      campaignIdValue: string,
      itemId: string,
      usage: "reference" | "final-screenshot" | "final-generated",
    ) => {
      const s = await getStore();
      const campaign = findCampaign(s, projectId, campaignIdValue);
      const item = campaign.seriesItems?.find((candidate) => candidate.id === itemId);
      if (!item) throw new Error("找不到这条 X 系列内容");
      if (item.status === "published") throw new Error("已发布帖子的图片记录不可修改");
      if (!(["reference", "final-screenshot", "final-generated"] as const).includes(usage)) {
        throw new Error("不支持的图片用途");
      }
      const currentIds = usage === "reference"
        ? item.referenceAssetIds || []
        : item.finalAssetIds || item.selectedAssetIds || [];
      const limit = usage === "reference" ? X_PROMOTION_MAX_REFERENCE_IMAGES : X_POST_MAX_IMAGES;
      const result = await dialog.showOpenDialog({
        title: usage === "reference" ? "选择 1–2 张参考截图" : usage === "final-generated" ? "导入外部生成的图片" : "选择发布到 X 的截图",
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "heic"] }],
      });
      if (result.canceled || result.filePaths.length === 0) return campaign;
      if (currentIds.length + result.filePaths.length > limit) {
        throw new Error(usage === "reference" ? "每条帖子最多使用两张参考截图" : "X 每条帖子最多记录四张图片");
      }
      const role = usage === "final-generated" ? "generated" as const : "screenshot" as const;
      const imported = result.filePaths.map((sourcePath) => importAsset(campaign.id, sourcePath, role));
      const assets = [...campaign.assets];
      const importedIds: string[] = [];
      for (const asset of imported) {
        const existing = assets.find((candidate) => candidate.sha256 === asset.sha256 && candidate.role === asset.role);
        if (existing) importedIds.push(existing.id);
        else {
          assets.push(asset);
          importedIds.push(asset.id);
        }
      }
      const nextIds = [...new Set([...currentIds, ...importedIds])].slice(0, limit);
      return saveCampaign(s, {
        ...campaign,
        assets,
        seriesItems: campaign.seriesItems?.map((candidate) => candidate.id === itemId ? {
          ...candidate,
          visualMode: usage === "final-screenshot" ? "screenshots" : "generated",
          ...(usage === "reference"
            ? { referenceAssetIds: nextIds }
            : { finalAssetIds: nextIds, selectedAssetIds: nextIds }),
          revision: candidate.revision + 1,
          updatedAt: new Date().toISOString(),
        } : candidate),
      });
    },
  );

  ipcMain.handle("promotion:assetPreview", async (_event, projectId: string, campaignIdValue: string, assetId: string) => {
    const s = await getStore();
    const campaign = findCampaign(s, projectId, campaignIdValue);
    const asset = campaign.assets.find((item) => item.id === assetId);
    if (!asset || !fs.existsSync(asset.managedPath)) return null;
    const image = nativeImage.createFromPath(asset.managedPath);
    return image.isEmpty() ? null : image.toDataURL();
  });

  ipcMain.handle("promotion:removeAsset", async (_event, projectId: string, campaignIdValue: string, assetId: string) => {
    const s = await getStore();
    const campaign = findCampaign(s, projectId, campaignIdValue);
    const usedByPublished = campaign.deliveries.some(
      (delivery) => delivery.status === "published" && delivery.selectedAssetIds.includes(assetId),
    ) || Boolean(campaign.seriesItems?.some(
      (item) => item.status === "published" && (item.finalAssetIds || item.selectedAssetIds).includes(assetId),
    ));
    if (usedByPublished) throw new Error("该素材已被发布记录引用，不能移除");
    return saveCampaign(s, {
      ...campaign,
      assets: campaign.assets.filter((item) => item.id !== assetId),
      deliveries: campaign.deliveries.map((delivery) => ({
        ...delivery,
        selectedAssetIds: delivery.selectedAssetIds.filter((id) => id !== assetId),
      })),
      seriesItems: campaign.seriesItems?.map((item) => ({
        ...item,
        referenceAssetIds: item.referenceAssetIds?.filter((id) => id !== assetId),
        finalAssetIds: item.finalAssetIds?.filter((id) => id !== assetId),
        selectedAssetIds: item.selectedAssetIds.filter((id) => id !== assetId),
      })),
    });
  });

  ipcMain.handle(
    "promotion:generateSeriesPlan",
    async (event, projectId: string, campaignIdValue: string, operationId: string) => {
      const s = await getStore();
      const campaign = findCampaign(s, projectId, campaignIdValue);
      const { project, product } = findContext(s, projectId, campaign.productId);
      const defaultLink = defaultPromotionStoreLink(promotionStoreLinkOptions(project));
      const source = { ...campaign.source, storeUrl: defaultLink?.url || campaign.source.storeUrl };
      const profile = profileForProject(s, projectId, campaign.productId);
      if (!profile) throw new Error("请先设置 X 推广档案");
      return withAiOperation(operationId, async (signal) => {
        const [provider, projectProfile] = await Promise.all([
          createAiProvider(s),
          buildProjectProfileFor(project, product, undefined, campaign.source.description),
        ]);
        const seriesItems = await generateXPromotionSeriesPlan(
          provider,
          { campaignId: campaign.id, source, profile, projectProfile },
          {
            signal,
            onProgress: (progress) => emitProgress(event, { kind: "chars", ...progress }),
            onRetry: () => emitProgress(event, { kind: "retry" }),
          },
        );
        if (!seriesItems.length) throw new Error("AI 没有返回可用的 X 系列计划，请重试");
        return saveCampaign(s, {
          ...campaign,
          source,
          sourceSnapshotHash: sourceHash(source),
          enabledPlatforms: ["x"],
          seriesItems: seriesItems.map((item) => defaultLink ? {
            ...item,
            storeProductId: defaultLink.productId,
            storePlatform: defaultLink.platform,
            storeUrl: defaultLink.url,
          } : item),
          status: "draft",
        });
      });
    },
  );

  ipcMain.handle(
    "promotion:generateSeriesItem",
    async (event, projectId: string, campaignIdValue: string, itemId: string, operationId: string, linkProductId?: string) => {
      const s = await getStore();
      const campaign = findCampaign(s, projectId, campaignIdValue);
      const item = campaign.seriesItems?.find((candidate) => candidate.id === itemId);
      if (!item) throw new Error("找不到这条 X 系列内容");
      const { project, product } = findContext(s, projectId, campaign.productId);
      const linkOptions = promotionStoreLinkOptions(project);
      const target = linkOptions.find((option) => option.productId === linkProductId) ||
        storeLinkForItem(item, linkOptions, campaign.source.storeUrl);
      if (!target) throw new Error("这个产品还没有可用的 App Store 链接");
      const source = { ...campaign.source, storeUrl: target.url };
      const profile = profileForProject(s, projectId, campaign.productId);
      if (!profile) throw new Error("请先设置 X 推广档案");
      return withAiOperation(operationId, async (signal) => {
        const [provider, projectProfile] = await Promise.all([
          createAiProvider(s),
          buildProjectProfileFor(project, product, undefined, campaign.source.description),
        ]);
        const generated = await generateXPromotionSeriesItem(
          provider,
          { source, profile, item, projectProfile },
          {
            signal,
            onProgress: (progress) => emitProgress(event, { kind: "chars", ...progress }),
            onRetry: () => emitProgress(event, { kind: "retry" }),
          },
        );
        return saveCampaign(s, {
          ...campaign,
          source,
          sourceSnapshotHash: sourceHash(source),
          seriesItems: campaign.seriesItems?.map((candidate) => candidate.id === itemId ? {
            ...generated,
            storeProductId: target.productId,
            storePlatform: target.platform,
            storeUrl: target.url,
          } : candidate),
        });
      });
    },
  );

  ipcMain.handle(
    "promotion:generateSeriesImagePrompt",
    async (
      event,
      projectId: string,
      campaignIdValue: string,
      itemId: string,
      kind: "scene" | "screenshot",
      operationId: string,
    ) => {
      const s = await getStore();
      const campaign = findCampaign(s, projectId, campaignIdValue);
      const item = campaign.seriesItems?.find((candidate) => candidate.id === itemId);
      if (!item) throw new Error("找不到这条 X 系列内容");
      if (kind !== "scene" && kind !== "screenshot") throw new Error("不支持的图片提示词类型");
      const referenceIds = new Set(item.referenceAssetIds || []);
      const referenceAssets = kind === "screenshot"
        ? campaign.assets.filter((asset) => referenceIds.has(asset.id)).slice(0, 2)
        : [];
      if (kind === "screenshot" && !referenceAssets.length) throw new Error("请先选择至少一张参考截图");
      const { project, product } = findContext(s, projectId, campaign.productId);
      const profile = profileForProject(s, projectId, campaign.productId);
      if (!profile) throw new Error("请先设置 X 推广档案");
      return withAiOperation(operationId, async (signal) => {
        const [provider, projectProfile] = await Promise.all([
          createAiProvider(s),
          buildProjectProfileFor(project, product, undefined, campaign.source.description),
        ]);
        const imagePrompt = await generateXPromotionImagePrompt(
          provider,
          { source: campaign.source, profile, item, kind, assets: referenceAssets, projectProfile },
          {
            signal,
            onProgress: (progress) => emitProgress(event, { kind: "chars", ...progress }),
            onRetry: () => emitProgress(event, { kind: "retry" }),
          },
        );
        return saveCampaign(s, {
          ...campaign,
          seriesItems: campaign.seriesItems?.map((candidate) => candidate.id === itemId ? {
            ...candidate,
            visualMode: "generated",
            imagePromptKind: kind,
            imagePrompt,
            sceneImagePrompt: kind === "scene" ? imagePrompt : candidate.sceneImagePrompt,
            screenshotImagePrompt: kind === "screenshot" ? imagePrompt : candidate.screenshotImagePrompt,
            revision: candidate.revision + 1,
            updatedAt: new Date().toISOString(),
          } : candidate),
        });
      });
    },
  );

  ipcMain.handle(
    "promotion:markSeriesItemPublished",
    async (_event, projectId: string, campaignIdValue: string, itemId: string, published: boolean, publishedUrl?: string) => {
      const s = await getStore();
      const campaign = findCampaign(s, projectId, campaignIdValue);
      const item = campaign.seriesItems?.find((candidate) => candidate.id === itemId);
      if (!item) throw new Error("找不到这条 X 系列内容");
      if (published && xPostWeightedLength(item.post) > 280) throw new Error("X 主帖超过 280 字符限制，请先修改文案");
      if (published && !item.post.trim()) throw new Error("请先生成或填写 X 主帖");
      const expectedStoreUrl = item.storeUrl || campaign.source.storeUrl;
      if (published && !item.post.includes(expectedStoreUrl)) throw new Error("X 主帖缺少所选平台的 App Store 链接");
      const normalizedPostUrl = published ? normalizeXPostUrl(String(publishedUrl || "")) : null;
      if (published && !normalizedPostUrl) throw new Error("请粘贴有效的 X 帖子链接，例如 https://x.com/name/status/123");
      const now = new Date().toISOString();
      const activeEvent = [...campaign.publicationEvents].reverse().find(
        (event) => event.deliveryId === item.id && !event.revertedAt,
      );
      const publicationEvents = published
        ? activeEvent
          ? campaign.publicationEvents.map((event) => event.id === activeEvent.id ? { ...event, postUrl: normalizedPostUrl || undefined } : event)
          : [...campaign.publicationEvents, {
              id: `promotion-event-${randomUUID()}`,
              campaignId: campaign.id,
              projectId: campaign.projectId,
              productId: campaign.productId,
              releaseId: campaign.releaseTag,
              appVersion: campaign.appVersion,
              platform: "x" as const,
              deliveryId: item.id,
              contentRevision: item.revision,
              promotionAngle: item.angle,
              assetIds: [...(item.visualMode === "none" ? [] : item.finalAssetIds || item.selectedAssetIds)],
              postUrl: normalizedPostUrl || undefined,
              occurredAt: now,
            }]
        : campaign.publicationEvents.map((event) => event.id === activeEvent?.id ? { ...event, revertedAt: now } : event);
      return saveCampaign(s, {
        ...campaign,
        publicationEvents,
        seriesItems: campaign.seriesItems?.map((candidate) => candidate.id === item.id ? {
          ...candidate,
          status: published ? "published" : "ready",
          publishedAt: published ? candidate.publishedAt || activeEvent?.occurredAt || now : undefined,
          publishedUrl: published ? normalizedPostUrl || undefined : undefined,
          updatedAt: now,
        } : candidate),
      });
    },
  );

  ipcMain.handle(
    "promotion:generate",
    async (event, projectId: string, campaignIdValue: string, operationId: string) => {
      const s = await getStore();
      const campaign = findCampaign(s, projectId, campaignIdValue);
      if (!campaign.primaryAngle?.trim()) throw new Error("请先确认主传播角度");
      if (!campaign.enabledPlatforms.length) throw new Error("请至少选择一个平台");
      const screenshots = campaign.assets.filter((asset) => asset.role === "screenshot");
      if (!screenshots.length) throw new Error("请先导入至少一张真实截图");
      const { project, product } = findContext(s, projectId, campaign.productId);
      const profile = profileForProject(s, projectId, campaign.productId);
      if (!profile) throw new Error("请先设置推广平台");
      emitProgress(event, { kind: "phase", phase: "package", status: "started" });
      return withAiOperation(operationId, async (signal) => {
        const [provider, projectProfile] = await Promise.all([
          createAiProvider(s),
          buildProjectProfileFor(project, product, undefined, campaign.source.description),
        ]);
        const generated = await generatePromotionPackage(
          provider,
          {
            campaignId: campaign.id,
            source: campaign.source,
            profile,
            platforms: campaign.enabledPlatforms,
            primaryAngle: campaign.primaryAngle || "",
            assets: screenshots,
            projectProfile,
          },
          {
            signal,
            onProgress: (progress) => emitProgress(event, { kind: "chars", ...progress }),
            onRetry: () => emitProgress(event, { kind: "retry" }),
          },
        );
        emitProgress(event, { kind: "phase", phase: "package", status: "completed" });
        return saveCampaign(s, {
          ...campaign,
          brief: generated.brief,
          deliveries: revisionGeneratedDeliveries(generated.deliveries, campaign.deliveries),
          status: "ready",
        });
      });
    },
  );

  ipcMain.handle(
    "promotion:regenerateDelivery",
    async (
      event,
      projectId: string,
      campaignIdValue: string,
      platform: PromotionPlatform,
      feedback: string,
      operationId: string,
    ) => {
      const s = await getStore();
      const campaign = findCampaign(s, projectId, campaignIdValue);
      const current = campaign.deliveries.find((item) => item.platform === platform);
      if (!current) throw new Error("Platform delivery not found");
      const { project, product } = findContext(s, projectId, campaign.productId);
      const profile = profileForProject(s, projectId, campaign.productId);
      if (!profile) throw new Error("请先设置推广平台");
      return withAiOperation(operationId, async (signal) => {
        const [provider, projectProfile] = await Promise.all([
          createAiProvider(s),
          buildProjectProfileFor(project, product, undefined, campaign.source.description),
        ]);
        const candidate = await regeneratePromotionDelivery(
          provider,
          {
            source: campaign.source,
            profile,
            platform,
            primaryAngle: campaign.primaryAngle || "",
            assets: campaign.assets.filter((asset) => asset.role === "screenshot"),
            current,
            feedback: String(feedback || ""),
            projectProfile,
          },
          {
            signal,
            onProgress: (progress) => emitProgress(event, { kind: "chars", ...progress }),
            onRetry: () => emitProgress(event, { kind: "retry" }),
          },
        );
        return candidate;
      });
    },
  );

  ipcMain.handle(
    "promotion:markPublished",
    async (_event, projectId: string, campaignIdValue: string, platform: PromotionPlatform, published: boolean) => {
      const s = await getStore();
      const campaign = findCampaign(s, projectId, campaignIdValue);
      const delivery = campaign.deliveries.find((item) => item.platform === platform);
      if (!delivery) throw new Error("Platform delivery not found");
      if (published && platform === "x" && xPostWeightedLength(delivery.content.post || "") > 280) {
        throw new Error("X 主帖超过 280 字符限制，请先修改文案");
      }
      if (published && platform === "reddit" && !delivery.content.developerDisclosure) {
        throw new Error("Reddit 文案需要先确认开发者身份披露");
      }
      const now = new Date().toISOString();
      const previousEvents = Array.isArray(campaign.publicationEvents) ? campaign.publicationEvents : [];
      const activeEventIndex = [...previousEvents].reverse().findIndex(
        (item) => item.platform === platform && !item.revertedAt,
      );
      const activeEvent = activeEventIndex < 0
        ? null
        : previousEvents[previousEvents.length - 1 - activeEventIndex];
      const publicationEvents = published
        ? [
            ...previousEvents,
            {
              id: `promotion-event-${randomUUID()}`,
              campaignId: campaign.id,
              projectId: campaign.projectId,
              productId: campaign.productId,
              releaseId: campaign.releaseTag,
              appVersion: campaign.appVersion,
              platform,
              deliveryId: delivery.id,
              contentRevision: delivery.revision,
              promotionAngle: campaign.primaryAngle || "",
              assetIds: [...delivery.selectedAssetIds],
              occurredAt: now,
            },
          ]
        : previousEvents.map((item) => item.id === activeEvent?.id ? { ...item, revertedAt: now } : item);
      return saveCampaign(s, {
        ...campaign,
        publicationEvents,
        deliveries: campaign.deliveries.map((item) =>
          item.platform === platform
            ? {
                ...item,
                status: published ? "published" : "ready",
                publishedAt: published ? now : undefined,
                updatedAt: now,
              }
            : item,
        ),
      });
    },
  );

  ipcMain.handle("promotion:platformUrl", (_event, platform: PromotionPlatform, targetLabel?: string) =>
    promotionPlatformUrl(platform, targetLabel),
  );
}

function importAsset(
  campaignIdValue: string,
  sourcePath: string,
  role: "screenshot" | "generated",
): PromotionAsset {
  if (!fs.existsSync(sourcePath)) throw new Error(`图片不存在：${path.basename(sourcePath)}`);
  const image = nativeImage.createFromPath(sourcePath);
  if (image.isEmpty()) throw new Error(`无法读取图片：${path.basename(sourcePath)}`);
  const size = image.getSize();
  if (!size.width || !size.height) throw new Error(`图片尺寸无效：${path.basename(sourcePath)}`);
  const data = fs.readFileSync(sourcePath);
  const sha256 = createHash("sha256").update(data).digest("hex");
  const extension = normalizedImageExtension(sourcePath);
  const directory = path.join(
    app.getPath("userData"),
    "promotion-assets",
    createHash("sha256").update(campaignIdValue).digest("hex").slice(0, 24),
    role === "generated" ? "generated" : "sources",
  );
  fs.mkdirSync(directory, { recursive: true });
  const managedPath = path.join(directory, `${sha256}.${extension}`);
  if (!fs.existsSync(managedPath)) {
    const temporary = path.join(directory, `.${sha256}.${randomUUID()}.partial`);
    fs.copyFileSync(sourcePath, temporary, fs.constants.COPYFILE_EXCL);
    fs.renameSync(temporary, managedPath);
  }
  return {
    id: `asset-${role}-${sha256.slice(0, 20)}`,
    campaignId: campaignIdValue,
    role,
    origin: "imported",
    managedPath,
    originalPath: sourcePath,
    sha256,
    mimeType: mimeTypeForExtension(extension),
    fileName: path.basename(sourcePath),
    width: size.width,
    height: size.height,
    importedAt: new Date().toISOString(),
  };
}

function normalizedImageExtension(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase().replace(/^\./, "");
  if (ext === "jpeg") return "jpg";
  return ["png", "jpg", "webp", "heic"].includes(ext) ? ext : "png";
}

function mimeTypeForExtension(extension: string): string {
  if (extension === "jpg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "heic") return "image/heic";
  return "image/png";
}
