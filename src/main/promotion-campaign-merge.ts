import type { PromotionCampaign, PromotionSourceSnapshot } from "@appilot-labs/appilot-core/promotion";

type TargetPlatform = "ios" | "macos" | "unknown";

function progressScore(campaign: PromotionCampaign): number {
  const statusScore: Record<PromotionCampaign["status"], number> = {
    suggested: 0,
    draft: 10,
    ready: 20,
    partially_published: 30,
    published: 40,
    skipped: 5,
  };
  const generated = campaign.seriesItems?.filter((item) => item.post.trim()).length || 0;
  const published = campaign.seriesItems?.filter((item) => item.status === "published").length || 0;
  return statusScore[campaign.status] + generated * 2 + published * 5;
}

export function mergePromotionCampaigns(
  current: PromotionCampaign[],
  scope: { productIds: string[]; targetPlatforms: TargetPlatform[] },
  idFor: (source: PromotionSourceSnapshot) => string,
): { campaigns: PromotionCampaign[]; changed: boolean } {
  const groups = new Map<string, PromotionCampaign[]>();
  for (const campaign of current) {
    const key = campaign.appVersion || campaign.releaseTag;
    groups.set(key, [...(groups.get(key) || []), campaign]);
  }
  const campaigns = [...groups.values()].map((group) => {
    const winner = [...group].sort((a, b) =>
      progressScore(b) - progressScore(a) ||
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )[0];
    const id = idFor(winner.source);
    return {
      ...winner,
      id,
      productIds: scope.productIds,
      targetPlatforms: scope.targetPlatforms,
      assets: winner.assets.map((asset) => ({ ...asset, campaignId: id })),
      publicationEvents: winner.publicationEvents.map((event) => ({ ...event, campaignId: id })),
    };
  });
  const changed = campaigns.length !== current.length || campaigns.some((item, index) =>
    item.id !== current[index]?.id ||
    JSON.stringify(item.productIds) !== JSON.stringify(current[index]?.productIds) ||
    JSON.stringify(item.targetPlatforms) !== JSON.stringify(current[index]?.targetPlatforms),
  );
  return { campaigns, changed };
}
