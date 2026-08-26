import { useCallback, useEffect, useState } from "react";
import { storefrontDisplayName, storefrontsForLanguage } from "../../../engine/storefronts";
import { formatHumanTime, languageLabel, platformLabel } from "../../lib/format";
import { cn } from "../../lib/utils";
import { btnPrimary, btnSmPrimary, btnSmSecondary } from "../ui/styles";
import { ValueFlash } from "../ui/ValueFlash";

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
    trackName?: string | null;
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
  const [addMessage, setAddMessage] = useState("");
  const [linkCandidates, setLinkCandidates] = useState<Record<string, any[]>>({});
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [refreshingRanks, setRefreshingRanks] = useState(false);
  const [page, setPage] = useState(0);
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
  // 主进程数据变更推送：竞品数据更新时自动刷新。
  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail === "competitors") load();
    };
    window.addEventListener("appilot:data-changed", handler);
    return () => window.removeEventListener("appilot:data-changed", handler);
  }, [load]);

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
      const platform = product?.platform === "macos" ? "macos" : "ios";
      const res = await (window as any).appilot?.competitors?.save(projectId, {
        name: candidate.trackName,
        trackId: candidate.trackId,
        platform,
        // 按平台写入 trackId：同一品牌可再关联另一平台的列表。
        trackIds: { [platform]: candidate.trackId },
        githubUrl: null,
        notes: "",
        // 关联当前关键词：之后按 (竞品, 关键词, 商店) 采集竞品排名。
        // 关联语言 = 搜索时的视图语言（中文视图 → cn/sg，英文视图 → us/gb 等），
        // 竞品排名按该语言商店采集，与矩阵中该视图看到的排名一致。
        linkedKeywords: defaultTerm.trim()
          ? [{ keyword: defaultTerm.trim(), language: viewLang || "en" }]
          : [],
      });
      setAddMessage(
        res?.merged
          ? "该竞品已存在，已自动关联当前平台版本。"
          : "",
      );
      load();
    } finally {
      setAdding(null);
    }
  };

  // 当前视图平台：竞品矩阵只看该平台的排名，避免 iOS/macOS 数据混比。
  const viewPlatform: "ios" | "macos" =
    product?.platform === "macos" ? "macos" : "ios";
  const otherPlatform: "ios" | "macos" = viewPlatform === "macos" ? "ios" : "macos";
  const competitorTrackId = (competitor: any, platform: "ios" | "macos"): string | null => {
    const ids = { ...(competitor.trackIds || {}) };
    if (competitor.trackId && competitor.platform === platform) {
      ids[platform] = competitor.trackId;
    }
    return ids[platform] ? String(ids[platform]) : null;
  };
  const handleLinkSearch = async (competitor: any) => {
    setLinkingId(competitor.id);
    try {
      const results = await (window as any).appilot?.competitors?.search({
        term: competitor.name,
        countries: countryOptions,
        platform: otherPlatform,
      });
      setLinkCandidates((prev) => ({
        ...prev,
        [competitor.id]: (results || []).slice(0, 6),
      }));
    } catch {
      setLinkCandidates((prev) => ({ ...prev, [competitor.id]: [] }));
    } finally {
      setLinkingId(null);
    }
  };
  const handleLinkPlatform = async (competitor: any, candidate: any) => {
    await (window as any).appilot?.competitors?.linkPlatform(
      projectId,
      competitor.id,
      otherPlatform,
      candidate.trackId,
    );
    setLinkCandidates((prev) => ({ ...prev, [competitor.id]: undefined }));
    load();
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
      // 只按关键词文本匹配：兼容旧数据中关联语言可能记错的情况。
      if (s.keyword === activeLink.keyword) {
        ownRankByStore.set(s.storefront, s.rank);
      }
    }
  }
  const competitorRankAt = (competitor: any, storefront: string): number | null => {
    if (!activeLink) return null;
    const item = (competitorRanks[competitor.id] || []).find(
      (r: any) =>
        r.keyword === activeLink.keyword &&
        r.storefront === storefront &&
        // 兼容旧数据：无 platform 字段的条目按竞品原平台判定。
        (r.platform == null
          ? competitor.platform === viewPlatform
          : r.platform === viewPlatform),
    );
    return item?.rank ?? null;
  };
  // 每个关键词最多关联 5 个竞品。
  const MAX_COMPETITORS_PER_KEYWORD = 5;
  const defaultKeyword = defaultTerm.trim();
  const defaultLinkedCount = competitors.filter((c: any) =>
    (c.linkedKeywords || []).some((l: any) => l.keyword === defaultKeyword),
  ).length;
  const atLimit = defaultLinkedCount >= MAX_COMPETITORS_PER_KEYWORD;
  const rankCellClass = (rank: number | null) => {
    if (rank == null) return "bg-zinc-100/70 dark:bg-zinc-800/40 text-zinc-400 dark:text-zinc-500";
    if (rank <= 10) return "bg-green-700/85 text-white";
    if (rank <= 50) return "bg-green-500/85 text-white";
    if (rank <= 100) return "bg-lime-300/80 text-green-950";
    if (rank <= 200) return "bg-yellow-300/80 text-yellow-950";
    return "bg-zinc-200/80 text-zinc-600 dark:bg-zinc-700/70 dark:text-zinc-300";
  };
  const ownTrackId = String(product?.trackId ?? "");
  const hasSelfInResults = candidates.some((c) => String(c.trackId) === ownTrackId);
  const isAddedCandidate = (candidate: any) =>
    competitors.some((c: any) => {
      const ids = [c.trackId, ...Object.values(c.trackIds || {})]
        .filter(Boolean)
        .map(String);
      return ids.includes(String(candidate.trackId));
    });
  const PAGE_SIZE = 12;
  const totalPages = Math.max(1, Math.ceil(candidates.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageCandidates = candidates.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );

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
      {addMessage && (
        <p className="mb-4 text-xs text-amber-600 dark:text-amber-400">{addMessage}</p>
      )}

      {candidates.length > 0 && (
        <>
        {!hasSelfInResults && (
          <p className="mb-2 text-[11px] text-zinc-400 dark:text-zinc-500">
            当前平台（{platformLabel(product?.platform || "unknown")}）的搜索结果中未包含本应用
            ——你可能在 iOS 商店排名较高，可切换平台后查看。
          </p>
        )}
        <div
          className={cn(
            "mb-4 grid gap-3",
            product?.platform === "macos"
              ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
              : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
          )}
        >
          {pageCandidates.map((candidate) => {
            const isSelf = String(candidate.trackId) === String(product?.trackId ?? "");
            const isAdded = isAddedCandidate(candidate);
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
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500 line-clamp-2 leading-4">
                      {candidate.subtitle ||
                        (candidate.description
                          ? String(candidate.description).slice(0, 140)
                          : "")}
                    </p>
                  )}
                  <div className="mt-auto pt-1.5 flex items-center justify-between gap-2">
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                      {candidate.genre || "未知分类"}
                      {candidate.averageUserRating ? ` · ★${Number(candidate.averageUserRating).toFixed(1)}` : ""}
                    </p>
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
                        disabled={adding === candidate.trackId || atLimit}
                        className={btnSmPrimary}
                        title={atLimit ? `该关键词最多关联 ${MAX_COMPETITORS_PER_KEYWORD} 个竞品` : undefined}
                      >
                        {adding === candidate.trackId
                          ? "添加中…"
                          : atLimit
                            ? "已达上限"
                            : "添加"}
                      </button>
                    )}
                  </div>
                  {(candidate.countries && candidate.countries.length > 0) && (
                    <p className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate">
                      {candidate.countries
                        .map(
                          (c: string) =>
                            `${storefrontDisplayName(c)}${
                              candidate.ranks?.[c] ? `#${candidate.ranks[c]}` : ""
                            }`,
                        )
                        .join("  ")}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {totalPages > 1 && (
          <div className="mb-4 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setPage((v) => Math.max(0, v - 1))}
              disabled={safePage === 0}
              className={btnSmSecondary}
            >
              上一页
            </button>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {safePage + 1} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((v) => Math.min(totalPages - 1, v + 1))}
              disabled={safePage >= totalPages - 1}
              className={btnSmSecondary}
            >
              下一页
            </button>
          </div>
        )}
        </>
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
            const linkedCompetitors = competitors.filter((c: any) =>
              (c.linkedKeywords || []).some(
                (l: any) =>
                  l.keyword === activeLink.keyword && l.language === activeLink.language,
              ),
            );
            // 未在当前平台（iOS/macOS）上架的竞品不进入该平台的跟踪表，
            // 多平台应用两边的视图都会显示。
            const trackedCompetitors = linkedCompetitors.filter((c: any) =>
              Boolean(competitorTrackId(c, viewPlatform)),
            );
            const hiddenCount = linkedCompetitors.length - trackedCompetitors.length;
            return (
            <div className="p-4">
              {hiddenCount > 0 && (
                <p className="mb-2 text-[10px] text-zinc-400 dark:text-zinc-500">
                  {hiddenCount} 个竞品未在{platformLabel(viewPlatform)}上架，已在当前平台隐藏。
                </p>
              )}
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
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-left">
                    <th className="py-2 px-3 border border-zinc-200 dark:border-zinc-700 font-medium text-zinc-400 text-left">竞品</th>
                    {stores.map((store) => (
                      <th key={store} className="py-2 px-3 border border-zinc-200 dark:border-zinc-700 font-medium text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                        {storefrontDisplayName(store)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="py-2 px-3 border border-zinc-200 dark:border-zinc-700 font-medium text-amber-700 dark:text-amber-300 whitespace-nowrap">
                      我
                    </td>
                    {stores.map((store) => (
                      <td
                        key={store}
                        className={cn(
                          "py-2 px-3 text-center border border-zinc-200 dark:border-zinc-700 whitespace-nowrap font-medium",
                          rankCellClass(ownRankByStore.get(store) ?? null),
                        )}
                      >
                        <ValueFlash value={ownRankByStore.get(store) ?? null}>
                          {ownRankByStore.get(store) ?? "未上榜"}
                        </ValueFlash>
                      </td>
                    ))}
                  </tr>
                  {trackedCompetitors.map((c) => (
                    <tr key={c.id}>
                      <td className="py-2 px-3 border border-zinc-200 dark:border-zinc-700 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
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
                          <span className="flex gap-0.5">
                            {(["ios", "macos"] as const).map((p) => (
                              <span
                                key={p}
                                className={cn(
                                  "px-1 py-px rounded text-[9px] font-medium leading-none",
                                  competitorTrackId(c, p)
                                    ? "bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600",
                                )}
                              >
                                {p === "macos" ? "macOS" : "iOS"}
                              </span>
                            ))}
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleRemove(c.id)}
                            className="text-zinc-300 dark:text-zinc-600 hover:text-red-500 transition-colors"
                            title="移除竞品"
                          >
                            ✕
                          </button>
                        </div>
                        <div className="mt-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">
                          {c.addedAt ? `加入 ${formatHumanTime(c.addedAt)}` : "加入时间未知"}
                          {(() => {
                            const latestRankAt = (competitorRanks[c.id] || []).reduce(
                              (latest: string | null, r: any) =>
                                r.platform != null && r.platform !== viewPlatform
                                  ? latest
                                  : !latest ||
                                      new Date(r.checkedAt).getTime() >
                                        new Date(latest).getTime()
                                    ? r.checkedAt
                                    : latest,
                              null,
                            );
                            return latestRankAt
                              ? ` · 排名 ${formatHumanTime(latestRankAt)}`
                              : " · 排名尚未查询";
                          })()}
                        </div>
                        {!competitorTrackId(c, otherPlatform) && (
                          <div className="mt-1">
                            <button
                              type="button"
                              onClick={() => void handleLinkSearch(c)}
                              disabled={linkingId === c.id}
                              className="text-[10px] text-amber-600 dark:text-amber-400 hover:underline"
                            >
                              {linkingId === c.id
                                ? "搜索中…"
                                : `关联 ${platformLabel(otherPlatform)} 版本`}
                            </button>
                            {linkCandidates[c.id] && (
                              <div className="mt-1 flex flex-col gap-1">
                                {linkCandidates[c.id].length === 0 ? (
                                  <span className="text-[10px] text-zinc-400">
                                    未找到同名应用
                                  </span>
                                ) : (
                                  linkCandidates[c.id].map((cand: any) => (
                                    <div
                                      key={cand.trackId}
                                      className="flex items-center justify-between gap-2 text-[10px]"
                                    >
                                      <span className="truncate text-zinc-600 dark:text-zinc-400">
                                        {cand.trackName}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => void handleLinkPlatform(c, cand)}
                                        className="text-amber-600 dark:text-amber-400 hover:underline shrink-0"
                                      >
                                        关联
                                      </button>
                                    </div>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      {stores.map((store) => {
                        const rank = competitorRankAt(c, store);
                        return (
                          <td
                            key={store}
                            className={cn(
                              "py-2 px-3 text-center border border-zinc-200 dark:border-zinc-700 whitespace-nowrap",
                              rankCellClass(rank),
                            )}
                          >
                            <ValueFlash value={rank}>
                              {rank ?? "未上榜"}
                            </ValueFlash>
                          </td>
                        );
                      })}
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
