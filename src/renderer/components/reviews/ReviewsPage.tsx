import { useCallback, useEffect, useState } from "react";
import { storefrontDisplayName } from "@appilot-labs/appilot-core/storefronts";
import type { Review } from "@appilot-labs/appilot-core/review-collector";
import type { FeedbackTheme } from "@appilot-labs/appilot-core/feedback-inbox";
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
  const [themes, setThemes] = useState<FeedbackTheme[]>([]);
  const [clustering, setClustering] = useState(false);
  const [adopting, setAdopting] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!product) return;
    (window as any).appilot?.reviews?.list(product.id)
      .then(setByCountry)
      .catch(() => setByCountry({}));
  }, [product?.id]);

  useEffect(() => { load(); }, [load]);

  const loadThemes = useCallback(() => {
    if (!project) return;
    (window as any).appilot?.feedback?.themes(project.id)
      .then(setThemes)
      .catch(() => setThemes([]));
  }, [project?.id]);

  useEffect(() => { loadThemes(); }, [loadThemes]);

  if (!project || !product) {
    return <EmptyState title="还没有项目" desc="添加一个项目后，这里会展示评论洞察。" />;
  }

  const all: Review[] = [];
  for (const entry of Object.values(byCountry)) {
    for (const item of entry?.items || []) all.push(item);
  }
  const lastSyncedAt = Object.values(byCountry).reduce<string | null>(
    (latest, entry) => {
      const fetchedAt = entry?.lastFetchedAt || null;
      return fetchedAt && (!latest || new Date(fetchedAt).getTime() > new Date(latest).getTime())
        ? fetchedAt
        : latest;
    },
    null,
  );
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

  const handleCluster = async () => {
    if (!project || !product || clustering) return;
    setClustering(true);
    setError("");
    try {
      const next = await (window as any).appilot?.feedback?.cluster(project.id, product.id);
      setThemes(next || []);
    } catch (err: any) {
      setError(err?.message || "聚类失败");
    } finally {
      setClustering(false);
    }
  };

  const handleAdopt = async (keyword: string) => {
    if (!project || !product || adopting) return;
    setAdopting(keyword);
    try {
      const language = product.supportedLanguages?.[0]?.code || "en";
      const pool = [...(project.trackedKeywords || [])];
      if (!pool.some((item) => item.keyword === keyword && item.language === language)) {
        pool.push({ language, keyword, rationale: "来自反馈主题洞察", translation: "", source: "ai" });
      }
      await (window as any).appilot?.projects?.saveTrackedKeywords(product.id, pool);
      await useProject.getState().load();
    } finally {
      setAdopting(null);
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

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm mb-5">
        <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">AI 洞察</h3>
          <button type="button" onClick={() => void handleCluster()} disabled={clustering} className={btnPrimary}>
            {clustering ? "聚类中…" : themes.length > 0 ? "重新聚类" : "生成洞察"}
          </button>
        </div>
        {themes.length === 0 ? (
          <div className="px-5 py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">
            把评论与 GitHub Issues 聚成「用户一直要什么」的主题，反哺关键词与描述角度。
          </div>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {themes.map((theme) => (
              <div key={theme.title} className="px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{theme.title}</div>
                  <span className="text-[11px] text-zinc-400 dark:text-zinc-500 shrink-0">
                    {theme.evidenceCount} 条证据 · 评论 {theme.sourceBreakdown.reviews} / Issues {theme.sourceBreakdown.issues}
                  </span>
                </div>
                {theme.sampleQuotes.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {theme.sampleQuotes.slice(0, 2).map((quote, index) => (
                      <li key={index} className="text-xs text-zinc-500 dark:text-zinc-400">「{quote}」</li>
                    ))}
                  </ul>
                )}
                {theme.suggestedKeywords.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {theme.suggestedKeywords.map((keyword) => (
                      <span key={keyword} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-[11px] text-amber-700 dark:text-amber-400">
                        {keyword}
                        <button
                          type="button"
                          onClick={() => void handleAdopt(keyword)}
                          disabled={adopting === keyword}
                          className="hover:underline"
                        >
                          {adopting === keyword ? "…" : "采纳"}
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {theme.suggestedDescriptionAngles.length > 0 && (
                  <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                    描述角度：{theme.suggestedDescriptionAngles.join("、")}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
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
          title={all.length === 0 ? (lastSyncedAt ? "已同步，暂无评论" : "还没有评论") : "筛选结果为空"}
          desc={
            all.length === 0
              ? lastSyncedAt
                ? "已同步完成，目前没有评论（应用较新或商店尚未积累评分），会自动每日更新。"
                : "点击右上角「立即同步」获取评论。"
              : "调整筛选条件再试。"
          }
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
