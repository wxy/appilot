import { useCallback, useEffect, useState } from "react";
import { storefrontDisplayName, storefrontsForLanguage } from "../../../engine/storefronts";
import { formatHumanTime } from "../../lib/format";
import { cn } from "../../lib/utils";
import { btnPrimary, btnSmPrimary, btnSmSecondary } from "../ui/styles";

export function CompetitorPanel({
  projectId,
  product,
  defaultTerm,
  viewLang,
  rankSnapshots,
}: {
  projectId: string;
  product: {
    platform?: string;
    supportedLanguages?: { code: string }[];
    trackId?: string | null;
    bundleId?: string | null;
  };
  defaultTerm: string;
  viewLang: string;
  /** 自己的关键词排名（product.rankSnapshots），用于与竞品对比。 */
  rankSnapshots: any[];
}) {
  const [competitors, setCompetitors] = useState<any[]>([]);
  const [competitorRanks, setCompetitorRanks] = useState<Record<string, any[]>>({});
  const [trackedKeyword, setTrackedKeyword] = useState("");
  const [term, setTerm] = useState(defaultTerm);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [searchError, setSearchError] = useState("");

  const load = useCallback(() => {
    (window as any).appilot?.competitors?.list(projectId)
      .then(async (list: any[]) => {
        setCompetitors(list);
        const ranks: Record<string, any[]> = {};
        for (const competitor of list) {
          ranks[competitor.id] =
            (await (window as any).appilot?.competitors?.rankSnapshots(projectId, competitor.id)) || [];
        }
        setCompetitorRanks(ranks);
      })
      .catch(() => setCompetitors([]));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  // Keep the search box in sync with the keyword selected in the matrix.
  useEffect(() => {
    setTerm(defaultTerm);
  }, [defaultTerm]);

  // A changed search context (language / storefront / keyword) invalidates
  // the previous results.
  useEffect(() => {
    setCandidates([]);
    setSearchError("");
  }, [viewLang, defaultTerm]);

  // 按语言搜索：该语言对应的全部商店。
  const countryOptions = viewLang ? storefrontsForLanguage(viewLang) : ["us"];

  const handleSearch = async () => {
    if (!term.trim()) return;
    setSearching(true);
    setSearchError("");
    setCandidates([]);
    try {
      const results = await (window as any).appilot?.competitors?.search({
        term: term.trim(),
        countries: countryOptions,
        platform: product?.platform,
      });
      setCandidates(results || []);
    } catch (err: any) {
      setSearchError(err?.message || "搜索失败，请稍后重试。");
    } finally {
      setSearching(false);
    }
  };

  const handleAdd = async (candidate: any) => {
    setAdding(candidate.trackId);
    try {
      await (window as any).appilot?.competitors?.save(projectId, {
        name: candidate.trackName,
        trackId: candidate.trackId,
        platform: product?.platform || "unknown",
        githubUrl: null,
        notes: "",
        // 关联当前关键词：之后按 (竞品, 关键词, 商店) 采集竞品排名。
        linkedKeywords: defaultTerm.trim()
          ? [{ keyword: defaultTerm.trim(), language: viewLang || "en" }]
          : [],
      });
      load();
    } finally {
      setAdding(null);
    }
  };

  const appStorePageUrl = (candidate: any) =>
    candidate.trackViewUrl ||
    `https://apps.apple.com/${candidate.country || "us"}/app/id${candidate.trackId}`;

  const handleRemove = async (competitorId: string) => {
    await (window as any).appilot?.competitors?.remove(projectId, competitorId);
    load();
  };

  // 竞品跟踪：按关联关键词查看自己与所有竞品的排名对比。
  const linkedKeywords = Array.from(
    new Map(
      competitors
        .flatMap((c: any) => c.linkedKeywords || [])
        .map((l: any) => [`${l.keyword}\u0000${l.language}`, l]),
    ).values(),
  );
  const activeLink =
    linkedKeywords.find(
      (l: any) => `${l.keyword}\u0000${l.language}` === trackedKeyword,
    ) ||
    linkedKeywords[0] ||
    null;
  const ownRankByStore = new Map<string, number | null>();
  if (activeLink) {
    for (const s of rankSnapshots || []) {
      if (s.keyword === activeLink.keyword && s.language === activeLink.language) {
        ownRankByStore.set(s.storefront, s.rank);
      }
    }
  }
  const competitorRankAt = (competitor: any, storefront: string): number | null => {
    if (!activeLink) return null;
    const item = (competitorRanks[competitor.id] || []).find(
      (r: any) =>
        r.keyword === activeLink.keyword &&
        r.language === activeLink.language &&
        r.storefront === storefront,
    );
    return item?.rank ?? null;
  };

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">竞品雷达</h3>
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">手动添加 + 从关键词搜索候选一键加入，每日自动快照</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="搜索竞品（默认当前关键词）"
          className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm px-2.5 py-1.5 w-56"
        />
        <button type="button" onClick={() => void handleSearch()} disabled={searching} className={btnPrimary}>
          {searching ? "搜索中…" : "搜索候选"}
        </button>
      </div>

      {searchError && (
        <p className="mb-4 text-xs text-red-600 dark:text-red-400">{searchError}</p>
      )}

      {linkedKeywords.length > 0 && activeLink && (
        <div className="mb-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">竞品跟踪</h3>
            <span className="text-[11px] text-zinc-400">按关联关键词对比自己与竞品排名</span>
          </div>
          <div className="p-4">
            <div className="flex flex-wrap gap-1.5 mb-3">
              {linkedKeywords.map((link: any) => (
                <button
                  key={`${link.keyword}\u0000${link.language}`}
                  type="button"
                  onClick={() => setTrackedKeyword(`${link.keyword}\u0000${link.language}`)}
                  className={cn(
                    "px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors",
                    activeLink.keyword === link.keyword && activeLink.language === link.language
                      ? "border-amber-500 ring-2 ring-amber-500/20 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400"
                      : "border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-amber-500/50",
                  )}
                >
                  {link.keyword}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-100 dark:border-zinc-800 text-left">
                    <th className="py-1.5 pr-3 font-medium text-zinc-400">商店</th>
                    <th className="py-1.5 pr-3 font-medium text-amber-600 dark:text-amber-400">我</th>
                    {competitors.map((c) => (
                      <th key={c.id} className="py-1.5 pr-3 font-medium text-zinc-500 dark:text-zinc-400">
                        <span className="truncate inline-block max-w-28 align-bottom">{c.name}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {storefrontsForLanguage(activeLink.language).map((store) => (
                    <tr key={store} className="border-b border-zinc-100/60 dark:border-zinc-800/60 last:border-b-0">
                      <td className="py-1.5 pr-3 text-zinc-600 dark:text-zinc-300 whitespace-nowrap">
                        {storefrontDisplayName(store)}
                      </td>
                      <td className="py-1.5 pr-3 font-medium text-amber-700 dark:text-amber-300 whitespace-nowrap">
                        {ownRankByStore.get(store) ?? "未上榜"}
                      </td>
                      {competitors.map((c) => {
                        const rank = competitorRankAt(c, store);
                        return (
                          <td key={c.id} className="py-1.5 pr-3 text-zinc-600 dark:text-zinc-300 whitespace-nowrap">
                            {rank ?? "未上榜"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {candidates.length > 0 && (
        <div
          className={cn(
            "mb-4 grid gap-3",
            product?.platform === "macos"
              ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
              : "grid-cols-3 sm:grid-cols-4 lg:grid-cols-6",
          )}
        >
          {candidates.slice(0, 12).map((candidate) => {
            const isSelf = String(candidate.trackId) === String(product?.trackId ?? "");
            const isAdded = competitors.some(
              (c: any) => String(c.trackId) === String(candidate.trackId),
            );
            return (
              <div
                key={candidate.trackId}
                className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden flex flex-col"
              >
                <div
                  className={cn(
                    "w-full overflow-hidden bg-zinc-100 dark:bg-zinc-800",
                    product?.platform === "macos" ? "aspect-[4/3]" : "aspect-[3/4]",
                  )}
                >
                  {candidate.screenshotUrl ? (
                  <img
                    src={candidate.screenshotUrl}
                    alt={candidate.trackName}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                  ) : (
                  <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-400 dark:text-zinc-500">
                    无截图
                  </div>
                  )}
                </div>
                <div className="p-2.5 flex-1 flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      (window as any).appilot?.openAppPage(appStorePageUrl(candidate));
                    }}
                    disabled={!candidate.trackId}
                    className={cn(
                      "text-sm font-medium truncate text-left",
                      candidate.trackId
                        ? "text-zinc-800 dark:text-zinc-200 hover:text-amber-600 dark:hover:text-amber-400 hover:underline"
                        : "text-zinc-800 dark:text-zinc-200 cursor-default",
                    )}
                    title="在网页中打开 App Store 页面"
                  >
                    {candidate.trackName}
                  </button>
                  {candidate.subtitle && (
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate">
                      {candidate.subtitle}
                    </p>
                  )}
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                    {candidate.genre || "未知分类"}
                    {candidate.country ? ` · ${storefrontDisplayName(candidate.country)}` : ""}
                    {candidate.averageUserRating ? ` · ★${Number(candidate.averageUserRating).toFixed(1)}` : ""}
                  </p>
                  <div className="mt-auto pt-1.5">
                    {isSelf ? (
                      <span className="inline-flex px-2 py-1 rounded-md bg-zinc-100 dark:bg-zinc-800 text-[11px] text-zinc-500 dark:text-zinc-400">
                        当前应用
                      </span>
                    ) : isAdded ? (
                      <span className="inline-flex px-2 py-1 rounded-md bg-emerald-50 dark:bg-emerald-500/10 text-[11px] text-emerald-600 dark:text-emerald-400">
                        已添加
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleAdd(candidate)}
                        disabled={adding === candidate.trackId}
                        className={btnSmPrimary}
                      >
                        {adding === candidate.trackId ? "添加中…" : "添加"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {competitors.length === 0 ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">尚未添加竞品。</p>
      ) : (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {competitors.map((competitor) => (
              <div key={competitor.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      if (competitor.trackId) {
                        (window as any).appilot?.openAppPage(`https://apps.apple.com/us/app/id${competitor.trackId}`);
                      }
                    }}
                    disabled={!competitor.trackId}
                    className={cn(
                      "text-sm truncate text-left max-w-full",
                      competitor.trackId
                        ? "text-zinc-800 dark:text-zinc-200 hover:text-amber-600 dark:hover:text-amber-400 hover:underline"
                        : "text-zinc-800 dark:text-zinc-200 cursor-default",
                    )}
                    title={competitor.trackId ? "打开 App Store 页面" : "无商店链接"}
                  >
                    {competitor.name}
                  </button>
                  <div className="text-[11px] text-zinc-400 dark:text-zinc-500">
                    {competitor.trackId ? `trackId ${competitor.trackId}` : "无商店链接"}
                    {competitor.githubUrl ? ` · ${competitor.githubUrl}` : ""}
                    {competitor.addedAt ? ` · 加入于 ${formatHumanTime(competitor.addedAt)}` : ""}
                  </div>
                </div>
                <button type="button" onClick={() => void handleRemove(competitor.id)} className={btnSmSecondary}>
                  移除
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
