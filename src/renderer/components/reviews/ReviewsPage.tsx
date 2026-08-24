import { useCallback, useEffect, useState } from "react";
import { storefrontDisplayName } from "../../../engine/storefronts";
import type { Review } from "../../../engine/review-collector";
import { useProject } from "../../stores/project";
import { reviewStats } from "../../lib/review-stats";
import { formatHumanTime } from "../../lib/format";
import { cn } from "../../lib/utils";
import { EmptyState } from "../ui/EmptyState";
import { btnPrimary } from "../ui/styles";

function ratingStars(rating: number) {
  return "★".repeat(rating) + "☆".repeat(5 - rating);
}

export function ReviewsPage() {
  const { projects, currentProjectId, currentProductId } = useProject();
  const project = projects.find((p) => p.id === currentProjectId);
  const product = project?.storeProducts?.find((item) => item.id === currentProductId) || project?.storeProducts?.[0] || null;
  const [byCountry, setByCountry] = useState<Record<string, { items: Review[]; lastFetchedAt?: string }>>({});
  const [country, setCountry] = useState("all");
  const [minRating, setMinRating] = useState(0);
  const [version, setVersion] = useState("all");
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    if (!product) return;
    (window as any).appilot?.reviews?.list(product.id)
      .then(setByCountry)
      .catch(() => setByCountry({}));
  }, [product?.id]);

  useEffect(() => { load(); }, [load]);

  if (!project || !product) {
    return <EmptyState title="还没有项目" desc="添加一个项目后，这里会展示评论洞察。" />;
  }

  const all: Review[] = [];
  for (const entry of Object.values(byCountry)) {
    for (const item of entry?.items || []) all.push(item);
  }
  const countries = Object.keys(byCountry).filter((key) => (byCountry[key]?.items || []).length > 0);
  const versions = [...new Set(all.map((r) => r.version).filter(Boolean))].sort();
  const stats = reviewStats(all);
  const filtered = all.filter((r) =>
    (country === "all" || r.country === country) &&
    (version === "all" || r.version === version) &&
    r.rating >= minRating,
  );

  const handleSync = async () => {
    if (!product || syncing) return;
    setSyncing(true);
    setError("");
    try {
      await (window as any).appilot?.reviews?.sync(product.id);
      load();
    } catch (err: any) {
      setError(err?.message || "同步失败");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">评论洞察</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
            数据来源：App Store 评论 RSS（免费，按 storefront 每日增量采集）。
          </p>
        </div>
        <button type="button" onClick={() => void handleSync()} disabled={syncing} className={btnPrimary}>
          {syncing ? "同步中…" : "立即同步"}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/50 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3">
          <div className="text-[11px] text-zinc-400 dark:text-zinc-500">评论总数</div>
          <div className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{stats.total}</div>
        </div>
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3">
          <div className="text-[11px] text-zinc-400 dark:text-zinc-500">平均评分</div>
          <div className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{stats.average ?? "—"}</div>
        </div>
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3">
          <div className="text-[11px] text-zinc-400 dark:text-zinc-500">近 30 天</div>
          <div className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{stats.recent30}</div>
        </div>
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3">
          <div className="text-[11px] text-zinc-400 dark:text-zinc-500">评分分布</div>
          <div className="flex items-end gap-1 h-7 mt-1">
            {[5, 4, 3, 2, 1].map((rating) => {
              const count = stats.distribution[rating] || 0;
              const max = Math.max(1, ...Object.values(stats.distribution));
              return (
                <div key={rating} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full rounded-sm bg-amber-400 dark:bg-amber-500/70" style={{ height: `${Math.round((count / max) * 100)}%` }} />
                  <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{rating}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select value={country} onChange={(e) => setCountry(e.target.value)} className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm px-2.5 py-1.5">
          <option value="all">全部国家</option>
          {countries.map((c) => (
            <option key={c} value={c}>{storefrontDisplayName(c) || c}</option>
          ))}
        </select>
        <select value={version} onChange={(e) => setVersion(e.target.value)} className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm px-2.5 py-1.5">
          <option value="all">全部版本</option>
          {versions.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <div className="flex items-center gap-1">
          {[0, 1, 2, 3, 4, 5].map((rating) => (
            <button
              key={rating}
              type="button"
              onClick={() => setMinRating(rating)}
              className={cn(
                "px-2 py-1 text-xs rounded-lg transition-colors",
                minRating === rating
                  ? "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400"
                  : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800",
              )}
            >
              {rating === 0 ? "全部" : `${rating}★+`}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={all.length === 0 ? "还没有评论" : "筛选结果为空"}
          desc={all.length === 0 ? "点击右上角「立即同步」获取评论。" : "调整筛选条件再试。"}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((review) => (
            <div key={`${review.country}-${review.id}`} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3">
              <div className="flex items-center justify-between gap-3 mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-amber-500 dark:text-amber-400 text-sm">{ratingStars(review.rating)}</span>
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">{review.title || "（无标题）"}</span>
                </div>
                <span className="text-[11px] text-zinc-400 dark:text-zinc-500 shrink-0">
                  {storefrontDisplayName(review.country) || review.country}
                  {review.version ? ` · v${review.version}` : ""} · {formatHumanTime(review.updatedAt)}
                </span>
              </div>
              {review.body && <p className="text-sm text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap">{review.body}</p>}
              {review.author && <div className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">by {review.author}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
