import type { PromotionCampaign, XPromotionSeriesItem } from "@appilot-labs/appilot-core/promotion";

export type PromotionStoreLinkOption = {
  productId: string;
  platform: "ios" | "macos" | "unknown";
  label: string;
  url: string;
};

function productStoreUrl(product: any): string {
  return String(
    product.storeLinks?.find((link: any) => link.platform === product.platform)?.url ||
    product.storeLinks?.[0]?.url ||
    "",
  );
}

export function promotionStoreLinkOptions(project: any): PromotionStoreLinkOption[] {
  return (Array.isArray(project?.storeProducts) ? project.storeProducts : [])
    .map((product: any): PromotionStoreLinkOption => ({
      productId: String(product.id || ""),
      platform: product.platform === "ios" || product.platform === "macos" ? product.platform : "unknown",
      label: product.platform === "macos" ? "macOS" : product.platform === "ios" ? "iPhone / iOS" : "Apple 平台",
      url: productStoreUrl(product),
    }))
    .filter((item: PromotionStoreLinkOption) => item.productId && item.url);
}

export function defaultPromotionStoreLink(options: PromotionStoreLinkOption[]): PromotionStoreLinkOption | null {
  return options.find((item) => item.platform === "macos") || options[0] || null;
}

export function storeLinkForItem(
  item: Pick<XPromotionSeriesItem, "post" | "storeProductId" | "storeUrl">,
  options: PromotionStoreLinkOption[],
  fallbackUrl = "",
): PromotionStoreLinkOption | null {
  return options.find((option) => option.productId === item.storeProductId) ||
    options.find((option) => Boolean(option.url) && item.post.includes(option.url)) ||
    options.find((option) => option.url === item.storeUrl) ||
    options.find((option) => option.url === fallbackUrl) ||
    defaultPromotionStoreLink(options);
}

/** Add per-post link identity to legacy campaigns without changing their written copy. */
export function hydrateCampaignStoreLinks(
  campaign: PromotionCampaign,
  options: PromotionStoreLinkOption[],
): PromotionCampaign {
  if (!options.length || !campaign.seriesItems?.length) return campaign;
  return {
    ...campaign,
    seriesItems: campaign.seriesItems.map((item) => {
      const target = storeLinkForItem(item, options, campaign.source.storeUrl);
      return target ? {
        ...item,
        storeProductId: target.productId,
        storePlatform: target.platform,
        storeUrl: target.url,
      } : item;
    }),
  };
}
