import { useCallback, useEffect, useState } from "react";
import { storefrontDisplayName, storefrontsForLanguage } from "@appilot-labs/appilot-core/storefronts";
import { formatHumanTime, platformLabel } from "../../lib/format";
import { cn } from "../../lib/utils";
import { btnPrimary, btnSmPrimary, btnSmSecondary } from "../ui/styles";
import { ValueFlash } from "../ui/ValueFlash";
import { KeywordRuby } from "../ui/KeywordRuby";

export function CompetitorPanel({
  projectId,
  product,
  defaultTerm,
  viewLang,
  rankSnapshots,
  projectKeywords,
}: {
  projectId: string;
  product: {
    id?: string;
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
  /** 项目关键词池（用于查找译文标注）。 */
  projectKeywords?: any[];
}) {
  const translationByKey = new Map(
    (projectKeywords || []).map((k: any) => [
      `${k.language}\u0000${k.keyword}`,
      k.translation || "",
    ]),
  );
  const [competitors, setCompetitors] = useState<any[]>([]);
  const [competitorRanks, setCompetitorRanks] = useState<Record<string, any[]>>({});
  const [trackedKeyword, setTrackedKeyword] = useState("");
  const [term, setTerm] = useState(defaultTerm);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [addMessage, setAddMessage] = useState("");
  const [refreshingRanks, setRefreshingRanks] = useState(false);
  const [page, setPage] = useState(0);
  const [searchError, setSearchError] = useState("");
  // 竞品总览（P1/P2：App 为中心的竞争面聚合）。
  const [profiles, setProfiles] = useState<any[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [profilesTick, setProfilesTick] = useState(0);

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
  // 竞品总览：按当前产品（平台）聚合每个竞品的竞争面与竞争指数。
  const loadOverview = useCallback(() => {
    if (!projectId || !product?.id) {
      setProfiles([]);
      return;
    }
    (window as any).appilot?.competitors?.overview(projectId, product.id)
      .then((list: any[]) => setProfiles(list || []))
      .catch(() => setProfiles([]));
  }, [projectId, product?.id]);
  useEffect(() => { loadOverview(); }, [loadOverview, profilesTick]);
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
    setPage(0);
  }, [viewLang, defaultTerm]);

  // 切换语言后，跟踪表默认回到该语言下第一个关联关键词。
  useEffect(() => {
    setTrackedKeyword("");
  }, [viewLang]);

  // 按语言搜索：该语言对应的全部商店。
  const countryOptions = viewLang ? storefrontsForLanguage(viewLang) : ["us"];

  const handleSearch = async () => {
    if (!term.trim()) return;
    setSearching(true);
    setSearchError("");
    setAddMessage("");
    setPage(0);
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
      // 关联搜索框里正在搜索的关键词（用户可能搜了别的词），而不是矩阵选中词。
      const keyword = term.trim();
      const language = viewLang || "en";
      // 搜索结果已带各商店排名：随保存立即回填竞品矩阵，不必等下次抓取。
      const seedRanks = Object.entries(candidate.ranks || {})
        .filter(([, rank]) => typeof rank === "number")
        .map(([storefront, rank]) => ({
          keyword,
          language,
          storefront,
          platform,
          rank: rank as number,
        }));
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
        linkedKeywords: keyword
          ? [{ keyword, language }]
          : [],
        seedRanks,
      });
      setAddMessage(
        res?.merged
          ? "该竞品已存在，已自动关联当前平台版本，排名已按搜索结果回填。"
          : "已添加，排名已按搜索结果回填。",
      );
      await load();
      setProfilesTick((v) => v + 1);
      // 定位到当前关键词，让新竞品行出现在跟踪表里。
      if (keyword) setTrackedKeyword(`${keyword}\u0000${language}`);
    } finally {
      setAdding(null);
    }
  };

  // 当前视图平台：竞品矩阵只看该平台的排名，避免 iOS/macOS 数据混比。
  const viewPlatform: "ios" | "macos" =
    product?.platform === "macos" ? "macos" : "ios";
  const competitorTrackId = (competitor: any, platform: "ios" | "macos"): string | null => {
    const ids = { ...(competitor.trackIds || {}) };
    if (competitor.trackId && competitor.platform === platform) {
      ids[platform] = competitor.trackId;
    }
    return ids[platform] ? String(ids[platform]) : null;
  };

  const appStorePageUrl = (candidate: any) =>
    candidate.trackViewUrl ||
    `https://apps.apple.com/${candidate.country || "us"}/app/id${candidate.trackId}`;

  const handleRemove = async (competitorId: string) => {
    await (window as any).appilot?.competitors?.remove(projectId, competitorId);
    load();
    setProfilesTick((v) => v + 1);
    if (expandedId === competitorId) setExpandedId(null);
  };

  const handleRefreshRanks = async () => {
    if (refreshingRanks) return;
    setRefreshingRanks(true);
    try {
      await (window as any).appilot?.competitors?.refreshRanks(projectId);
      await load();
      setProfilesTick((v) => v + 1);
    } finally {
      setRefreshingRanks(false);
    }
  };

  // 竞品跟踪：按 (平台, 当前语言) 下的关联关键词查看自己与竞品的排名对比。
  const linkedKeywords = Array.from(
    new Map(
      competitors
        // 只统计当前平台已上架竞品关联的关键词：仅在另一平台关联的关键词
        // 不进入本平台的列表，避免出现“没有竞品”的空关键词。
        .filter((c: any) => Boolean(competitorTrackId(c, viewPlatform)))
        .flatMap((c: any) => c.linkedKeywords || [])
        // 只看当前查看语言的关联关键词：切换语言标签后列表随之变化，
        // 因此竞品关键词前面无需再标语言。
        .filter((l: any) => l.language === viewLang)
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
      // 按 (关键词, 语言) 匹配，避免同文本关键词（如 zh-Hans/zh-Hant）
      // 跨语言串数据；旧数据无语言字段时按关键词文本兜底。
      if (
        s.keyword === activeLink.keyword &&
        (s.language == null || s.language === activeLink.language)
      ) {
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
  // 每个关键词最多关联 10 个竞品。
  const MAX_COMPETITORS_PER_KEYWORD = 10;
  const defaultKeyword = term.trim();
  const defaultLinkedCount = competitors.filter((c: any) =>
    (c.linkedKeywords || []).some(
      (l: any) =>
        l.keyword === defaultKeyword && l.language === (viewLang || "en"),
    ),
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
  // “已添加”按 (竞品, 当前关键词) 判定：同一竞品关联了别的关键词时，
  // 仍可把它再关联到当前关键词（跟踪关系按关键词 × 商店组合）。
  const isAddedCandidate = (candidate: any) =>
    competitors.some((c: any) => {
      const ids = [c.trackId, ...Object.values(c.trackIds || {})]
        .filter(Boolean)
        .map(String);
      return (
        ids.includes(String(candidate.trackId)) &&
        (c.linkedKeywords || []).some(
          (l: any) =>
            l.keyword === term.trim() &&
            l.language === (viewLang || "en"),
        )
      );
    });
  const PAGE_SIZE = 12;
  const totalPages = Math.max(1, Math.ceil(candidates.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageCandidates = candidates.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );

  // —— 竞品总览（P2：App 为中心的竞争面）渲染辅助 ——
  const OVERLAP_LABEL: Record<string, string> = {
    both: "正面竞争",
    competitorOnly: "它上榜我未上榜",
    selfOnly: "我上榜它未上榜",
    offChart: "双方 200 外",
    unknown: "未采集",
  };
  const FACE_LANG_LABEL: Record<string, string> = {
    en: "英语", "zh-Hans": "简体中文", "zh-Hant": "繁体中文", ja: "日语", ko: "韩语",
    de: "德语", fr: "法语", es: "西班牙语", pt: "葡萄牙语", ru: "俄语",
  };
  const cellVisual = (own: number | null, theirs: number | null) => {
    if (theirs != null && own != null) {
      if (theirs < own) return { cls: "bg-red-500/15 dark:bg-red-500/20 text-red-700 dark:text-red-300", lead: -1 };
      if (theirs > own) return { cls: "bg-emerald-500/15 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300", lead: 1 };
      return { cls: "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300", lead: 0 };
    }
    if (theirs != null) return { cls: "bg-red-50 dark:bg-red-500/5 text-red-600/70 dark:text-red-300/70", lead: -1 };
    if (own != null) return { cls: "bg-emerald-50 dark:bg-emerald-500/5 text-emerald-600/70 dark:text-emerald-300/70", lead: 1 };
    return { cls: "bg-zinc-50 dark:bg-zinc-800/40 text-zinc-400 dark:text-zinc-500", lead: 0 };
  };
  // 竞争面详情：按语言分组，行 = 关键词，列 = 该语言涉及商店；格 = 我/它名次。
  const renderFacesTable = (intel: any) => {
    const byLang = new Map<string, any[]>();
    for (const face of intel.faces || []) {
      const list = byLang.get(face.language) || [];
      list.push(face);
      byLang.set(face.language, list);
    }
    const langs = [...byLang.keys()].sort((a, b) =>
      (FACE_LANG_LABEL[a] || a).localeCompare(FACE_LANG_LABEL[b] || b, "zh-Hans-CN"),
    );
    return (
      <div className="px-4 py-3 space-y-4 border-t border-zinc-100 dark:border-zinc-800">
        {langs.length === 0 && (
          <p className="text-xs text-zinc-400 dark:text-zinc-500">尚无采集数据（有手动关联的关键词会出现在列表里）。</p>
        )}
        {langs.map((lang) => {
          const faces = byLang.get(lang)!;
          const storefronts = Array.from(
            new Set(faces.flatMap((f) => f.cells.map((c: any) => c.storefront))),
          );
          return (
            <div key={lang}>
              <p className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 mb-1.5">
                {FACE_LANG_LABEL[lang] || lang}
                <span className="font-normal text-zinc-400 dark:text-zinc-500"> · {faces.length} 个词</span>
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-left">
                      <th className="py-1.5 px-2 border border-zinc-200 dark:border-zinc-700 font-medium text-zinc-400">关键词</th>
                      {storefronts.map((sf) => (
                        <th key={sf} className="py-1.5 px-2 border border-zinc-200 dark:border-zinc-700 font-medium text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                          {storefrontDisplayName(sf)}
                        </th>
                      ))}
                      <th className="py-1.5 px-2 border border-zinc-200 dark:border-zinc-700 font-medium text-zinc-400 whitespace-nowrap">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {faces.map((face: any) => {
                      const cellBySf = new Map<string, any>();
                      for (const c of face.cells || []) cellBySf.set(c.storefront, c);
                      return (
                        <tr key={`${face.language}:${face.keyword}`}>
                          <td className="py-1.5 px-2 border border-zinc-200 dark:border-zinc-700 whitespace-nowrap">
                            <span className="font-mono text-zinc-700 dark:text-zinc-200">{face.keyword}</span>
                            {face.longTail && (
                              <span className="ml-1.5 px-1 py-px rounded text-[9px] bg-zinc-100 dark:bg-zinc-800 text-zinc-400">长尾</span>
                            )}
                          </td>
                          {storefronts.map((sf) => {
                            const cell = cellBySf.get(sf);
                            const v = cellVisual(cell?.own ?? null, cell?.theirs ?? null);
                            return (
                              <td key={sf} className="py-1.5 px-2 border border-zinc-200 dark:border-zinc-700 text-center whitespace-nowrap">
                                <span className={cn("inline-block min-w-[3.5rem] px-1 py-0.5 rounded", v.cls)}>
                                  {cell?.theirs != null ? cell.theirs : "—"} / {cell?.own != null ? cell.own : "—"}
                                </span>
                              </td>
                            );
                          })}
                          <td className="py-1.5 px-2 border border-zinc-200 dark:border-zinc-700 whitespace-nowrap text-[11px] text-zinc-500 dark:text-zinc-400">
                            {OVERLAP_LABEL[face.overlap] || face.overlap}
                            {face.contribution > 0 && (
                              <span className="ml-1 text-amber-600 dark:text-amber-400">+{face.contribution}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    );
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

      {profiles.length > 0 && (
        <div className="mb-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              竞品总览
              <span className="ml-2 text-[10px] font-normal text-zinc-400 dark:text-zinc-500">
                按竞争指数排序（权重只看我方名次段 · 分平台 · 长尾词降权） · 点击行展开竞争面
              </span>
            </h3>
            <span className="text-[11px] text-zinc-400">
              当前平台 {platformLabel(viewPlatform)} · 7 天窗口
            </span>
          </div>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {profiles.map(({ competitor, intel }: any) => {
              const expanded = expandedId === competitor.id;
              return (
                <div key={competitor.id}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : competitor.id)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors"
                  >
                    <span className="flex-1 min-w-0 flex items-center gap-2">
                      <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate hover:underline">
                        {competitor.name}
                      </span>
                      <span className="flex gap-0.5 shrink-0">
                        {(["ios", "macos"] as const).map((p) => (
                          <span
                            key={p}
                            className={cn(
                              "px-1 py-px rounded text-[9px] font-medium leading-none",
                              competitorTrackId(competitor, p)
                                ? "bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600",
                            )}
                          >
                            {p === "macos" ? "macOS" : "iOS"}
                          </span>
                        ))}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] text-zinc-500 dark:text-zinc-400 w-16 text-right">
                      重叠 <b className="text-zinc-700 dark:text-zinc-200">{intel.faceCount}</b>
                    </span>
                    <span className="shrink-0 text-[11px] text-zinc-500 dark:text-zinc-400 w-14 text-right">
                      压我 <b className="text-red-600 dark:text-red-400">{intel.pressuredCount}</b>
                    </span>
                    <span className="shrink-0 text-[11px] text-zinc-500 dark:text-zinc-400 w-14 text-right">
                      在榜 <b className="text-zinc-700 dark:text-zinc-200">{intel.theirOnChart}</b>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 w-16 text-right text-sm font-bold",
                        intel.index > 0
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-zinc-400 dark:text-zinc-500",
                      )}
                    >
                      {intel.index}
                    </span>
                    <span className="shrink-0 text-zinc-400 dark:text-zinc-500 text-xs w-4 text-center">
                      {expanded ? "▲" : "▼"}
                    </span>
                  </button>
                  {expanded && renderFacesTable(intel)}
                </div>
              );
            })}
          </div>
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
              当前平台没有已上架竞品关联的关键词。添加竞品时使用搜索关键词关联，排名随关键词抓取采集。
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
            return (
            <div className="p-4">
              <div className="flex flex-wrap gap-1.5 mb-3">
              {linkedKeywords.map((link: any) => (
                <button
                  key={`${link.keyword}\u0000${link.language}`}
                  type="button"
                  onClick={() => {
                    setTrackedKeyword(`${link.keyword}\u0000${link.language}`);
                    // 同步搜索框关键词，方便立即在竞品雷达中搜索该关键词。
                    setTerm(link.keyword);
                  }}
                  className={cn(
                    "px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors",
                    activeLink.keyword === link.keyword && activeLink.language === link.language
                      ? "border-amber-500 ring-2 ring-amber-500/20 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400"
                      : "border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-amber-500/50",
                  )}
                >
                  <KeywordRuby
                    keyword={link.keyword}
                    translation={translationByKey.get(
                      `${link.language}\u0000${link.keyword}`,
                    )}
                    annotate={
                      link.language !== "zh-Hans" && link.language !== "zh-Hant"
                    }
                    chip={false}
                  />
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
