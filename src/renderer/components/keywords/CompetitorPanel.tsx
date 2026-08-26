import { useCallback, useEffect, useState } from "react";
import { storefrontDisplayName, storefrontsForLanguage } from "../../../engine/storefronts";
import { languageLabel } from "../../lib/format";
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
  const [refreshingRanks, setRefreshingRanks] = useState(false);
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
      // 立即补采新竞品的排名（不需要等下一次定时关键词抓取）。
      await (window as any).appilot?.competitors?.refreshRanks(projectId);
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

  const handleRefreshRanks = async () => {
    if (refreshingRanks) return;
    setRefreshingRanks(true);
    try {
      await (window as any).appilot?.competitors?.refreshRanks(projectId);
      await load();
    } finally {
      setRefreshingRanks(false);
    }
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
                  {(candidate.subtitle || candidate.description) && (
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate">
                      {candidate.subtitle ||
                        (candidate.description
                          ? String(candidate.description).slice(0, 60)
                          : "")}
                    </p>
                  )}
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                    {candidate.genre || "未知分类"}
                    {(candidate.countries && candidate.countries.length > 0
                      ? `可用：${candidate.countries.slice(0, 3).map((c: string) => storefrontDisplayName(c)).join("、")}`
                      : candidate.country
                        ? `可用：${storefrontDisplayName(candidate.country)}`
                        : "")}
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

      {competitors.length > 0 && (
        <div className="mb-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">竞品跟踪</h3>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-zinc-400">按关联关键词对比自己与竞品排名</span>
              <button
                type="button"
                onClick={() => void handleRefreshRanks()}
                disabled={refreshingRanks}
                className={btnSmSecondary}
              >
                {refreshingRanks ? "采集中…" : "刷新排名"}
              </button>
            </div>
          </div>
          {linkedKeywords.length === 0 ? (
            <p className="px-4 py-4 text-xs text-zinc-400 dark:text-zinc-500">
              竞品未关联关键词。添加竞品时使用搜索关键词关联，排名随关键词抓取采集。
            </p>
          ) : activeLink ? (
          (() => {
            const stores = storefrontsForLanguage(activeLink.language);
            const trackedCompetitors = competitors.filter((c: any) =>
              (c.linkedKeywords || []).some(
                (l: any) =>
                  l.keyword === activeLink.keyword && l.language === activeLink.language,
              ),
            );
            return (
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
                  {languageLabel(link.language)} · {link.keyword}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-100 dark:border-zinc-800 text-left">
                    <th className="py-1.5 pr-3 font-medium text-zinc-400">竞品</th>
                    {stores.map((store) => (
                      <th key={store} className="py-1.5 pr-3 font-medium text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                        {storefrontDisplayName(store)}
                      </th>
                    ))}
                    <th className="py-1.5 font-medium text-zinc-400" />
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-zinc-100/60 dark:border-zinc-800/60">
                    <td className="py-1.5 pr-3 font-medium text-amber-700 dark:text-amber-300 whitespace-nowrap">
                      我
                    </td>
                    {stores.map((store) => (
                      <td key={store} className="py-1.5 pr-3 text-amber-700 dark:text-amber-300 whitespace-nowrap">
                        {ownRankByStore.get(store) ?? "未上榜"}
                      </td>
                    ))}
                    <td />
                  </tr>
                  {trackedCompetitors.map((c) => (
                    <tr key={c.id} className="border-b border-zinc-100/60 dark:border-zinc-800/60 last:border-b-0">
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              if (c.trackId) {
                                (window as any).appilot?.openAppPage(
                                  `https://apps.apple.com/us/app/id${c.trackId}`,
                                );
                              }
                            }}
                            className="text-zinc-800 dark:text-zinc-200 hover:text-amber-600 dark:hover:text-amber-400 hover:underline"
                          >
                            {c.name}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleRemove(c.id)}
                            className="text-zinc-300 dark:text-zinc-600 hover:text-red-500 transition-colors"
                            title="移除竞品"
                          >
                            ✕
                          </button>
                        </span>
                      </td>
                      {stores.map((store) => {
                        const rank = competitorRankAt(c, store);
                        return (
                          <td key={store} className="py-1.5 pr-3 text-zinc-600 dark:text-zinc-300 whitespace-nowrap">
                            {rank ?? "未上榜"}
                          </td>
                        );
                      })}
                      <td />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
            );
          })()
          ) : null}
        </div>
      )}

      {competitors.length === 0 ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">尚未添加竞品。</p>
      ) : null}
    </div>
  );
}
