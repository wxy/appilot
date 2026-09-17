import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  promotionPlatformLabel,
  promotionRecommendationLabel,
  type ProductPromotionProfile,
  type PromotionCampaign,
} from "@appilot-labs/appilot-core/promotion";
import { useProject } from "../../stores/project";
import { btnPrimary, btnSecondary, btnSmPrimary } from "../ui/styles";
import { EmptyState } from "../ui/EmptyState";
import { PromotionCampaignView } from "./PromotionCampaignView";
import { PromotionProfileEditor } from "./PromotionProfileEditor";

interface ReleaseCandidate {
  id: string;
  releaseTag: string;
  appVersion: string;
  storePublishedAt: string;
  source: any;
  campaign: PromotionCampaign | null;
}

interface PromotionListResult {
  profile: ProductPromotionProfile | null;
  campaigns: PromotionCampaign[];
  releases: ReleaseCandidate[];
}

export function PromotionPage() {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const { projects, currentProjectId, currentProductId } = useProject();
  const project = projects.find((item) => item.id === currentProjectId) || null;
  const product = project?.storeProducts.find((item) => item.id === currentProductId) || project?.storeProducts[0] || null;
  const [data, setData] = useState<PromotionListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editingProfile, setEditingProfile] = useState(false);

  const load = useCallback(async () => {
    if (!project?.id || !product?.id) {
      setData(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const promotionApi = (window as any).appilot?.promotion;
      if (!promotionApi?.list) {
        throw new Error("推广功能尚未载入完整，请退出并重新打开 Appilot");
      }
      setData(await promotionApi.list(project.id, product.id));
    } catch (cause: any) {
      setError(cause?.message || "无法载入推广活动");
    } finally {
      setLoading(false);
    }
  }, [project?.id, product?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedRelease = useMemo(
    () => data?.releases.find((item) => item.id === campaignId || item.campaign?.id === campaignId) || null,
    [data?.releases, campaignId],
  );
  const selectedCampaign = useMemo(
    () => selectedRelease?.campaign || data?.campaigns.find((item) => item.id === campaignId) || null,
    [data?.campaigns, selectedRelease, campaignId],
  );

  if (!project || !product) {
    return <EmptyState title="尚未选择项目" desc="先选择一个项目，再管理上架后的推广。" />;
  }

  if (loading && !data) {
    return <div className="flex h-full items-center justify-center text-sm text-zinc-400">正在载入推广活动…</div>;
  }

  if (campaignId && data?.profile && (selectedRelease || selectedCampaign)) {
    return (
      <PromotionCampaignView
        projectId={project.id}
        productId={product.id}
        release={selectedRelease}
        initialCampaign={selectedCampaign}
        onBack={() => navigate("/promotion")}
        onChanged={(campaign) => {
          setData((current) => current ? {
            ...current,
            campaigns: [campaign, ...current.campaigns.filter((item) => item.id !== campaign.id)],
            releases: current.releases.map((item) =>
              item.id === campaign.id || item.appVersion === campaign.appVersion
                ? { ...item, campaign }
                : item,
            ),
          } : current);
          if (campaignId !== campaign.id) navigate(`/promotion/${campaign.id}`, { replace: true });
        }}
      />
    );
  }

  const saveProfile = async (value: ProductPromotionProfile) => {
    const saved = await (window as any).appilot.promotion.saveProfile(project.id, product.id, value);
    setData((current) => current ? { ...current, profile: saved } : current);
    setEditingProfile(false);
  };

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">推广</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">将已上架版本转化为可执行的海外推广内容</p>
        </div>
        {data?.profile && !editingProfile && (
          <button type="button" className={btnSecondary} onClick={() => setEditingProfile(true)}>推广平台设置</button>
        )}
      </header>

      {(!data?.profile || editingProfile) && (
        <div className="mb-6">
          <PromotionProfileEditor
            value={data?.profile || null}
            productId={product.id}
            onSave={saveProfile}
            onCancel={data?.profile ? () => setEditingProfile(false) : undefined}
          />
          {data?.profile && (
            <div className="mt-3 flex justify-end"><button type="button" className={btnSecondary} onClick={() => setEditingProfile(false)}>取消</button></div>
          )}
        </div>
      )}

      {error && <p className="mb-4 rounded-xl bg-red-50 dark:bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</p>}

      {data?.profile && data.releases.length === 0 && data.campaigns.length === 0 ? (
        <section className="rounded-2xl border-2 border-dashed border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/40 py-16 text-center">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">尚无可推广的已上架版本</h2>
          <p className="mt-2 text-sm text-zinc-400">完成上架并同步商店实际文案后，Appilot 会在这里准备建议。</p>
          <button type="button" className={`${btnPrimary} mt-5`} onClick={() => navigate("/release")}>前往发布</button>
        </section>
      ) : data?.profile ? (
        <PromotionGroups
          releases={data.releases}
          campaigns={data.campaigns}
          onOpen={(id) => navigate(`/promotion/${id}`)}
        />
      ) : null}
    </div>
  );
}

function PromotionGroups({
  releases,
  campaigns,
  onOpen,
}: {
  releases: ReleaseCandidate[];
  campaigns: PromotionCampaign[];
  onOpen: (id: string) => void;
}) {
  const releasesByCampaign = new Set(releases.map((item) => item.campaign?.id).filter(Boolean));
  const orphanCampaigns = campaigns.filter((item) => !releasesByCampaign.has(item.id));
  const entries = [
    ...releases.map((release) => ({ id: release.campaign?.id || release.id, release, campaign: release.campaign })),
    ...orphanCampaigns.map((campaign) => ({ id: campaign.id, release: null, campaign })),
  ];
  const needsAction = entries.filter((item) => !item.campaign);
  const active = entries.filter((item) => item.campaign && !["published", "skipped"].includes(item.campaign.status));
  const completed = entries.filter((item) => item.campaign && ["published", "skipped"].includes(item.campaign.status));

  return (
    <div className="space-y-7">
      <Group title="需要处理" entries={needsAction} onOpen={onOpen} />
      <Group title="进行中" entries={active} onOpen={onOpen} />
      <Group title="已完成" entries={completed} onOpen={onOpen} compact />
    </div>
  );
}

function Group({
  title,
  entries,
  onOpen,
  compact = false,
}: {
  title: string;
  entries: Array<{ id: string; release: ReleaseCandidate | null; campaign: PromotionCampaign | null }>;
  onOpen: (id: string) => void;
  compact?: boolean;
}) {
  if (!entries.length) return null;
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</h2>
      <div className="space-y-2">
        {entries.map(({ id, release, campaign }) => {
          const version = campaign?.appVersion || release?.appVersion || release?.releaseTag || "";
          const published = campaign?.storePublishedAt || release?.storePublishedAt;
          const publishCount = campaign?.deliveries.filter((item) => item.status === "published").length || 0;
          const deliveryCount = campaign?.deliveries.filter((item) => item.status !== "skipped").length || 0;
          const detail = !campaign
            ? "尚未分析"
            : campaign.status === "skipped"
              ? campaign.skipReason || "已跳过"
              : `${promotionRecommendationLabel(campaign.recommendation)}${deliveryCount ? ` · ${publishCount}/${deliveryCount} 已发布` : ""}`;
          return (
            <div key={id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 shadow-sm">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">v{String(version).replace(/^v/i, "")}</h3>
                  {campaign?.deliveries.map((delivery) => delivery.status === "published" ? (
                    <span key={delivery.platform} className="rounded-full bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-300">{promotionPlatformLabel(delivery.platform)}</span>
                  ) : null)}
                </div>
                <p className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400">{formatDate(published)} · {detail}</p>
              </div>
              <button type="button" className={btnSmPrimary} onClick={() => onOpen(id)}>
                {actionLabel(campaign, compact)}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function actionLabel(campaign: PromotionCampaign | null, compact: boolean): string {
  if (!campaign) return "分析推广价值";
  if (compact) return campaign.status === "skipped" ? "查看原因" : "查看记录";
  if (!campaign.assets.some((item) => item.role === "screenshot")) return "选择截图";
  if (!campaign.brief) return "生成推广包";
  if (campaign.status === "partially_published") return "继续推广";
  return "继续编辑";
}

function formatDate(value?: string): string {
  if (!value) return "上架时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(date);
}
