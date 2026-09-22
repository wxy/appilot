import { useEffect, useRef, useState } from "react";
import {
  xComposeUrl,
  xPostWeightedLength,
  type PromotionAsset,
  type PromotionCampaign,
  type XPromotionSeriesItem,
} from "@appilot-labs/appilot-core/promotion";
import { AIProgressButton } from "../ui/AIProgressButton";
import { btnPrimary, btnSecondary, btnSmPrimary, btnSmSecondary, inputClass } from "../ui/styles";
import { cn } from "../../lib/utils";

type StoreLinkOption = {
  productId: string;
  platform: "ios" | "macos" | "unknown";
  label: string;
  url: string;
};

export function XPromotionSeriesView({
  projectId,
  campaign,
  screenshots,
  storeLinkOptions,
  onChanged,
}: {
  projectId: string;
  campaign: PromotionCampaign;
  screenshots: PromotionAsset[];
  storeLinkOptions: StoreLinkOption[];
  onChanged: (campaign: PromotionCampaign) => void;
}) {
  const items = campaign.seriesItems || [];
  const [selectedId, setSelectedId] = useState(items[0]?.id || "");
  const selected = items.find((item) => item.id === selectedId) || items[0];

  useEffect(() => {
    if (!items.some((item) => item.id === selectedId)) setSelectedId(items[0]?.id || "");
  }, [items, selectedId]);

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">X 推广系列</p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">按需逐条生成，不必一次全部发布</p>
        </div>
        <div className="space-y-2">
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedId(item.id)}
              className={cn(
                "w-full rounded-xl border p-3 text-left transition-colors",
                item.id === selected?.id
                  ? "border-amber-400 bg-amber-50 dark:bg-amber-500/10"
                  : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-zinc-400">{index + 1} · {kindLabel(item.kind)}</span>
                <span className={cn("text-[11px]", statusColor(item.status))}>{statusLabel(item.status)}</span>
              </div>
              <p className="mt-1 text-sm font-semibold text-zinc-800 dark:text-zinc-200">{item.title}</p>
              <p className="mt-1 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">{item.objective}</p>
            </button>
          ))}
        </div>
      </aside>

      {selected && (
        <SeriesItemEditor
          key={`${selected.id}:${selected.revision}:${selected.status}`}
          projectId={projectId}
          campaign={campaign}
          item={selected}
          screenshots={screenshots}
          assets={campaign.assets}
          storeLinkOptions={storeLinkOptions}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}

function SeriesItemEditor({
  projectId,
  campaign,
  item,
  screenshots,
  assets,
  storeLinkOptions,
  onChanged,
}: {
  projectId: string;
  campaign: PromotionCampaign;
  item: XPromotionSeriesItem;
  screenshots: PromotionAsset[];
  assets: PromotionAsset[];
  storeLinkOptions: StoreLinkOption[];
  onChanged: (campaign: PromotionCampaign) => void;
}) {
  const [draft, setDraft] = useState(item);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState(item.publishedUrl || "");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<{ chars: number; phase: "reasoning" | "content" } | null>(null);
  const operationId = useRef("");
  const readOnly = draft.status === "published";
  const length = xPostWeightedLength(draft.post);
  const selectedStoreLink = storeLinkOptions.find((option) => option.productId === draft.storeProductId) ||
    storeLinkOptions.find((option) => draft.post.includes(option.url)) ||
    storeLinkOptions.find((option) => option.url === draft.storeUrl) ||
    storeLinkOptions.find((option) => option.platform === "macos") ||
    storeLinkOptions[0];
  const expectedStoreUrl = selectedStoreLink?.url || draft.storeUrl || campaign.source.storeUrl;
  const hasStoreLink = Boolean(expectedStoreUrl && draft.post.includes(expectedStoreUrl));

  useEffect(() => {
    const off = (window as any).appilot?.promotion?.onProgress?.((event: any) => {
      if (event?.kind === "chars") setProgress({ chars: Number(event.chars || 0), phase: event.phase === "content" ? "content" : "reasoning" });
    });
    return () => off?.();
  }, []);

  const generate = async () => {
    if (draft.status === "ready" && !window.confirm("重新生成会覆盖这条帖子的当前文案和两份图片提示词。是否继续？")) return;
    setLoading(true);
    setError("");
    setProgress(null);
    operationId.current = crypto.randomUUID();
    try {
      onChanged(await (window as any).appilot.promotion.generateSeriesItem(
        projectId,
        campaign.id,
        item.id,
        operationId.current,
        selectedStoreLink?.productId,
      ));
    } catch (cause: any) {
      if (!String(cause?.message || "").includes("取消")) setError(cause?.message || "生成失败");
    } finally {
      setLoading(false);
      setProgress(null);
      operationId.current = "";
    }
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const now = new Date().toISOString();
      onChanged(await (window as any).appilot.promotion.saveCampaign(projectId, {
        ...campaign,
        seriesItems: campaign.seriesItems?.map((candidate) => candidate.id === item.id ? {
          ...draft,
          revision: Math.max(draft.revision, item.revision) + 1,
          status: draft.post.trim() ? "ready" : "planned",
          updatedAt: now,
        } : candidate),
      }));
      return true;
    } catch (cause: any) {
      setError(cause?.message || "保存失败");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const skip = async () => {
    onChanged(await (window as any).appilot.promotion.saveCampaign(projectId, {
      ...campaign,
      seriesItems: campaign.seriesItems?.map((candidate) => candidate.id === item.id ? { ...candidate, status: "skipped", updatedAt: new Date().toISOString() } : candidate),
    }));
  };

  const restore = async () => {
    onChanged(await (window as any).appilot.promotion.saveCampaign(projectId, {
      ...campaign,
      seriesItems: campaign.seriesItems?.map((candidate) => candidate.id === item.id ? {
        ...candidate,
        status: candidate.post.trim() ? "ready" : "planned",
        updatedAt: new Date().toISOString(),
      } : candidate),
    }));
  };

  const markPublished = async (published: boolean) => {
    if (published && !publishedUrl.trim()) {
      setError("请先粘贴这条帖子的 X 链接");
      return;
    }
    if (published && !window.confirm("记录这条 X 帖子已发布？Appilot 会保存帖子链接、当前修订、素材和时间。")) return;
    try {
      if (published && JSON.stringify(draft) !== JSON.stringify(item) && !(await save())) return;
      onChanged(await (window as any).appilot.promotion.markSeriesItemPublished(projectId, campaign.id, item.id, published, published ? publishedUrl.trim() : undefined));
    } catch (cause: any) {
      setError(cause?.message || "记录失败");
    }
  };

  const toggleAsset = (assetId: string) => {
    setDraft((current) => ({
      ...current,
      selectedAssetIds: current.selectedAssetIds.includes(assetId)
        ? current.selectedAssetIds.filter((id) => id !== assetId)
        : [...current.selectedAssetIds, assetId],
    }));
  };

  const changeStoreLink = (productId: string) => {
    const target = storeLinkOptions.find((option) => option.productId === productId);
    if (!target) return;
    setDraft((current) => {
      const previousUrl = current.storeUrl || selectedStoreLink?.url || campaign.source.storeUrl;
      return {
        ...current,
        storeProductId: target.productId,
        storePlatform: target.platform,
        storeUrl: target.url,
        post: current.post && previousUrl && current.post.includes(previousUrl)
          ? current.post.split(previousUrl).join(target.url)
          : current.post,
      };
    });
  };

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            <span>{kindLabel(item.kind)}</span><span>·</span><span>包含商店链接</span><span>·</span><span>推荐 {visualLabel(item.recommendedVisual)}</span>
          </div>
          <h2 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{item.title}</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{item.objective}</p>
          <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">传播角度：{item.angle}</p>
          <p className="mt-1 text-xs text-zinc-400">视觉建议：{item.visualReason}</p>
        </div>
        {!readOnly && item.status !== "skipped" && <button type="button" className={btnSmSecondary} onClick={skip}>跳过这一条</button>}
      </div>

      <label className="mt-5 block rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-300">
        帖子中的商店链接
        <select
          className={`${inputClass} mt-1`}
          value={selectedStoreLink?.productId || ""}
          disabled={readOnly || storeLinkOptions.length < 2}
          onChange={(event) => changeStoreLink(event.target.value)}
        >
          {storeLinkOptions.map((option) => (
            <option key={option.productId} value={option.productId}>
              {option.label}{option.platform === "macos" ? "（默认主平台）" : ""}
            </option>
          ))}
        </select>
        <span className="mt-1 block truncate font-normal text-zinc-400" title={expectedStoreUrl}>{expectedStoreUrl || "尚无可用商店链接"}</span>
      </label>

      {item.status === "skipped" ? (
        <div className="mt-6 rounded-xl border-2 border-dashed border-zinc-200 px-5 py-8 text-center dark:border-zinc-800">
          <p className="text-sm text-zinc-500">这一条已从当前推广系列中跳过，内容仍被保留。</p>
          <button type="button" className={`${btnSecondary} mt-4`} onClick={restore}>恢复这一条</button>
        </div>
      ) : item.status === "planned" && !draft.post ? (
        <div className="mt-6 rounded-xl border-2 border-dashed border-zinc-200 px-5 py-8 text-center dark:border-zinc-800">
          <p className="text-sm text-zinc-500">生成可直接发布到 X 的英文帖子，并自动包含对应的 App Store 链接。</p>
          <div className="mt-4 flex justify-center">
            <AIProgressButton
              onStart={generate}
              onStop={() => operationId.current && void (window as any).appilot.ai.cancel(operationId.current)}
              idleLabel="生成这一条"
              loading={loading}
              progress={progress}
            />
          </div>
          {!screenshots.length && <p className="mt-2 text-xs text-zinc-400">截图是可选项；可先生成纯文字帖子，稍后再添加配图。</p>}
        </div>
      ) : (
        <>
          <div className="mt-5 space-y-4">
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              <span className="flex justify-between"><span>主帖</span><span className={length > 280 ? "text-red-600" : "text-zinc-400"}>{length}/280</span></span>
              <textarea className={cn(inputClass, "mt-1 min-h-32 resize-y", length > 280 && "border-red-400")} value={draft.post} readOnly={readOnly} onChange={(event) => setDraft((current) => ({ ...current, post: event.target.value }))} />
            </label>
            {!hasStoreLink && <p className="text-xs text-red-600">主帖缺少对应的 App Store 链接，请重新生成或补回链接。</p>}
          </div>

          <details className="mt-5 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <summary className="cursor-pointer text-sm font-semibold text-zinc-700 dark:text-zinc-300">配图、备选文案与素材记录（可选）</summary>
            <label className="mt-4 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              备选首句（替换主帖开头）
              <textarea className={`${inputClass} mt-1 min-h-16 resize-y`} value={draft.alternateOpening} readOnly={readOnly} onChange={(event) => setDraft((current) => ({ ...current, alternateOpening: event.target.value }))} />
            </label>
            <div className="mt-4 grid gap-3 xl:grid-cols-2">
              <PromptCard title="场景图提示词" description="生成独立的真实使用场景，不把应用截图画进手机屏幕。" prompt={draft.sceneImagePrompt} />
              {draft.screenshotImagePrompt && <PromptCard title="截图包装图提示词" description="上传正式截图，让 AI 只包装外围环境和构图。" prompt={draft.screenshotImagePrompt} />}
            </div>

          <div className="mt-4 rounded-xl bg-zinc-50 p-4 dark:bg-zinc-800/50">
            <p className="text-xs font-medium text-zinc-500">原始截图也可以直接发布</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {screenshots.map((asset, index) => (
                <button key={asset.id} type="button" className={btnSmSecondary} onClick={() => void (window as any).appilot.revealInFolder(asset.managedPath)}>
                  在 Finder 中显示{index === 0 ? "主截图" : "辅助截图"}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">记录这条帖子实际使用的素材</p>
            <p className="mt-1 text-xs text-zinc-400">生成后默认选中提示词所参考的截图；导入生成图后，请改为最终实际发布的图片。</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {assets.map((asset) => (
                <label key={asset.id} className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
                  <input type="checkbox" className="accent-amber-500" checked={draft.selectedAssetIds.includes(asset.id)} disabled={readOnly} onChange={() => toggleAsset(asset.id)} />
                  <span>{asset.role === "generated" ? "生成图" : "截图"} · {asset.fileName}</span>
                </label>
              ))}
              {!assets.length && <span className="text-xs text-zinc-400">尚无素材</span>}
            </div>
          </div>
          </details>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
            <div className="flex flex-wrap gap-2">
              {!readOnly && <button type="button" className={btnSecondary} disabled={saving} onClick={save}>{saving ? "正在保存…" : "保存修改"}</button>}
              {!readOnly && <button type="button" className={btnSecondary} onClick={generate}>重新生成这一条</button>}
              <button type="button" className={btnSecondary} onClick={() => navigator.clipboard.writeText(draft.post)}>复制文案</button>
            </div>
            <div className="flex min-w-[280px] flex-1 flex-col items-end gap-2">
              {readOnly ? (
                <>
                  {item.publishedUrl ? (
                    <button type="button" className={btnPrimary} onClick={() => void (window as any).appilot.openExternal(item.publishedUrl)}>查看已发布帖子 ↗</button>
                  ) : (
                    <div className="flex w-full max-w-xl gap-2">
                      <input className={inputClass} value={publishedUrl} onChange={(event) => setPublishedUrl(event.target.value)} placeholder="补录 X 帖子链接：https://x.com/name/status/…" />
                      <button type="button" className={btnSecondary} disabled={!publishedUrl.trim()} onClick={() => markPublished(true)}>保存链接</button>
                    </div>
                  )}
                  <button type="button" className={btnSecondary} onClick={() => markPublished(false)}>撤销发布记录</button>
                </>
              ) : (
                <>
                  <button type="button" className={btnPrimary} disabled={length > 280 || !draft.post.trim() || !hasStoreLink} onClick={() => void (window as any).appilot.openExternal(xComposeUrl(draft.post))}>在 X 中发布 ↗</button>
                  <div className="flex w-full max-w-xl gap-2">
                    <input className={inputClass} value={publishedUrl} onChange={(event) => setPublishedUrl(event.target.value)} placeholder="发布后粘贴帖子链接：https://x.com/name/status/…" />
                    <button type="button" className={btnSecondary} disabled={length > 280 || !draft.post.trim() || !hasStoreLink || !publishedUrl.trim()} onClick={() => markPublished(true)}>记录发布</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </section>
  );
}

function PromptCard({ title, description, prompt }: { title: string; description: string; prompt: string }) {
  return (
    <details className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <summary className="cursor-pointer text-sm font-semibold text-zinc-800 dark:text-zinc-200">{title}</summary>
      <p className="mt-2 text-xs leading-5 text-zinc-500">{description}</p>
      <textarea className={`${inputClass} mt-3 min-h-52 resize-y`} value={prompt} readOnly />
      <button type="button" className={`${btnSmPrimary} mt-3`} disabled={!prompt} onClick={() => navigator.clipboard.writeText(prompt)}>复制提示词</button>
    </details>
  );
}

function kindLabel(value: XPromotionSeriesItem["kind"]): string {
  if (value === "release") return "版本发布";
  if (value === "feature") return "功能介绍";
  if (value === "use_case") return "使用场景";
  return "反馈问题";
}

function visualLabel(value: XPromotionSeriesItem["recommendedVisual"]): string {
  if (value === "scenario") return "场景图";
  if (value === "raw") return "原始截图";
  return "截图包装图";
}

function statusLabel(value: XPromotionSeriesItem["status"]): string {
  if (value === "ready") return "已准备";
  if (value === "published") return "已发布";
  if (value === "skipped") return "已跳过";
  return "待生成";
}

function statusColor(value: XPromotionSeriesItem["status"]): string {
  if (value === "published") return "text-emerald-600 dark:text-emerald-400";
  if (value === "ready") return "text-amber-600 dark:text-amber-400";
  return "text-zinc-400";
}
