import { useEffect, useRef, useState } from "react";
import {
  xPostWeightedLength,
  type PromotionAsset,
  type PromotionCampaign,
  type XPromotionSeriesItem,
} from "@appilot-labs/appilot-core/promotion";
import { AIProgressButton } from "../ui/AIProgressButton";
import { btnPrimary, btnSecondary, btnSmPrimary, btnSmSecondary, inputClass } from "../ui/styles";
import { cn } from "../../lib/utils";

export function XPromotionSeriesView({
  projectId,
  campaign,
  screenshots,
  onChanged,
}: {
  projectId: string;
  campaign: PromotionCampaign;
  screenshots: PromotionAsset[];
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
  onChanged,
}: {
  projectId: string;
  campaign: PromotionCampaign;
  item: XPromotionSeriesItem;
  screenshots: PromotionAsset[];
  assets: PromotionAsset[];
  onChanged: (campaign: PromotionCampaign) => void;
}) {
  const [draft, setDraft] = useState(item);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<{ chars: number; phase: "reasoning" | "content" } | null>(null);
  const operationId = useRef("");
  const readOnly = draft.status === "published";
  const length = xPostWeightedLength(draft.post);

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
      onChanged(await (window as any).appilot.promotion.generateSeriesItem(projectId, campaign.id, item.id, operationId.current));
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
    } catch (cause: any) {
      setError(cause?.message || "保存失败");
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
    if (published && !window.confirm("标记这条 X 帖子已发布？这会记录当前修订、素材和时间，但不是平台回执。")) return;
    try {
      if (published && JSON.stringify(draft) !== JSON.stringify(item)) await save();
      onChanged(await (window as any).appilot.promotion.markSeriesItemPublished(projectId, campaign.id, item.id, published));
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

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            <span>{kindLabel(item.kind)}</span><span>·</span><span>{linkLabel(item.linkStrategy)}</span><span>·</span><span>推荐 {visualLabel(item.recommendedVisual)}</span>
          </div>
          <h2 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{item.title}</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{item.objective}</p>
          <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">传播角度：{item.angle}</p>
          <p className="mt-1 text-xs text-zinc-400">视觉建议：{item.visualReason}</p>
        </div>
        {!readOnly && item.status !== "skipped" && <button type="button" className={btnSmSecondary} onClick={skip}>跳过这一条</button>}
      </div>

      {item.status === "skipped" ? (
        <div className="mt-6 rounded-xl border-2 border-dashed border-zinc-200 px-5 py-8 text-center dark:border-zinc-800">
          <p className="text-sm text-zinc-500">这一条已从当前推广系列中跳过，内容仍被保留。</p>
          <button type="button" className={`${btnSecondary} mt-4`} onClick={restore}>恢复这一条</button>
        </div>
      ) : item.status === "planned" && !draft.post ? (
        <div className="mt-6 rounded-xl border-2 border-dashed border-zinc-200 px-5 py-8 text-center dark:border-zinc-800">
          <p className="text-sm text-zinc-500">准备发布这一条时，再生成最终文案和两种视觉提示词。</p>
          <div className="mt-4 flex justify-center">
            <AIProgressButton
              onStart={generate}
              onStop={() => operationId.current && void (window as any).appilot.ai.cancel(operationId.current)}
              idleLabel="生成这一条"
              loading={loading}
              progress={progress}
              disabled={!screenshots.length}
            />
          </div>
          {!screenshots.length && <p className="mt-2 text-xs text-amber-600">请先在系列上方导入至少一张正式截图</p>}
        </div>
      ) : (
        <>
          <div className="mt-5 space-y-4">
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              <span className="flex justify-between"><span>主帖</span><span className={length > 280 ? "text-red-600" : "text-zinc-400"}>{length}/280</span></span>
              <textarea className={cn(inputClass, "mt-1 min-h-32 resize-y", length > 280 && "border-red-400")} value={draft.post} readOnly={readOnly} onChange={(event) => setDraft((current) => ({ ...current, post: event.target.value }))} />
            </label>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              备选首句（替换主帖开头）
              <textarea className={`${inputClass} mt-1 min-h-16 resize-y`} value={draft.alternateOpening} readOnly={readOnly} onChange={(event) => setDraft((current) => ({ ...current, alternateOpening: event.target.value }))} />
            </label>
          </div>

          <div className="mt-5 grid gap-3 xl:grid-cols-2">
            <PromptCard title="场景图提示词" description="生成独立的真实使用场景，不把应用截图画进手机屏幕。" prompt={draft.sceneImagePrompt} />
            <PromptCard title="截图包装图提示词" description="上传正式截图，让 AI 只包装外围环境和构图。" prompt={draft.screenshotImagePrompt} />
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

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
            <div className="flex flex-wrap gap-2">
              {!readOnly && <button type="button" className={btnSecondary} disabled={saving} onClick={save}>{saving ? "正在保存…" : "保存修改"}</button>}
              {!readOnly && <button type="button" className={btnSecondary} onClick={generate}>重新生成这一条</button>}
              <button type="button" className={btnSecondary} onClick={() => navigator.clipboard.writeText(draft.post)}>复制文案</button>
            </div>
            <div className="flex gap-2">
              {readOnly ? (
                <button type="button" className={btnSecondary} onClick={() => markPublished(false)}>撤销发布标记</button>
              ) : (
                <>
                  <button type="button" className={btnPrimary} onClick={async () => void (window as any).appilot.openExternal(await (window as any).appilot.promotion.platformUrl("x"))}>打开 X</button>
                  <button type="button" className={btnSecondary} disabled={length > 280 || !draft.post.trim()} onClick={() => markPublished(true)}>标记已发布</button>
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

function linkLabel(value: XPromotionSeriesItem["linkStrategy"]): string {
  if (value === "store") return "包含商店链接";
  if (value === "soft") return "弱引导";
  return "不引流";
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
