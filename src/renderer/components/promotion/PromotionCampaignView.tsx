import { useEffect, useRef, useState } from "react";
import {
  promotionRecommendationLabel,
  type PromotionAsset,
  type PromotionCampaign,
} from "@appilot-labs/appilot-core/promotion";
import { AIProgressButton } from "../ui/AIProgressButton";
import { btnSecondary, btnSmSecondary, inputLineClass } from "../ui/styles";
import { XPromotionSeriesView } from "./XPromotionSeriesView";

interface ReleaseCandidate {
  id: string;
  releaseTag: string;
  appVersion: string;
  storePublishedAt: string;
  source: any;
  campaign: PromotionCampaign | null;
}

export function PromotionCampaignView({
  projectId,
  productId,
  release,
  initialCampaign,
  platformsLabel,
  storeLinkOptions,
  onBack,
  onChanged,
}: {
  projectId: string;
  productId: string;
  release: ReleaseCandidate | null;
  initialCampaign: PromotionCampaign | null;
  platformsLabel: string;
  storeLinkOptions: Array<{ productId: string; platform: "ios" | "macos" | "unknown"; label: string; url: string }>;
  onBack: () => void;
  onChanged: (campaign: PromotionCampaign) => void;
}) {
  const [campaign, setCampaign] = useState(initialCampaign);
  const [angle, setAngle] = useState(initialCampaign?.primaryAngle || "");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [progress, setProgress] = useState<{ chars: number; phase: "reasoning" | "content" } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setCampaign(initialCampaign);
    setAngle(initialCampaign?.primaryAngle || "");
  }, [initialCampaign?.id]);

  useEffect(() => {
    const off = (window as any).appilot?.promotion?.onProgress?.((event: any) => {
      if (event?.kind === "chars") {
        setProgress({ chars: Number(event.chars || 0), phase: event.phase === "content" ? "content" : "reasoning" });
      }
      if (event?.kind === "retry") setRetrying(true);
    });
    return () => off?.();
  }, []);

  const update = (next: PromotionCampaign) => {
    setCampaign(next);
    setAngle(next.primaryAngle || "");
    onChanged(next);
  };

  const run = async (action: (operationId: string) => Promise<PromotionCampaign>) => {
    setLoading(true);
    setError("");
    setProgress(null);
    setRetrying(false);
    try {
      update(await action(crypto.randomUUID()));
      setRetry(false);
    } catch (cause: any) {
      if (!String(cause?.message || "").includes("取消")) setError(cause?.message || "操作失败");
      setRetry(true);
    } finally {
      setLoading(false);
      setProgress(null);
      setRetrying(false);
    }
  };

  const analyze = () => {
    if (!release) return;
    void run((operationId) => {
      activeOperation.current = operationId;
      return (window as any).appilot.promotion.analyze(projectId, productId, release.releaseTag, operationId);
    });
  };
  const activeOperation = useRef("");
  const stopCurrent = () => {
    if (activeOperation.current) void (window as any).appilot?.ai?.cancel(activeOperation.current);
  };

  if (!campaign) {
    return (
      <CampaignShell onBack={onBack} version={release?.appVersion || ""} publishedAt={release?.storePublishedAt || ""} platformsLabel={platformsLabel}>
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">准备这个版本的 X 推广系列</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            Appilot 会读取已经确认的版本事实，一次完成推广角度分析和系列规划。之后只需逐条生成、发布并记录 X 帖子链接。
          </p>
          <div className="mt-6">
            <AIProgressButton
              onStart={analyze}
              onStop={stopCurrent}
              idleLabel="准备 X 推广系列"
              loading={loading}
              progress={progress}
              retry={retry}
              retrying={retrying}
            />
          </div>
          {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
        </section>
      </CampaignShell>
    );
  }

  if (campaign.status === "skipped") {
    return (
      <CampaignShell onBack={onBack} version={campaign.appVersion} publishedAt={campaign.storePublishedAt} platformsLabel={platformsLabel}>
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">本次已跳过</p>
          <h2 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{campaign.skipReason || "本版本不进行推广"}</h2>
          <p className="mt-2 text-sm text-zinc-500">记录时间：{formatDate(campaign.skippedAt)}</p>
        </section>
      </CampaignShell>
    );
  }

  const screenshots = campaign.assets.filter((item) => item.role === "screenshot");
  const generatedAssets = campaign.assets.filter((item) => item.role === "generated");
  const saveDecision = async () => {
    if (!angle.trim()) {
      setError("请确认一个主传播角度");
      return null;
    }
    const next = await (window as any).appilot.promotion.saveCampaign(projectId, {
      ...campaign,
      primaryAngle: angle.trim(),
      enabledPlatforms: ["x"],
    });
    update(next);
    return next as PromotionCampaign;
  };

  const importAssets = async (role: "screenshot" | "generated") => {
    setError("");
    try {
      const saved = role === "screenshot" ? await saveDecision() : campaign;
      if (!saved) return;
      const next = await (window as any).appilot.promotion.importAssets(projectId, saved.id, role);
      update(next);
    } catch (cause: any) {
      setError(cause?.message || "导入失败");
    }
  };

  const skip = async () => {
    const reason = window.prompt("记录本次跳过的原因", campaign.recommendationReason || "本次不推广");
    if (reason === null) return;
    try {
      update(await (window as any).appilot.promotion.skip(projectId, campaign.id, reason));
    } catch (cause: any) {
      setError(cause?.message || "保存失败");
    }
  };

  const generate = async () => {
    const saved = await saveDecision();
    if (!saved) return;
    await run((operationId) => {
      activeOperation.current = operationId;
      return (window as any).appilot.promotion.generateSeriesPlan(projectId, saved.id, operationId);
    });
  };

  if (!campaign.seriesItems?.length) {
    return (
      <CampaignShell onBack={onBack} version={campaign.appVersion} publishedAt={campaign.storePublishedAt} platformsLabel={platformsLabel}>
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <span className="inline-flex rounded-full bg-amber-50 dark:bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
                {promotionRecommendationLabel(campaign.recommendation)}
              </span>
              <h2 className="mt-3 text-lg font-semibold text-zinc-900 dark:text-zinc-100">推广建议</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                {campaign.recommendationReason}
              </p>
            </div>
            <button type="button" className={btnSmSecondary} onClick={skip}>本次跳过</button>
          </div>

          <label className="mt-5 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            主传播角度
            <input className={`${inputLineClass} mt-1`} value={angle} onChange={(event) => setAngle(event.target.value)} />
          </label>

          <div className="mt-6 border-t border-zinc-100 dark:border-zinc-800 pt-5">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">配图（可选）</h3>
            {campaign.recommendedScreenshotTypes.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {campaign.recommendedScreenshotTypes.map((item, index) => (
                  <span key={item} className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 text-xs text-zinc-600 dark:text-zinc-300">
                    {index + 1}. {item}
                  </span>
                ))}
              </div>
            )}
            <p className="mt-3 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
              可以先生成纯文字系列；如需配图，再选择当前实际存在的 1–2 张正式截图。
            </p>
            <AssetStrip projectId={projectId} campaign={campaign} assets={screenshots} onChanged={update} />
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <button type="button" className={btnSecondary} onClick={() => importAssets("screenshot")} disabled={screenshots.length >= 2}>
                {screenshots.length ? "再添加一张" : "选择 1–2 张截图"}
              </button>
              <AIProgressButton
                onStart={generate}
                onStop={stopCurrent}
                idleLabel="生成 X 系列计划"
                loading={loading}
                progress={progress}
                retry={retry}
                retrying={retrying}
              />
            </div>
          </div>
          {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
        </section>
      </CampaignShell>
    );
  }

  return (
    <CampaignShell onBack={onBack} version={campaign.appVersion} publishedAt={campaign.storePublishedAt} platformsLabel={platformsLabel} status={campaign.status}>
      <details className="mb-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <summary className="cursor-pointer text-sm font-semibold text-zinc-900 dark:text-zinc-100">配图与素材（可选）</summary>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">正式截图保存在项目受管目录；外部 AI 生成的成品也可导入留档。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnSecondary} onClick={() => importAssets("screenshot")} disabled={screenshots.length >= 2}>添加截图</button>
            <button type="button" className={btnSecondary} onClick={() => importAssets("generated")}>导入外部生成成品</button>
          </div>
        </div>
        <AssetStrip projectId={projectId} campaign={campaign} assets={screenshots} onChanged={update} />
        {generatedAssets.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium text-zinc-500">已导入的生成图</p>
            <AssetStrip projectId={projectId} campaign={campaign} assets={generatedAssets} role="generated" onChanged={update} />
          </div>
        )}
      </details>
      <XPromotionSeriesView
        projectId={projectId}
        campaign={campaign}
        screenshots={screenshots}
        storeLinkOptions={storeLinkOptions}
        onChanged={update}
      />
      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </CampaignShell>
  );
}

function AssetStrip({
  projectId,
  campaign,
  assets,
  role = "screenshot",
  onChanged,
}: {
  projectId: string;
  campaign: PromotionCampaign;
  assets: PromotionAsset[];
  role?: "screenshot" | "generated";
  onChanged: (campaign: PromotionCampaign) => void;
}) {
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {assets.map((asset, index) => (
        <AssetCard
          key={asset.id}
          projectId={projectId}
          campaign={campaign}
          asset={asset}
          label={role === "generated" ? `生成图 ${index + 1}` : index === 0 ? "主截图" : "辅助截图"}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}

function AssetCard({
  projectId,
  campaign,
  asset,
  label,
  onChanged,
}: {
  projectId: string;
  campaign: PromotionCampaign;
  asset: PromotionAsset;
  label: string;
  onChanged: (campaign: PromotionCampaign) => void;
}) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void (window as any).appilot.promotion.assetPreview(projectId, campaign.id, asset.id).then((value: string | null) => {
      if (live) setSrc(value);
    });
    return () => { live = false; };
  }, [projectId, campaign.id, asset.id]);

  const remove = async () => {
    onChanged(await (window as any).appilot.promotion.removeAsset(projectId, campaign.id, asset.id));
  };
  return (
    <div className="flex gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
      <div className="flex h-24 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800">
        {src ? <img src={src} alt={asset.fileName} className="h-full w-full object-cover" /> : <span className="px-2 text-center text-xs text-zinc-400">{src === null ? "受管副本缺失" : "载入中"}</span>}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">{label}</p>
        <p className="mt-1 truncate text-sm text-zinc-800 dark:text-zinc-200" title={asset.fileName}>{asset.fileName}</p>
        <p className="mt-1 text-xs text-zinc-400">{asset.width} × {asset.height}</p>
        <button type="button" className="mt-2 text-xs text-red-600 hover:underline dark:text-red-400" onClick={remove}>移除</button>
      </div>
    </div>
  );
}

function CampaignShell({
  onBack,
  version,
  publishedAt,
  platformsLabel,
  status,
  children,
}: {
  onBack: () => void;
  version: string;
  publishedAt: string;
  platformsLabel: string;
  status?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <button type="button" onClick={onBack} className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">← 返回推广</button>
      <div className="mb-6 mt-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">v{String(version).replace(/^v/i, "")}</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{formatDate(publishedAt)} · {platformsLabel || "Apple 平台"} · App Store 已上架</p>
        </div>
        {status && <span className="text-xs text-zinc-400">{campaignStatusLabel(status)}</span>}
      </div>
      {children}
    </div>
  );
}

function formatDate(value?: string): string {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function campaignStatusLabel(value: string): string {
  if (value === "published") return "推广已完成";
  if (value === "partially_published") return "部分已发布";
  if (value === "ready") return "推广系列已准备";
  return "推广进行中";
}
