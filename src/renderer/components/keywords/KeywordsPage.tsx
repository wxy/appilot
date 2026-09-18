import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { storefrontDisplayName, storefrontsForLanguage } from "@appilot-labs/appilot-core/storefronts";
import { rankBudgetAdmissible, rankBudgetStatus } from "@appilot-labs/appilot-core/rank-budget";
import { languageLabel, platformLabel, UI_SOURCE_LANGUAGE } from "../../lib/format";
import {
  buildCellIndex,
  matrixColumnMeta,
  matrixFilterKeywords,
  matrixRowGroups,
  trackingLanguageOptions,
  type MatrixCell,
} from "../../lib/matrix";
import { cn } from "../../lib/utils";
import { useProject } from "../../stores/project";
import { AIProgressButton } from "../ui/AIProgressButton";
import { EmptyState } from "../ui/EmptyState";
import { btnPrimary, btnSecondary } from "../ui/styles";
import { CurationDialog, type CurationResolved } from "./CurationDialog";
import type { KeywordSuggestion } from "./keywordTypes";
import { MatrixCellView, RankTooltip } from "./matrix";
import { CompetitorPanel } from "./CompetitorPanel";
import { KeywordRuby } from "../ui/KeywordRuby";

/** 组包络带（P25–P75）的参与关键词数下限：某商店某天在榜词数低于此值即视为“无组数据日”
 *（由前后真实日连接）。取 2 而非更高，避免稀疏商店（每天仅 1–2 个词在榜）整条带不显示。 */
const GROUP_BAND_MIN_N = 2;
/** 多词对比模式的曲线上限：调色板恰好 6 色，再多曲线互相覆盖且无法辨色。 */
const MAX_COMPARE_WORDS = 6;
/** 某商店要画整组带，至少需要有这么多“真实带日”（当天在榜词 ≥ GROUP_BAND_MIN_N）。
 * 避免整组几乎不进前 200 的商店，因孤立的 1–2 天数据被“连接/延展”成贯穿全图的假带。 */
const GROUP_BAND_MIN_DAYS = 3;

/** 升序数组的线性插值分位（p ∈ [0,1]）。 */
function percentileOf(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
}

/** 本地日历日键（与趋势图按本地小时分桶保持同一时区口径）。 */
function localDayKey(iso: string): string {
  const d = new Date(iso);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dd}`;
}

/** 未在榜批量删除的勾选 key。 */
const selKey = (language: string, keyword: string) => `${language}\u0000${keyword}`;

export function KeywordsPage() {
  const { projects, currentProjectId, currentProductId, updateTrackedKeywords, removeTrackedKeyword, removeTrackedKeywords, restoreTrackedKeyword, resumePausedKeyword, clearRemovedKeywords } = useProject();
  const project = projects.find((p) => p.id === currentProjectId);
  const product = project?.storeProducts?.find((item) => item.id === currentProductId) || project?.storeProducts?.[0] || null;
  const [litLangs, setLitLangs] = useState<string[]>(() => {
    const supported = (product?.supportedLanguages || []).map((l) => l.code);
    const initial: string[] = [];
    if (supported.includes(UI_SOURCE_LANGUAGE)) initial.push(UI_SOURCE_LANGUAGE);
    else if (supported[0]) initial.push(supported[0]);
    initial.push("en");
    return initial;
  });
  const [curation, setCuration] = useState<Record<string, {
    removals: { keyword: string; reason: string; translation?: string }[];
    adds: KeywordSuggestion[];
  }>>({});
  const [curationOpen, setCurationOpen] = useState(false);
  const [curationConfirm, setCurationConfirm] = useState<null | "apply" | "discard">(null);
  const [submissionRef, setSubmissionRef] = useState<{
    name: string;
    subtitle: string;
    submissionKeywords: string;
  } | null>(null);
  const [submissionPanelOpen, setSubmissionPanelOpen] = useState(false);
  const [candidates, setCandidates] = useState<
    { keyword: string; source: "submission" | "name" | "subtitle"; rationale: string }[]
  >([]);
  const [removedCandidateKeys, setRemovedCandidateKeys] = useState<Set<string>>(new Set());
  const [submissionProgress, setSubmissionProgress] = useState<{
    chars: number;
    phase: "reasoning" | "content";
  } | null>(null);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesOpId, setCandidatesOpId] = useState("");
  const [candidatesFailed, setCandidatesFailed] = useState(false);
  const [candidatesAdding, setCandidatesAdding] = useState(false);
  const [viewLang, setViewLang] = useState<string>("");
  const [loadingLangs, setLoadingLangs] = useState<Set<string>>(new Set());
  const [keywordProgress, setKeywordProgress] = useState<
    Record<string, { chars: number; phase: "reasoning" | "content" }>
  >({});
  // 批量生成/整理的整体进度：母本(en) → 各语言本地化/整理，全部结果进建议弹窗。
  const [batch, setBatch] = useState<{
    total: number;
    index: number;
    lang: string;
    stage: "generate" | "localize" | "curate";
    opId: string;
    status: Record<string, "running" | "done" | "failed">;
  } | null>(null);
  const [showPaused, setShowPaused] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [showPendingReview, setShowPendingReview] = useState(false);
  const [pendingEntries, setPendingEntries] = useState<any[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingActing, setPendingActing] = useState<string | null>(null);
  const [translatingKey, setTranslatingKey] = useState<string | null>(null);
  const [translatingAll, setTranslatingAll] = useState(false);
  const [translateProgress, setTranslateProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [matrixTab, setMatrixTab] = useState<"ranked" | "unranked">("ranked");
  // 页面二级标签：关键词矩阵 | 竞品 | 排名分布（分布为整体视角，独立于各卡片）。
  const [pageTab, setPageTab] = useState<"keywords" | "competitor" | "distribution">("keywords");
  const pausedPopoverRef = useRef<HTMLSpanElement>(null);

  // 已暂停气泡：点外部任意处收起。「已删除」是页面级模态，由遮罩点击自行关闭。
  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!(pausedPopoverRef.current?.contains(target) ?? false)) {
        setShowPaused(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);
  const [error, setError] = useState("");
  const [selectedKeyword, setSelectedKeyword] = useState<string>("");
  // 行勾选（在榜/未在榜都可勾选后批量删除）：key = language:keyword。
  const [rowSelected, setRowSelected] = useState<Set<string>>(new Set());
  const [schedulerStatus, setSchedulerStatus] = useState<{ enabled: boolean; total: number; due: number; failed: number; nextDueAt: string | null } | null>(null);
  const [runningDue, setRunningDue] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const urlKeyword = searchParams.get("keyword") || "";
  const urlLang = searchParams.get("lang") || "";
  const urlScope = searchParams.get("scope") || "";

  const languages = product?.supportedLanguages || [];
  const languageOptions = trackingLanguageOptions(languages);
  // 全局卡 = 英文（en）关键词唯一的家：没有独立的“英语”语言卡，任何落到 en 的
  // 视图（初始点亮语言、深链 lang=en）都归一到全局卡片；语言卡只显示本语言关键词。
  const rawViewLang = viewLang || litLangs[0] || "";
  const isGlobalView = rawViewLang === "global" || rawViewLang === "en";

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      (window as any).appilot?.scheduler?.status()
        .then((status: any) => {
          if (!cancelled) setSchedulerStatus(status);
        })
        .catch(() => {
          if (!cancelled) setSchedulerStatus(null);
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const handleRunDue = async () => {
    if (runningDue) return;
    setRunningDue(true);
    try {
      await (window as any).appilot?.scheduler?.runDue();
    } catch {
      // The periodic status refresh will still surface the scheduler state.
    } finally {
      setRunningDue(false);
      try {
        const status = await (window as any).appilot?.scheduler?.status();
        setSchedulerStatus(status || null);
      } catch {
        // Keep the last known status.
      }
    }
  };

  useEffect(() => {
    const off = (window as any).appilot?.projects?.onKeywordProgress?.((progress: any) => {
      if (progress?.language && typeof progress.chars === "number") {
        setKeywordProgress((prev) => ({
          ...prev,
          [progress.language]: {
            chars: progress.chars,
            phase: progress.phase === "content" ? "content" : "reasoning",
          },
        }));
      }
    });
    return () => {
      off?.();
    };
  }, []);

  useEffect(() => {
    const off = (window as any).appilot?.projects?.onSubmissionProgress?.((progress: any) => {
      if (typeof progress?.chars === "number") {
        setSubmissionProgress({
          chars: progress.chars,
          phase: progress.phase === "content" ? "content" : "reasoning",
        });
      }
    });
    return () => {
      off?.();
    };
  }, []);

  const toggleLitLang = (code: string) => {
    setLitLangs((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  };

  // Apply navigation params from the overview page: locate a keyword in a
  // language view, and/or narrow the matrix scope.
  useEffect(() => {
    if (!product) return;
    // 深链 lang=en 没有对应语言卡，归一到全局卡片。
    if (urlLang === "en") {
      setViewLang("global");
    } else if (urlLang && languageOptions.some((option) => option.code === urlLang)) {
      setViewLang(urlLang);
    }
    if (urlKeyword) {
      setSelectedKeyword(urlKeyword);
      requestAnimationFrame(() => {
        document
          .querySelector(
            `[data-keyword="${CSS.escape(urlKeyword)}"][data-language="${CSS.escape(urlLang || "")}"]`,
          )
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    }
    if (urlScope === "paused") {
      setShowPaused(true);
    }
  }, [product?.id, urlKeyword, urlLang, urlScope]);

  if (!project || !product) {
    return <EmptyState title="还没有项目" desc="添加一个项目后，这里会展示关键词。" />;
  }

  const currentLang = isGlobalView ? "en" : rawViewLang;
  // 每张卡只查自己的语言：全局卡 = en（× 全部商店）；语言卡 = 该语言（× 该语言商店）。
  // en 全局词不再跟随语言卡查询——它们只在全局卡出现。
  const queryLanguages = [currentLang];
  // —— 派生链全部 memo 化：勾选/切标签只改轻量状态，不应重扫全量排名快照 ——
  const tracked = useMemo(
    () => (project.trackedKeywords || []).filter((k) => queryLanguages.includes(k.language)),
    [project.trackedKeywords, currentLang],
  );
  const trackedActive = useMemo(() => tracked.filter((k) => k.status !== "paused"), [tracked]);
  const pausedForCurrent = useMemo(
    () =>
      tracked.filter(
        (k) => k.status === "paused" || (k.pausedPlatforms || []).includes(product.platform),
      ),
    [tracked, product.platform],
  );
  const pendingForCurrent = useMemo(
    () => tracked.filter((k) => (k.pendingPausePlatforms || []).includes(product.platform)),
    [tracked, product.platform],
  );
  const missingTranslationCount = (project.trackedKeywords || []).filter(
    (k) =>
      k.language !== "zh-Hans" &&
      k.language !== "zh-Hant" &&
      !(k.translation && String(k.translation).trim()),
  ).length;
  const removedForCurrent = useMemo(
    () => (project.removedKeywords || []).filter((item) => queryLanguages.includes(item.language)),
    [project.removedKeywords, currentLang],
  );
  // 采集预算：任务量 = 活跃关键词 × 语言覆盖的商店数（en 全局词按全部本地化计）。
  // 建议采纳 / 候选加入 / 恢复暂停词都会受硬上限约束，软上限起提示作用。
  const rankBudget = rankBudgetStatus(
    product.supportedLanguages || [],
    product.platform,
    project.trackedKeywords || [],
  );
  // 产品全部本地化覆盖的商店（去重）：全局卡列序与分布页签共用。
  const productStorefronts = useMemo(
    () =>
      Array.from(
        new Set(
          (product?.supportedLanguages || []).flatMap((lang) =>
            storefrontsForLanguage(lang.code),
          ),
        ),
      ),
    [product],
  );
  const enStorefronts = useMemo(() => new Set(storefrontsForLanguage("en")), []);
  const storefronts = useMemo(
    () =>
      isGlobalView
        ? [
            ...productStorefronts.filter((storefront) => enStorefronts.has(storefront)),
            ...productStorefronts.filter((storefront) => !enStorefronts.has(storefront)),
          ]
        : storefrontsForLanguage(currentLang),
    [isGlobalView, currentLang, productStorefronts, enStorefronts],
  );
  // 全局卡表头分组（相邻同组合并）：英语商店 | 其他语言商店。
  const globalColumnGroups = useMemo(() => {
    if (!isGlobalView) return [];
    const groups: { label: string; span: number }[] = [];
    for (const storefront of storefronts) {
      const label = enStorefronts.has(storefront) ? "英语商店" : "其他语言商店";
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.span += 1;
      else groups.push({ label, span: 1 });
    }
    return groups;
  }, [isGlobalView, storefronts, enStorefronts]);
  // 快照索引：一次 O(快照数) 预计算每格 cell，渲染期 O(1) 查询（matrixCellState
  // 每次全量过滤快照，行×列 次调用在快照上万后是纯卡顿来源）。
  const rankSnapshots = useMemo(() => product.rankSnapshots || [], [product]);
  const cellIndex = useMemo(() => buildCellIndex(rankSnapshots), [rankSnapshots]);
  const matrixRows = useMemo(
    () => matrixFilterKeywords(trackedActive, currentLang),
    [trackedActive, currentLang],
  );
  const matrixColumns = useMemo(
    () =>
      storefronts.map((storefront) => ({
        storefront,
        meta: matrixColumnMeta(rankSnapshots, storefront),
      })),
    [storefronts, rankSnapshots],
  );
  const storeGridTemplate = `repeat(${matrixColumns.length}, 88px)`;
  const RANK_BUCKETS = [
    { key: "top10", label: "TOP10", color: "#15803d", opacity: 1 },
    { key: "r11_50", label: "11–50", color: "#22c55e", opacity: 0.9 },
    { key: "r51_100", label: "51–100", color: "#a3e635", opacity: 0.75 },
    { key: "r101_200", label: "101–200", color: "#facc15", opacity: 0.6 },
    { key: "unranked", label: "未进榜", color: "#a1a1aa", opacity: 0.35 },
  ] as const;
  const DistributionTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow px-3 py-2 text-xs">
        <p className="font-medium mb-1">{label}</p>
        {RANK_BUCKETS.map((bucket) => {
          const item = payload.find((p: any) => p.dataKey === bucket.key);
          return (
            <div key={bucket.key} className="flex items-center gap-2 py-0.5">
              <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: bucket.color }} />
              <span className="text-zinc-600 dark:text-zinc-300">{bucket.label}</span>
              <span className="ml-auto pl-3 font-medium text-zinc-800 dark:text-zinc-100">
                {item?.value ?? 0}
              </span>
            </div>
          );
        })}
      </div>
    );
  };
  // 分布是独立「分布」页签的整体视角：全部语言的关键词 × 全部商店，与当前卡片无关。
  // 平台暂停的关键词（pausedPlatforms 含当前产品平台）不计入分布，避免
  // 把“未采集”虚构成“未进榜”。仅在该页签激活时计算（逐格查快照较重）。
  const distributionKeywords = useMemo(
    () =>
      (project.trackedKeywords || []).filter(
        (k: any) =>
          k.status !== "paused" &&
          !(k.pausedPlatforms || []).includes(product.platform),
      ),
    [project.trackedKeywords, product.platform],
  );
  const distributionData: {
    storefront: string;
    top10: number;
    r11_50: number;
    r51_100: number;
    r101_200: number;
    unranked: number;
  }[] = useMemo(() => {
    if (pageTab !== "distribution") return [];
    return productStorefronts
        .map((storefront) => {
          const buckets: Record<string, number> = {
            top10: 0,
            r11_50: 0,
            r51_100: 0,
            r101_200: 0,
            unranked: 0,
          };
          for (const row of distributionKeywords) {
            const cell = cellIndex(row.keyword, storefront);
            const rank = cell.rank;
            if (rank == null || cell.beyond200) buckets.unranked += 1;
            else if (rank <= 10) buckets.top10 += 1;
            else if (rank <= 50) buckets.r11_50 += 1;
            else if (rank <= 100) buckets.r51_100 += 1;
            else buckets.r101_200 += 1;
          }
          return {
            storefront: storefrontDisplayName(storefront),
            top10: buckets.top10,
            r11_50: buckets.r11_50,
            r51_100: buckets.r51_100,
            r101_200: buckets.r101_200,
            unranked: buckets.unranked,
          };
        })
        .sort(
          (a, b) =>
            (b.top10 * 100 + b.r11_50 * 50 + b.r51_100 * 20 + b.r101_200 * 5) -
            (a.top10 * 100 + a.r11_50 * 50 + a.r51_100 * 20 + a.r101_200 * 5),
        );
  }, [pageTab, productStorefronts, distributionKeywords, cellIndex]);
  const { ranked, unranked } = useMemo(
    () => matrixRowGroups(matrixRows, matrixColumns, cellIndex),
    [matrixRows, matrixColumns, cellIndex],
  );
  const scopeFilteredRanked =
    urlScope === "top10" ? ranked.filter((item) => item.bestRank <= 10) : ranked;
  const showUnrankedRows =
    matrixTab === "unranked" ||
    (matrixTab === "ranked" && !urlScope && scopeFilteredRanked.length === 0);
  const activeMatrixTab = showUnrankedRows ? "unranked" : matrixTab;
  // 行勾选/批量删除：对当前标签页（在榜或未在榜）的可见行生效，跨语言视图自然隔离。
  const visibleRows = showUnrankedRows
    ? unranked
    : scopeFilteredRanked.map((item) => item.row);
  const selectedVisibleRows = visibleRows.filter((k: any) =>
    rowSelected.has(selKey(k.language, k.keyword)),
  );
  const allRowsSelected =
    visibleRows.length > 0 && selectedVisibleRows.length === visibleRows.length;
  // 勾选的词（当前卡片内）：按最优名次排序。≥2 个 → 趋势图进入对比模式，
  // 每词一条曲线（当日跨店最优名次，与在榜判定同口径）。
  const checkedRows = useMemo(() => {
    const bestByKey = new Map(
      ranked.map((item) => [`${item.row.language}\u0000${item.row.keyword}`, item.bestRank] as const),
    );
    return trackedActive
      .filter((k) => rowSelected.has(selKey(k.language, k.keyword)))
      .map((k) => ({
        ...k,
        bestRank: bestByKey.get(`${k.language}\u0000${k.keyword}`) ?? null,
      }))
      .sort((a, b) => (a.bestRank ?? Infinity) - (b.bestRank ?? Infinity));
  }, [ranked, trackedActive, rowSelected]);
  const compareMode = checkedRows.length >= 2;
  // 对比模式最多取最优前 MAX_COMPARE_WORDS 个：调色板 6 色，再多互相覆盖且无法辨色。
  const comparedKeywords = useMemo(
    () => checkedRows.slice(0, MAX_COMPARE_WORDS),
    [checkedRows],
  );
  const chartKeyword =
    checkedRows.length === 1
      ? checkedRows[0].keyword
      : matrixRows.some((keyword) => keyword.keyword === selectedKeyword)
        ? selectedKeyword
        : (ranked[0]?.row.keyword || trackedActive[0]?.keyword || "");
  const chartKeywordMeta = matrixRows.find(
    (keyword) => keyword.keyword === chartKeyword,
  );
  const chartSnapshots = useMemo(
    () =>
      rankSnapshots
        .filter(
          (snapshot) =>
            snapshot.language === currentLang &&
            storefronts.includes(snapshot.storefront) &&
            snapshot.keyword === chartKeyword,
        )
        .sort((a, b) => new Date(a.checkedAt).getTime() - new Date(b.checkedAt).getTime()),
    [rankSnapshots, currentLang, storefronts, chartKeyword],
  );
  const chartSeriesMeta = useMemo(
    () =>
      Array.from(
        new Map(chartSnapshots.map((s) => [s.storefront, s.storefront])).keys(),
      ).map((storefront) => ({ storefront, label: storefrontDisplayName(storefront) })),
    [chartSnapshots],
  );
  // 组关键词 = 当前卡片矩阵里全部可见的激活关键词（全局卡 = en 词；语言卡 = 该语言词）。
  // 带按 (语言 × 商店) 分别绘制：每个商店（如 中国大陆/新加坡）各自一条带，
  // 只统计本卡语言的关键词在该商店的快照；其他语言的关键词与本卡的带无关。
  const groupBandKeywords = useMemo(
    () => Array.from(new Set(matrixRows.map((row) => row.keyword))),
    [matrixRows],
  );
  // 时间轴 = 按天（与组快照粒度一致）：行覆盖「组数据活动日 ∪ 选中词采样日」的连续日期。
  // 带挂在固定日期轴上，与选中哪个词无关：切换关键词只改变曲线取值，带的形状保持不变。
  // 带 = 该商店整组关键词当天的 P25–P75：每词每天取最后一次在榜快照；未进榜（>200 / null）
  // 与当天未检查的词不参与；当天在榜词 < GROUP_BAND_MIN_N 视为无组数据，用前后真实日连接。
  const chartData = useMemo(() => {
    const groupSet = new Set(groupBandKeywords);
    const storefrontSet = new Set(storefronts);

    // (商店 × 天 × 词) → 当天最后一次快照名次（null = 未进榜）
    const latestRank = new Map<string, number | null>();
    const latestMs = new Map<string, number>();
    for (const snapshot of rankSnapshots) {
      if (!groupSet.has(snapshot.keyword)) continue;
      if (snapshot.language !== currentLang) continue;
      if (!storefrontSet.has(snapshot.storefront)) continue;
      const key = `${snapshot.storefront}\u0000${localDayKey(snapshot.checkedAt)}\u0000${snapshot.keyword}`;
      const ms = new Date(snapshot.checkedAt).getTime();
      if ((latestMs.get(key) ?? -1) < ms) {
        latestMs.set(key, ms);
        latestRank.set(key, snapshot.rank ?? null);
      }
    }
    // (商店 × 天) → 在榜名次集合 + 覆盖统计（当天被检查的词数 / 其中在榜词数；
    // 未进榜（rank 为 null / >200）计入 checked 但不参与名次集合）
    const dayRanks = new Map<string, Map<string, number[]>>();
    const covBySfDay = new Map<string, Map<string, { checked: number; ranked: number }>>();
    for (const [key, rank] of latestRank) {
      const [sf, day] = key.split("\u0000");
      let cm = covBySfDay.get(sf);
      if (!cm) {
        cm = new Map();
        covBySfDay.set(sf, cm);
      }
      let cov = cm.get(day);
      if (!cov) {
        cov = { checked: 0, ranked: 0 };
        cm.set(day, cov);
      }
      cov.checked += 1;
      if (rank == null || rank > 200) continue;
      cov.ranked += 1;
      let m = dayRanks.get(sf);
      if (!m) {
        m = new Map();
        dayRanks.set(sf, m);
      }
      let arr = m.get(day);
      if (!arr) {
        arr = [];
        m.set(day, arr);
      }
      arr.push(rank);
    }
    for (const m of dayRanks.values()) for (const arr of m.values()) arr.sort((a, b) => a - b);
    // 各商店“真实带日”（在榜词数达标）及当天 P25–P75；真实带日不足 GROUP_BAND_MIN_DAYS 的
    // 商店视为“整组基本未进榜”，不画带（realBySf 不收录）
    const realBySf = new Map<string, { day: string; p25: number; p75: number }[]>();
    for (const [sf, m] of dayRanks) {
      const list: { day: string; p25: number; p75: number }[] = [];
      for (const [day, arr] of m) {
        if (arr.length >= GROUP_BAND_MIN_N) {
          list.push({ day, p25: percentileOf(arr, 0.25), p75: percentileOf(arr, 0.75) });
        }
      }
      if (list.length >= GROUP_BAND_MIN_DAYS) {
        list.sort((a, b) => (a.day < b.day ? -1 : 1));
        realBySf.set(sf, list);
      }
    }
    // 选中关键词：每 (商店 × 天) 取当天最后一次在榜名次（chartSnapshots 已按时间升序）
    const kwLatest = new Map<string, number>();
    for (const s of chartSnapshots) {
      if (s.rank == null) continue;
      kwLatest.set(`${s.storefront}\u0000${localDayKey(s.checkedAt)}`, s.rank);
    }
    // 日期范围：出现该关键词的商店的“组活动日（≥1 在榜词）”与选中词采样日并集，取最小~最大
    const daySet = new Set<string>();
    for (const [sf, m] of dayRanks) {
      if (!chartSeriesMeta.some((meta) => meta.storefront === sf)) continue;
      for (const day of m.keys()) daySet.add(day);
    }
    for (const key of kwLatest.keys()) daySet.add(key.split("\u0000")[1]);
    if (daySet.size === 0) return [];
    const sortedDays = [...daySet].sort();
    // 生成最小~最大之间的连续日（本地日历日，逐日 +1 避免时区/夏令时误差）
    const rows: Record<string, any>[] = [];
    {
      const cur = new Date(`${sortedDays[0]}T00:00:00`);
      const last = sortedDays[sortedDays.length - 1];
      for (;;) {
        const iso = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate()).toISOString();
        rows.push({ time: iso });
        if (localDayKey(iso) >= last) break;
        cur.setDate(cur.getDate() + 1);
      }
    }
    // 逐商店逐天铺数据：曲线值 + 带值（真实 / 覆盖范围内内插；范围外不画）
    for (const meta of chartSeriesMeta) {
      const sf = meta.storefront;
      const real = realBySf.get(sf);
      const dayRanksSf = dayRanks.get(sf);
      for (const row of rows) {
        const day = localDayKey(row.time);
        const kwRank = kwLatest.get(`${sf}\u0000${day}`);
        if (kwRank != null) row[sf] = kwRank; // 选中词该天最后一条在榜名次
        // 覆盖统计：当天整组被检查 X 词、其中在榜 Y 词（明示带只覆盖在榜部分）
        const cov = covBySfDay.get(sf)?.get(day);
        if (cov) {
          row[`${sf}:nRanked`] = cov.ranked;
          row[`${sf}:nChecked`] = cov.checked;
        }
        if (!real) continue; // 该商店整组从未达标：该商店不画带
        const arr = dayRanksSf?.get(day);
        if (arr && arr.length >= GROUP_BAND_MIN_N) {
          row[`${sf}:p25`] = percentileOf(arr, 0.25);
          row[`${sf}:p75`] = percentileOf(arr, 0.75);
          continue;
        }
        // 无组数据：仅在首个~末个真实带日之间用前后真实日线性内插；
        // 超出真实带覆盖范围的天不画带（避免把孤立的 1–2 天数据延展成贯穿全图的假带）
        if (day < real[0].day || day > real[real.length - 1].day) continue;
        let left: { day: string; p25: number; p75: number } | undefined;
        let right: { day: string; p25: number; p75: number } | undefined;
        for (const rd of real) {
          if (rd.day < day) left = rd;
          else {
            right = rd;
            break;
          }
        }
        if (!left || !right) continue;
        const t0 = new Date(`${left.day}T00:00:00`).getTime();
        const total = new Date(`${right.day}T00:00:00`).getTime() - t0;
        const f = total > 0 ? (new Date(`${day}T00:00:00`).getTime() - t0) / total : 0;
        row[`${sf}:p25`] = left.p25 + (right.p25 - left.p25) * f;
        row[`${sf}:p75`] = left.p75 + (right.p75 - left.p75) * f;
      }
    }
    return rows;
  }, [chartKeyword, groupBandKeywords, chartSnapshots, storefronts, currentLang, rankSnapshots]);
  // 覆盖提示：该商店最终没有绘制整组带（整组极少同日有多词进前 200）→ 图例处提示
  const noBandStorefronts = chartSeriesMeta.filter(
    (meta) => !chartData.some((row) => row[`${meta.storefront}:p25`] != null),
  );
  const CHART_COLORS = ["#f59e0b", "#3b82f6", "#10b981", "#8b5cf6", "#ef4444", "#06b6d4"];
  const chartMaxRank = chartData.reduce((max, row) => {
    for (const [key, value] of Object.entries(row)) {
      if (key !== "time" && typeof value === "number" && value > max) max = value;
    }
    return max;
  }, 1);
  const chartStep = Math.max(1, Math.ceil(chartMaxRank / 5));
  const chartTicks: number[] = [];
  for (let rank = 1; rank <= chartMaxRank; rank += chartStep) chartTicks.push(rank);
  if (chartTicks[chartTicks.length - 1] !== chartMaxRank) chartTicks.push(chartMaxRank);

  // 多词对比模式数据：每词一条曲线 = 该词当日在这张卡全部商店中的最优名次。
  // 一次快照扫描建 (日 × 词) → 最优名次，日轴连续（无数据日断点由 connectNulls 连接）。
  const compareChart = useMemo(() => {
    if (!compareMode) return { rows: [] as Record<string, any>[], words: [] as string[] };
    const words = comparedKeywords.map((k) => k.keyword);
    const wordSet = new Set(words);
    const best = new Map<string, Map<string, number>>();
    for (const snapshot of rankSnapshots) {
      if (!wordSet.has(snapshot.keyword)) continue;
      if (snapshot.language !== currentLang) continue;
      if (!storefronts.includes(snapshot.storefront)) continue;
      if (snapshot.rank == null || snapshot.rank > 200) continue;
      const day = localDayKey(snapshot.checkedAt);
      let perWord = best.get(day);
      if (!perWord) {
        perWord = new Map();
        best.set(day, perWord);
      }
      const prev = perWord.get(snapshot.keyword);
      if (prev == null || snapshot.rank < prev) perWord.set(snapshot.keyword, snapshot.rank);
    }
    if (best.size === 0) return { rows: [] as Record<string, any>[], words };
    const sortedDays = [...best.keys()].sort();
    const rows: Record<string, any>[] = [];
    const cursor = new Date(`${sortedDays[0]}T00:00:00`);
    const last = sortedDays[sortedDays.length - 1];
    for (;;) {
      const dayIso = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()).toISOString();
      const day = localDayKey(dayIso);
      const row: Record<string, any> = { time: dayIso };
      const perWord = best.get(day);
      for (const word of words) row[word] = perWord?.get(word) ?? null;
      rows.push(row);
      if (day >= last) break;
      cursor.setDate(cursor.getDate() + 1);
    }
    return { rows, words };
  }, [compareMode, comparedKeywords, rankSnapshots, currentLang, storefronts]);
  const compareMaxRank = compareChart.rows.reduce((max, row) => {
    for (const word of compareChart.words) {
      const value = row[word];
      if (typeof value === "number" && value > max) max = value;
    }
    return max;
  }, 1);
  const compareStep = Math.max(1, Math.ceil(compareMaxRank / 5));
  const compareTicks: number[] = [];
  for (let rank = 1; rank <= compareMaxRank; rank += compareStep) compareTicks.push(rank);
  if (compareTicks[compareTicks.length - 1] !== compareMaxRank) compareTicks.push(compareMaxRank);

  const formatColumnTime = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  // 批量进行中按钮显示整体进度：字符数跨语言累计（各语言流各自累加，总和单调递增），
  // 不再跟随当前查看的语言 —— 之前显示 currentLang 的流，跑到后面的语言时数字就“冻结”了。
  const batchTotalChars = Object.values(keywordProgress).reduce(
    (sum, p) => sum + (p?.chars || 0),
    0,
  );
  const activeProgress = batch
    ? {
        chars: batchTotalChars,
        phase: (keywordProgress[batch.lang]?.phase === "content"
          ? "content"
          : "reasoning") as "reasoning" | "content",
      }
    : keywordProgress[currentLang] || null;
  const STAGE_LABELS: Record<string, string> = {
    generate: "生成母本",
    localize: "本地化",
    curate: "整理",
  };
  const batchStatusLabel = batch
    ? `${STAGE_LABELS[batch.stage]} ${languageLabel(batch.lang)} · ${batch.index + 1}/${batch.total}`
    : undefined;
  const trackedCandidateKeywords = new Set(
    (project.trackedKeywords || [])
      .filter((k) => k.language === currentLang)
      .map((k) => k.keyword),
  );
  const pendingCandidateCount = new Set(
    candidates
      .filter((candidate) => {
        const key = `${candidate.source}\u0000${candidate.keyword}`;
        return !removedCandidateKeys.has(key) && !trackedCandidateKeywords.has(candidate.keyword);
      })
      .map((candidate) => candidate.keyword),
  ).size;
  const cellTitle = (cell: MatrixCell) =>
    cell.checkedAt
      ? `最近查询 ${new Date(cell.checkedAt).toLocaleString()} · 结果量 ${cell.totalResults ?? "—"}`
      : "尚未查询";

  const handleSelectKeyword = (keyword: (typeof matrixRows)[number]) => {
    setSelectedKeyword(keyword.keyword);
    const next = new URLSearchParams(searchParams);
    next.set("keyword", keyword.keyword);
    next.set("lang", currentLang);
    setSearchParams(next, { replace: true });
  };

  const renderLeftCell = (
    keyword: (typeof matrixRows)[number],
    dimmed: boolean,
    applied?: "add" | "remove" | null,
  ) => (
    <div
      key={`${keyword.language}:${keyword.keyword}`}
      data-keyword={keyword.keyword}
      data-language={keyword.language}
      onClick={() => handleSelectKeyword(keyword)}
      className={cn(
        "h-11 flex items-center gap-2 px-4 border-b border-zinc-100 dark:border-zinc-800 last:border-b-0 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors min-w-0",
        dimmed && "opacity-55",
        !dimmed && "bg-emerald-50/30 dark:bg-emerald-500/[0.04]",
        keyword.keyword === chartKeyword && "bg-amber-50/40 dark:bg-amber-500/5",
      )}
    >
      <input
        type="checkbox"
        checked={rowSelected.has(selKey(keyword.language, keyword.keyword))}
        onChange={(e) => {
          e.stopPropagation();
          toggleRowSel(keyword.language, keyword.keyword);
        }}
        onClick={(e) => e.stopPropagation()}
        className="shrink-0 accent-amber-500"
        title="勾选后可在顶部批量删除"
      />
      <span
        className={cn(
          "font-mono text-sm truncate whitespace-nowrap min-w-0",
          dimmed ? "text-zinc-400 dark:text-zinc-500" : "text-zinc-800 dark:text-zinc-200",
          applied === "remove" && "line-through",
        )}
        title={keyword.rationale ? `${keyword.keyword} — ${keyword.rationale}` : keyword.keyword}
      >
        <KeywordRuby
          keyword={keyword.keyword}
          translation={keyword.translation}
          annotate={
            keyword.language !== "zh-Hans" && keyword.language !== "zh-Hant"
          }
        />
        {keyword.source === "submission" && (
          <span className="ml-1.5 inline-flex px-1.5 py-0.5 rounded-full bg-sky-100 dark:bg-sky-500/15 text-[10px] font-sans font-medium text-sky-600 dark:text-sky-400 align-middle">
            商店
          </span>
        )}
        {keyword.source === "name" && (
          <span className="ml-1.5 inline-flex px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-500/15 text-[10px] font-sans font-medium text-violet-600 dark:text-violet-400 align-middle">
            名称
          </span>
        )}
        {keyword.source === "subtitle" && (
          <span className="ml-1.5 inline-flex px-1.5 py-0.5 rounded-full bg-teal-100 dark:bg-teal-500/15 text-[10px] font-sans font-medium text-teal-600 dark:text-teal-400 align-middle">
            副标题
          </span>
        )}
        {applied === "add" && (
          <span className="ml-1.5 inline-flex px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-[10px] font-sans font-medium text-emerald-600 dark:text-emerald-400 align-middle">
            新增
          </span>
        )}
        {applied === "remove" && (
          <span className="ml-1.5 inline-flex px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-500/15 text-[10px] font-sans font-medium text-red-600 dark:text-red-400 align-middle">
            已删除
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleSelectKeyword(keyword);
          setPageTab("competitor");
        }}
        className="ml-auto shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium text-zinc-400 dark:text-zinc-500 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
        title="跳到竞品标签，聚焦该词与竞品的排名对比"
      >
        竞品
      </button>
    </div>
  );

  const renderRightRow = (
    keyword: (typeof matrixRows)[number],
    dimmed: boolean,
  ) => (
    <div
      key={`${keyword.language}:${keyword.keyword}:cells`}
      onClick={() => handleSelectKeyword(keyword)}
      className={cn(
        "h-11 grid min-w-max items-center border-b border-zinc-100 dark:border-zinc-800 last:border-b-0 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors",
        dimmed && "opacity-55",
        !dimmed && "bg-emerald-50/30 dark:bg-emerald-500/[0.04]",
        keyword.keyword === chartKeyword && "bg-amber-50/40 dark:bg-amber-500/5",
      )}
      style={{ gridTemplateColumns: storeGridTemplate }}
    >
      {matrixColumns.map((column) => {
        const cell = cellIndex(keyword.keyword, column.storefront);
        return (
          <div
            key={column.storefront}
            className={cn(
              "px-3 py-1.5 text-right border-l border-zinc-100 dark:border-zinc-800",
              column.meta.stale && "opacity-60",
            )}
            title={cellTitle(cell)}
          >
            <MatrixCellView cell={cell} />
          </div>
        );
      })}
    </div>
  );

  // 左右两块各自垂直滚动，滚动位置互相同步，保证表头各自冻结且行对齐。
  const leftScrollRef = useRef<HTMLDivElement>(null);
  const rightScrollRef = useRef<HTMLDivElement>(null);
  const syncingScroll = useRef(false);
  const syncScroll = (source: "left" | "right") => {
    if (syncingScroll.current) return;
    syncingScroll.current = true;
    const from = source === "left" ? leftScrollRef.current : rightScrollRef.current;
    const to = source === "left" ? rightScrollRef.current : leftScrollRef.current;
    if (from && to) to.scrollTop = from.scrollTop;
    requestAnimationFrame(() => {
      syncingScroll.current = false;
    });
  };

  const rowsToRender: { row: (typeof matrixRows)[number]; dimmed: boolean }[] =
    matrixRows.length === 0
      ? []
      : showUnrankedRows
        ? unranked.length > 0
          ? unranked.map((row) => ({ row, dimmed: true }))
          : []
        : scopeFilteredRanked.length > 0
          ? scopeFilteredRanked.map(({ row }) => ({ row, dimmed: false }))
          : [];
  const emptyMatrixMessage =
    matrixRows.length === 0
      ? isGlobalView
        ? "暂无全局关键词（英文），点击「为所选语言生成」。"
        : "暂无关键词，点击「为所选语言生成」。"
      : "该筛选范围内暂无关键词。";

  // —— 行勾选批量删除（在榜/未在榜都可以勾选；对当前标签页的可见行生效） ——
  const toggleRowSel = (language: string, keyword: string) => {
    const key = selKey(language, keyword);
    setRowSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const toggleAllRows = () =>
    setRowSelected(
      allRowsSelected
        ? new Set()
        : new Set(visibleRows.map((k: any) => selKey(k.language, k.keyword))),
    );
  const handleBatchRemove = async () => {
    const items = selectedVisibleRows.map((k: any) => ({
      language: k.language,
      keyword: k.keyword,
    }));
    if (items.length === 0) return;
    if (!window.confirm(`删除 ${items.length} 个关键词？删除后可在「已删除」中恢复。`)) return;
    await removeTrackedKeywords(product.id, items);
    setRowSelected(new Set());
  };

  // —— 批量生成 / 整理 ——
  // 流程：英文（全局）词作母本；没有母本时先一步生成；
  // 已有跟踪词的语言走「整理」复盘，没有词的语言从母本「本地化」；
  // 所有语言（含新语言）的建议统一进建议弹窗，确认后才落库。
  const handleGenerateAll = async () => {
    setError("");
    setKeywordProgress({});
    if (litLangs.length === 0) {
      setError("请先点亮至少一个语言（点 ★ 参与生成）。");
      return;
    }
    // 用最新项目状态判断各语言是否已有跟踪词（避免闭包里的旧快照）。
    const latestProject = useProject.getState().projects.find((p) => p.id === currentProjectId) || project;
    const trackedAll = latestProject?.trackedKeywords || [];
    const hasKeywords = (lang: string) => trackedAll.some((k) => k.language === lang);
    const enHasKeywords = trackedAll.some((k) => k.language === "en");

    // 生成计划：母本优先（英文没有词时排第一步），其余语言按点亮顺序。
    const needsMaster = litLangs.some((lang) => lang !== "en" && !hasKeywords(lang));
    const plan: { lang: string; stage: "generate" | "localize" | "curate" }[] = [];
    if (!enHasKeywords && (needsMaster || litLangs.includes("en"))) {
      plan.push({ lang: "en", stage: "generate" });
    }
    for (const lang of litLangs) {
      if (lang === "en" && !enHasKeywords) continue; // 母本生成已在计划首位
      plan.push({
        lang,
        stage: hasKeywords(lang) ? "curate" : lang === "en" ? "generate" : "localize",
      });
    }
    if (plan.length === 0) {
      setError("所选语言没有需要生成或整理的关键词。");
      return;
    }

    // 母本词表：优先用已跟踪的 en 词；en 刚生成时用其建议（本地化 IPC 会优先采用传入的母本）。
    let masterList: { keyword: string; translation?: string }[] = enHasKeywords
      ? trackedAll
          .filter((k) => k.language === "en" && k.status !== "paused")
          .map((k) => ({ keyword: k.keyword, translation: k.translation || "" }))
      : [];

    const nextCuration: Record<
      string,
      {
        removals: { keyword: string; reason: string; translation?: string }[];
        adds: KeywordSuggestion[];
      }
    > = {};
    const status: Record<string, "running" | "done" | "failed"> = {};
    const baseOpId = crypto.randomUUID();
    let cancelled = false;
    setLoadingLangs(new Set(plan.map((p) => p.lang)));

    for (let i = 0; i < plan.length; i++) {
      if (cancelled) break;
      const step = plan[i];
      const opId = `${baseOpId}:${step.lang}`;
      status[step.lang] = "running";
      setBatch({
        total: plan.length,
        index: i,
        lang: step.lang,
        stage: step.stage,
        opId,
        status: { ...status },
      });
      try {
        if (step.stage === "curate") {
          const result = await (window as any).appilot.projects.curateKeywords(product.id, step.lang, opId);
          // 移除建议补翻译标注：AI 只回关键词，译文从该语言已跟踪词里查。
          const translationOf = (keyword: string) =>
            trackedAll.find((k: any) => k.language === step.lang && k.keyword === keyword)?.translation || "";
          nextCuration[step.lang] = {
            removals: (result.removals || []).map((item: any) => ({
              keyword: item.keyword,
              reason: item.reason,
              translation: translationOf(item.keyword) || undefined,
            })),
            adds: result.adds || [],
          };
        } else if (step.stage === "localize") {
          if (masterList.length === 0) {
            throw new Error("缺少英文母本，无法本地化；请先生成英文关键词。");
          }
          const gen = await (window as any).appilot.projects.localizeKeywords(product.id, step.lang, opId, masterList);
          nextCuration[step.lang] = {
            removals: [],
            adds: gen.tracking || [],
          };
        } else {
          const gen = await (window as any).appilot.projects.generateKeywords(product.id, step.lang, opId);
          nextCuration[step.lang] = {
            removals: [],
            adds: gen.tracking || [],
          };
          if (step.lang === "en") {
            masterList = (gen.tracking || []).map((s: KeywordSuggestion) => ({
              keyword: s.keyword,
              translation: s.translation || "",
            }));
          }
        }
        status[step.lang] = "done";
      } catch (e: any) {
        status[step.lang] = "failed";
        if (String(e?.message || "").includes("已取消")) {
          cancelled = true;
        } else {
          setError(e.message || "关键词生成失败。");
        }
      }
    }

    setBatch(null);
    setLoadingLangs(new Set());
    setKeywordProgress({});
    // 空语言不进弹窗（如整理结果为空、本地化被跳过）。
    const filtered = Object.fromEntries(
      Object.entries(nextCuration).filter(
        ([, data]) => data.removals.length > 0 || data.adds.length > 0,
      ),
    );
    setCuration((prev) => ({ ...prev, ...filtered }));
    if (Object.keys(filtered).length > 0) {
      setCurationOpen(true);
      setCurationConfirm(null);
      if (cancelled) setError("已停止：仅保留已完成语言的建议。");
    } else if (cancelled) {
      setError("已停止，本次没有生成任何建议。");
    }
  };

  const stopGenerateAll = () => {
    // 中止当前语言的请求；循环收到「已取消」后跳出，剩余语言不再发起。
    if (batch?.opId) void (window as any).appilot?.ai?.cancel(batch.opId);
  };

  // 选择状态内聚在 CurationDialog 内部：确认时回传带选择的完整数据，
  // 避免每次点击「采纳/忽略」都重渲染整个关键词页面（矩阵 + 图表很重）。
  const applyCuration = async (
    resolved: Record<string, CurationResolved>,
  ) => {
    setCurationConfirm(null);
    const latest = useProject.getState().projects.find((p) => p.id === currentProjectId);
    const base = latest || project;
    const currentKeywords = [...(base.trackedKeywords || [])].map((k: any) => ({ ...k }));
    const keys = new Set(
      currentKeywords.map((k: any) => `${k.language}\u0000${k.keyword}`),
    );
    // 已删除的词不再复活：AI 有时不遵守“不要重复建议”的约束（尤其母本本地化）。
    const removedKeys = new Set(
      ((base as any).removedKeywords || []).map(
        (r: any) => `${r.language}\u0000${r.keyword}`,
      ),
    );
    let changed = false;
    // 采集预算：先按语言顺序收集待采纳新增，整体过一遍硬上限（超出的自动
    // 不采纳并提示）——AI 建议一次可能给 11 种语言各 10-20 条，不做预算
    // 约束会把任务量瞬间翻倍。
    const pendingAdds: { lang: string; item: (typeof resolved)[string]["adds"][number] }[] = [];
    for (const [lang, data] of Object.entries(resolved)) {
      for (const item of data.adds) {
        if (item.choice === "accept") pendingAdds.push({ lang, item });
      }
    }
    const budget = rankBudgetAdmissible(
      product.supportedLanguages || [],
      product.platform,
      currentKeywords,
      pendingAdds.map(({ lang, item }) => ({ language: lang, keyword: item.keyword })),
    );
    const admissibleKeys = new Set(
      budget.accepted.map((item) => `${item.language}\u0000${item.keyword}`),
    );
    const rejectedByBudget = budget.rejected.length;
    for (const [lang, data] of Object.entries(resolved)) {
      for (const item of data.adds) {
        if (item.choice !== "accept") continue;
        const key = `${lang}\u0000${item.keyword}`;
        if (keys.has(key) || removedKeys.has(key)) continue;
        if (!admissibleKeys.has(key)) continue; // 预算外：不采纳
        currentKeywords.push({
          language: lang,
          keyword: item.keyword,
          rationale: item.rationale,
          translation: item.translation || "",
          status: "active" as const,
          source: "ai" as const,
        });
        keys.add(key);
        changed = true;
      }
      for (const item of data.removals) {
        if (item.choice !== "accept") continue;
        const key = `${lang}\u0000${item.keyword}`;
        const index = currentKeywords.findIndex(
          (k: any) => `${k.language}\u0000${k.keyword}` === key,
        );
        if (index >= 0) {
          currentKeywords.splice(index, 1);
          changed = true;
        }
        keys.delete(key);
      }
    }
    if (!changed) {
      setCuration({});
      setCurationOpen(false);
      return;
    }
    // 一次性保存全部增删：避免每个关键词触发一次完整调度 reconcile +
    // 全量配置落盘，导致确认后长时间卡顿。
    await (window as any).appilot.projects.saveTrackedKeywords(product.id, currentKeywords);
    updateTrackedKeywords(product.id, currentKeywords);
    setCuration({});
    setCurationOpen(false);
    if (rejectedByBudget > 0) {
      setError(
        `已采纳 ${admissibleKeys.size} 条；${rejectedByBudget} 条超出采集预算（每日 ${rankBudget.hardLimit} 实例）未采纳——` +
          "建议先清理低价值关键词（连续未在榜会进入待复核），再重新生成建议。",
      );
    }
  };

  const discardCuration = () => {
    setCurationConfirm(null);
    setCuration({});
    setCurationOpen(false);
  };

  const openSubmissionPanel = async () => {
    setSubmissionPanelOpen((v) => !v);
    if (!submissionPanelOpen) {
      setCandidates([]);
      try {
        const ref = await (window as any).appilot.projects.getSubmissionReference(product.id, currentLang);
        setSubmissionRef(ref);
      } catch (e: any) {
        setError(e.message || "提交内容加载失败。");
      }
    }
  };

  const extractCandidates = async () => {
    const operationId = crypto.randomUUID();
    setCandidatesOpId(operationId);
    setCandidatesLoading(true);
    setSubmissionProgress(null);
    setRemovedCandidateKeys(new Set());
    setCandidatesFailed(false);
    setError("");
    try {
      const result = await (window as any).appilot.projects.extractSubmissionCandidates(
        product.id,
        currentLang,
        operationId,
      );
      setCandidates(result?.candidates || []);
    } catch (e: any) {
      if (String(e?.message || "").includes("已取消")) {
        // 用户主动停止：静默。
      } else {
        setError(e.message || "候选词抽取失败。");
        setCandidatesFailed(true);
      }
    } finally {
      setCandidatesOpId("");
      setCandidatesLoading(false);
      setSubmissionProgress(null);
    }
  };

  const stopCandidates = () => {
    if (candidatesOpId) void (window as any).appilot?.ai?.cancel(candidatesOpId);
  };

  const removeCandidate = (source: string, keyword: string) => {
    setRemovedCandidateKeys((prev) => {
      const next = new Set(prev);
      next.add(`${source}\u0000${keyword}`);
      return next;
    });
  };

  const addAllCandidates = async () => {
    if (candidatesAdding) return;
    const latest = useProject.getState().projects.find((p) => p.id === currentProjectId);
    const current = latest || project;
    const existingKeys = new Set(
      (current.trackedKeywords || []).map((k) => `${k.language}\u0000${k.keyword}`),
    );
    // 1) Dedupe candidates among themselves (source priority: submission > name > subtitle)
    // 2) Dedupe against keywords already tracked in the target language.
    const sourceRank = (source: string) =>
      source === "submission" ? 0 : source === "name" ? 1 : 2;
    const seen = new Set<string>();
    const toAdd = candidates
      .filter(
        (candidate) =>
          !removedCandidateKeys.has(`${candidate.source}\u0000${candidate.keyword}`),
      )
      .sort((a, b) => sourceRank(a.source) - sourceRank(b.source))
      .filter((candidate) => {
        if (seen.has(candidate.keyword)) return false;
        seen.add(candidate.keyword);
        return !existingKeys.has(`${currentLang}\u0000${candidate.keyword}`);
      });
    if (toAdd.length === 0) return;
    // 采集预算硬上限：核心词（商店关键词/名称/副标题）已按来源优先排序放行，
    // 超出部分拒收并提示——任务堆积不如预算治理。
    const admissible = rankBudgetAdmissible(
      product.supportedLanguages || [],
      product.platform,
      current.trackedKeywords || [],
      toAdd.map((candidate) => ({ language: currentLang, keyword: candidate.keyword })),
    );
    const rejectedCount = admissible.rejected.length;
    const acceptedKeys = new Set(admissible.accepted.map((item) => item.keyword));
    const acceptedToAdd = toAdd.filter((candidate) => acceptedKeys.has(candidate.keyword));
    if (acceptedToAdd.length === 0) {
      setError(
        `已达采集预算上限（每日 ${rankBudget.hardLimit} 实例，当前 ${rankBudget.dailyInstances}）——` +
          "请先清理低价值关键词（连续未在榜的词会进入待复核）再添加。",
      );
      return;
    }
    setCandidatesAdding(true);
    try {
      const next = [
        ...(current.trackedKeywords || []),
        ...acceptedToAdd.map((candidate) => ({
          language: currentLang,
          keyword: candidate.keyword,
          rationale: candidate.rationale,
          translation: "",
          status: "active" as const,
          source: candidate.source as "submission" | "name" | "subtitle",
        })),
      ];
      await (window as any).appilot.projects.saveTrackedKeywords(product.id, next);
      updateTrackedKeywords(product.id, next);
      const addedKeywords = new Set(acceptedToAdd.map((candidate) => candidate.keyword));
      setCandidates((prev) => prev.filter((candidate) => !addedKeywords.has(candidate.keyword)));
      setRemovedCandidateKeys(new Set());
      if (rejectedCount > 0) {
        setError(
          `已加入 ${acceptedToAdd.length} 个，${rejectedCount} 个超出采集预算（每日 ${rankBudget.hardLimit} 实例）未加入——请先清理低价值关键词。`,
        );
      }
    } catch (e: any) {
      setError(e.message || "一键加入失败。");
    } finally {
      setCandidatesAdding(false);
    }
  };

  const removeTracked = async (kw: string, language: string) => {
    await removeTrackedKeyword(product.id, language, kw);
  };

  // 待处理暂停复核：打开队列（仅当前平台），并支持分类处理。
  const openPendingReview = async () => {
    if (pendingLoading) return;
    setPendingLoading(true);
    try {
      const entries =
        (await (window as any).appilot?.projects?.pendingPauseList(project.id)) || [];
      setPendingEntries(
        entries.filter((entry: any) => entry.platform === product.platform),
      );
      setShowPendingReview(true);
    } catch {
      setPendingEntries([]);
    } finally {
      setPendingLoading(false);
    }
  };

  const actPending = async (
    entry: any,
    action: "resume" | "pause" | "remove" | "copy-gap",
  ) => {
    const key = `${entry.language}:${entry.keyword}:${entry.platform}`;
    setPendingActing(key);
    try {
      await (window as any).appilot?.projects?.reviewPendingPause(
        product.id,
        entry.language,
        entry.keyword,
        entry.platform,
        action,
      );
      // 立即从列表移除该条目（已处理），再刷新确认。
      setPendingEntries((prev) =>
        prev.filter(
          (item: any) =>
            !(
              item.keyword === entry.keyword &&
              item.language === entry.language &&
              item.platform === entry.platform
            ),
        ),
      );
      await useProject.getState().load();
      const entries =
        (await (window as any).appilot?.projects?.pendingPauseList(project.id)) || [];
      setPendingEntries(
        entries.filter((item: any) => item.platform === product.platform),
      );
    } catch (e: any) {
      setError(e.message || "处理失败。");
    } finally {
      setPendingActing(null);
    }
  };

  const translatePendingKeyword = async (entry: any) => {
    const key = `${entry.language}:${entry.keyword}:${entry.platform}`;
    setTranslatingKey(key);
    try {
      await (window as any).appilot?.projects?.translateKeyword(
        product.id,
        entry.language,
        entry.keyword,
      );
      const entries =
        (await (window as any).appilot?.projects?.pendingPauseList(project.id)) || [];
      setPendingEntries(
        entries.filter((item: any) => item.platform === product.platform),
      );
    } catch (e: any) {
      setError(e.message || "翻译失败。");
    } finally {
      setTranslatingKey(null);
    }
  };

  // 批量补全所有缺译文的关键词（一次性任务，已有译文的跳过）。
  const runTranslateAll = async () => {
    if (translatingAll) return;
    setTranslatingAll(true);
    setTranslateProgress({ done: 0, total: missingTranslationCount });
    try {
      await (window as any).appilot?.projects?.translateKeywords(project.id);
      await useProject.getState().load();
    } catch (e: any) {
      setError(e.message || "批量翻译失败。");
    } finally {
      setTranslatingAll(false);
      setTranslateProgress(null);
    }
  };

  useEffect(() => {
    const off = (window as any).appilot?.projects?.onTranslateKeywordsProgress?.(
      (progress: any) => {
        if (progress && typeof progress.done === "number") {
          setTranslateProgress(progress);
        }
      },
    );
    return () => off?.();
  }, []);

  const restoreTracked = async (language: string, kw: string) => {
    // 恢复 = 重新参与采集：受采集预算硬上限约束。
    if (!canReactivateKeyword(language)) return;
    await restoreTrackedKeyword(product.id, language, kw);
  };

  /** 恢复/重启采集前检查：该语言的商店成本是否还在硬预算内。 */
  const canReactivateKeyword = (language: string): boolean => {
    const { accepted } = rankBudgetAdmissible(
      product.supportedLanguages || [],
      product.platform,
      project.trackedKeywords || [],
      [{ language, keyword: "__budget_probe__" }],
    );
    if (accepted.length > 0) return true;
    setError(
      `已达采集预算上限（每日 ${rankBudget.hardLimit} 实例）——请先清理或忽略低价值关键词，再恢复采集。`,
    );
    return false;
  };

  const clearRemoved = async () => {
    await clearRemovedKeywords(product.id, queryLanguages);
    setShowDeleted(false);
  };

  const renderPageTabs = () => (
    <div className="mb-4 inline-flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden shadow-sm">
      {(
        [
          ["keywords", "关键词"],
          ["competitor", "竞品"],
          ["distribution", "分布"],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => setPageTab(value)}
          className={cn(
            "px-4 py-1.5 text-sm font-medium transition-colors",
            pageTab === value
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );

  if (pageTab === "competitor") {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        {renderPageTabs()}
        {project && product ? (
          <CompetitorPanel
            projectId={project.id}
            projectKeywords={project.trackedKeywords || []}
            product={{
              id: product.id,
              platform: product.platform,
              supportedLanguages: product.supportedLanguages,
              trackId: product.trackId,
              bundleId: product.bundleId,
              trackName: product.trackName,
            }}
            defaultTerm={selectedKeyword || ""}
            viewLang={currentLang}
            rankSnapshots={rankSnapshots}
            focusKeyword={selectedKeyword || undefined}
          />
        ) : (
          <EmptyState title="还没有项目" desc="添加一个项目后，这里会展示关键词。" />
        )}
      </div>
    );
  }

  if (pageTab === "distribution") {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        {renderPageTabs()}
        {distributionData.length === 0 ? (
          <EmptyState
            title="暂无排名数据"
            desc="关键词开始采集后，这里会展示各商店的排名分布。"
          />
        ) : (
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm px-5 py-5">
            <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
              <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                排名分布（最新快照）
              </h4>
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                全部关键词 × 全部商店；商店按 TOP10 数量排序
              </span>
            </div>
            <div className="h-96">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={distributionData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="text-zinc-200 dark:text-zinc-800" />
                  <XAxis dataKey="storefront" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip content={<DistributionTooltip />} />
                  {RANK_BUCKETS.map((bucket) => (
                    <Area
                      key={bucket.key}
                      type="monotone"
                      dataKey={bucket.key}
                      stackId="1"
                      stroke="none"
                      fill={bucket.color}
                      fillOpacity={bucket.opacity}
                      name={bucket.label}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
              {RANK_BUCKETS.map((bucket) => (
                <span
                  key={bucket.key}
                  className="inline-flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400"
                >
                  <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: bucket.color }} />
                  {bucket.label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {renderPageTabs()}
      {error && (
        <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/50 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {languages.length === 0 ? (
        <EmptyState title="未识别支持语言" desc="请先在总览确认项目已识别出语言，再生成关键词。" />
      ) : (
        <>
          <div className="flex flex-col rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm max-h-[70vh]">
            <div className="px-5 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">关键词排名</h2>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
                    商店提交关键词由发布工作台负责。
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  {schedulerStatus && (
                    <span className="flex items-center gap-2 text-[10px] font-normal text-zinc-400 dark:text-zinc-500 pt-1">
                      <span>
                        {schedulerStatus.enabled ? "自动任务已启用" : "自动任务未启用"}
                        {schedulerStatus.nextDueAt
                          ? new Date(schedulerStatus.nextDueAt).getTime() <= Date.now()
                            ? " · 待执行"
                            : ` · 下次 ${new Date(schedulerStatus.nextDueAt).toLocaleString()}`
                          : ""}
                      </span>
                      <button
                        onClick={() => void handleRunDue()}
                        disabled={runningDue}
                        className={cn(
                          "transition-colors",
                          runningDue
                            ? "text-zinc-400 dark:text-zinc-500 cursor-wait"
                            : "text-amber-600 dark:text-amber-400 hover:underline",
                        )}
                        title={runningDue ? "正在执行待处理任务…" : "立即执行待处理任务"}
                      >
                        {runningDue ? "执行中…" : "立即执行"}
                      </button>
                    </span>
                  )}
                  <div className="relative">
                    <button onClick={openSubmissionPanel} className={btnSecondary}>
                      提交内容
                    </button>
      {submissionPanelOpen && (
                      <div className="absolute right-0 top-full mt-1.5 z-40 w-[26rem] max-h-[70vh] overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg p-4 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            提交内容（{languageLabel(currentLang)}）
                          </h4>
                          <button
                            onClick={() => setSubmissionPanelOpen(false)}
                            className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                          >
                            关闭
                          </button>
                        </div>
                        {submissionRef ? (
                          <div className="space-y-2">
                            <div>
                              <p className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500 mb-0.5">名称</p>
                              <p className="text-sm text-zinc-700 dark:text-zinc-300 break-words">
                                {submissionRef.name}
                              </p>
                            </div>
                            <div>
                              <p className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500 mb-0.5">副标题</p>
                              <p className="text-sm text-zinc-700 dark:text-zinc-300 break-words">
                                {submissionRef.subtitle || "—"}
                              </p>
                            </div>
                            <div>
                              <p className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500 mb-0.5">商店关键词</p>
                              <p className="text-sm text-zinc-700 dark:text-zinc-300 break-words">
                                {submissionRef.submissionKeywords || "—"}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-zinc-400 dark:text-zinc-500">
                            尚未生成提交内容，请先在发布工作台确认文案。
                          </p>
                        )}
                        <div className="flex items-center justify-between gap-3 pt-1">
                          <AIProgressButton
                            onStart={() => void extractCandidates()}
                            onStop={stopCandidates}
                            disabled={!submissionRef}
                            loading={candidatesLoading}
                            progress={submissionProgress}
                            idleLabel="抽取候选词"
                            retry={candidatesFailed}
                          />
                        </div>
                        {candidates.length > 0 && (
                          <div className="space-y-2 border-t border-zinc-100 dark:border-zinc-800 pt-3">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                                候选词（可删除后一键加入）
                              </p>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={addAllCandidates}
                                  disabled={pendingCandidateCount === 0 || candidatesAdding}
                                  className={btnPrimary}
                                >
                                  {candidatesAdding
                                    ? "加入中…"
                                    : `一键加入（${pendingCandidateCount}）`}
                                </button>
                                <button
                                  onClick={() => {
                                    setCandidates([]);
                                    setRemovedCandidateKeys(new Set());
                                  }}
                                  className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                                >
                                  清空
                                </button>
                              </div>
                            </div>
                            {(["submission", "name", "subtitle"] as const).map((source) => {
                              const group = candidates.filter(
                                (c) =>
                                  c.source === source &&
                                  !removedCandidateKeys.has(`${source}\u0000${c.keyword}`),
                              );
                              if (group.length === 0) return null;
                              return (
                                <div key={source}>
                                  <p className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500 mb-1">
                                    {source === "submission" ? "商店关键词" : source === "name" ? "名称" : "副标题"}
                                  </p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {group.map((c) => {
                                      const exists = trackedCandidateKeywords.has(c.keyword);
                                      return (
                                        <span
                                          key={`${source}:${c.keyword}`}
                                          className={cn(
                                            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs",
                                            exists
                                              ? "border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-zinc-400 dark:text-zinc-500"
                                              : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300",
                                          )}
                                          title={c.rationale}
                                        >
                                          {c.keyword}
                                          {exists ? (
                                            <span className="text-emerald-500 dark:text-emerald-400">✓</span>
                                          ) : (
                                            <button
                                              onClick={() => removeCandidate(source, c.keyword)}
                                              className="text-zinc-400 hover:text-red-500"
                                              title="删除"
                                            >
                                              ✕
                                            </button>
                                          )}
                                        </span>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <AIProgressButton
                    onStart={() => void handleGenerateAll()}
                    onStop={stopGenerateAll}
                    loading={loadingLangs.size > 0}
                    progress={activeProgress}
                    statusLabel={batchStatusLabel}
                    idleLabel="为所选语言生成 / 整理"
                  />
                </div>
              </div>
              <p className="mt-3 text-[11px] font-medium tracking-wider text-zinc-400 dark:text-zinc-500 flex items-center gap-2">
                <span>语言（点击切换查看；点 ★ 点亮/取消点亮，点亮语言参与生成；全局即英文关键词卡）</span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-mono text-[10px] font-normal tracking-normal",
                    rankBudget.state === "hard"
                      ? "bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400"
                      : rankBudget.state === "soft"
                        ? "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400"
                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400",
                  )}
                  title={
                    rankBudget.state === "hard"
                      ? "已达采集预算硬上限：新增/恢复采集任务将被拒绝，请清理低价值关键词"
                      : rankBudget.state === "soft"
                        ? "接近采集预算：建议先清理低价值关键词（连续未在榜会进入待复核）再加新的"
                        : "采集预算（每日排名任务数 = 活跃关键词 × 语言覆盖的商店数）"
                  }
                >
                  每日采集 {rankBudget.dailyInstances}/{rankBudget.hardLimit} · 关键词 {rankBudget.activeKeywords}
                </span>
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {(() => {
                  const enLit = litLangs.includes("en");
                  const enBatchStatus = batch?.status?.en;
                  return (
                    <div
                      className={cn(
                        "inline-flex items-center overflow-hidden rounded-lg border transition-colors",
                        isGlobalView
                          ? "border-sky-500 ring-2 ring-sky-500/20 bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-400"
                          : "border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setViewLang("global")}
                        title="全局卡：英文（en）关键词 × 全部商店（英语是全局通用检索语言）"
                        className={cn(
                          "px-3 py-1.5 text-sm transition-colors inline-flex items-center gap-1.5",
                          isGlobalView ? "font-medium" : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
                        )}
                      >
                        {enBatchStatus && (
                          <span
                            aria-hidden="true"
                            className={cn(
                              "w-1.5 h-1.5 rounded-full shrink-0",
                              enBatchStatus === "running"
                                ? "bg-amber-500 animate-pulse"
                                : enBatchStatus === "done"
                                  ? "bg-emerald-500"
                                  : "bg-red-500",
                            )}
                          />
                        )}
                        全局（英文）
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleLitLang("en")}
                        title={enLit ? "取消点亮（不参与生成）" : "点亮（参与生成）"}
                        className={cn(
                          "px-2 py-1.5 text-xs border-l transition-colors",
                          isGlobalView ? "border-sky-500/30" : "border-zinc-200/70 dark:border-zinc-700/70",
                          enLit ? "text-amber-500" : "text-zinc-400 hover:text-amber-500",
                        )}
                      >
                        {enLit ? "★" : "☆"}
                      </button>
                    </div>
                  );
                })()}
                {languageOptions.map((option) => {
                  const lit = litLangs.includes(option.code);
                  const active = option.code === currentLang;
                  // 批量进行中：该语言的执行状态点（排队不显示，运行中呼吸，结束落色）。
                  const langBatchStatus = batch?.status?.[option.code];
                  return (
                    <div
                      key={option.code}
                      className={cn(
                        "inline-flex items-center overflow-hidden rounded-lg border transition-colors",
                        active
                          ? "border-amber-500 ring-2 ring-amber-500/20 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400"
                          : lit
                            ? "border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300"
                            : "border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400",
                      )}
                    >
                      <button
                        type="button"
                        // 只切换查看的语言；点亮/取消点亮只能点 ★（与按钮分离）。
                        onClick={() => setViewLang(option.code)}
                        title={
                          langBatchStatus === "running"
                            ? "正在生成/整理该语言…"
                            : langBatchStatus === "done"
                              ? "该语言建议已生成，见建议弹窗"
                              : langBatchStatus === "failed"
                                ? "该语言生成失败"
                                : active
                                  ? "当前查看"
                                  : "点击查看该语言"
                        }
                        className={cn(
                          "px-3 py-1.5 text-sm transition-colors inline-flex items-center gap-1.5",
                          active ? "font-medium" : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
                        )}
                      >
                        {langBatchStatus && (
                          <span
                            aria-hidden="true"
                            className={cn(
                              "w-1.5 h-1.5 rounded-full shrink-0",
                              langBatchStatus === "running"
                                ? "bg-amber-500 animate-pulse"
                                : langBatchStatus === "done"
                                  ? "bg-emerald-500"
                                  : "bg-red-500",
                            )}
                          />
                        )}
                        {option.label}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleLitLang(option.code)}
                        title={lit ? "取消点亮（不参与生成）" : "点亮（参与生成）"}
                        className={cn(
                          "px-2 py-1.5 text-xs border-l border-zinc-200/70 dark:border-zinc-700/70 transition-colors",
                          lit ? "text-amber-500" : "text-zinc-400 hover:text-amber-500",
                        )}
                      >
                        {lit ? "★" : "☆"}
                      </button>
                    </div>
                  );
                })}
              </div>
              {/* 卡片级状态控件：待复核 / 已暂停（补全译文与已删除已并入矩阵表头第二行） */}
              {(pendingForCurrent.length > 0 || pausedForCurrent.length > 0) && (
                <div className="relative z-40 mt-2 flex flex-wrap items-center gap-1.5">
                  {pendingForCurrent.length > 0 && (
                    <button
                      type="button"
                      onClick={() => void openPendingReview()}
                      disabled={pendingLoading}
                      className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-medium transition-colors bg-amber-500/15 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 ring-1 ring-amber-500/40 hover:bg-amber-500/25"
                      title="连续未在榜的关键词等待人工分类（恢复 / 暂停 / 移除 / 暂停并列入文案缺口）"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                      待处理暂停 {pendingForCurrent.length}
                    </button>
                  )}
                  {pausedForCurrent.length > 0 && (
                    <span className="relative" ref={pausedPopoverRef}>
                      <button
                        type="button"
                        onClick={() => setShowPaused((v) => !v)}
                        className={cn(
                          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors",
                          showPaused
                            ? "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400"
                            : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700",
                        )}
                      >
                        已暂停 {pausedForCurrent.length}
                      </button>
                      {showPaused && (
                        <div className="absolute right-0 top-full mt-1.5 z-30 w-80 max-h-72 overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg p-3">
                          <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400 mb-1.5">
                            已暂停（自动屏蔽）
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {pausedForCurrent.map((item) => (
                              <span
                                key={`paused:${item.language}:${item.keyword}`}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-amber-200/70 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/10 text-xs text-zinc-600 dark:text-zinc-300"
                                title={item.pausedReason || "已暂停"}
                              >
                                {item.keyword}
                                <button
                                  onClick={() => {
                                    if (canReactivateKeyword(item.language)) {
                                      void resumePausedKeyword(product.id, item.language, item.keyword);
                                    }
                                  }}
                                  className="text-amber-600 dark:text-amber-400 hover:underline"
                                  title="恢复采集"
                                >
                                  恢复
                                </button>
                                <button
                                  onClick={() => removeTracked(item.keyword, item.language)}
                                  className="text-zinc-400 hover:text-red-500"
                                  title="删除"
                                >
                                  ✕
                                </button>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-1 min-h-0 min-w-0">
            {/* 左块：关键词列（固定宽，表头两行不折叠，剩余宽度让给商店列） */}
            <div
              ref={leftScrollRef}
              onScroll={() => syncScroll("left")}
              className="w-80 shrink-0 overflow-y-auto scrollbar-hidden"
            >
              <div className="sticky top-0 z-30 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
                {isGlobalView && globalColumnGroups.length > 1 && (
                  <div className="h-6 flex items-center px-4 text-[10px] font-medium text-sky-600/80 dark:text-sky-400/80 border-b border-zinc-100 dark:border-zinc-800">
                    全局关键词（英文）× 全部商店
                  </div>
                )}
                <div className="h-7 flex items-center justify-between gap-1.5 px-4 whitespace-nowrap">
                  <span className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 shrink-0">
                    关键词（{trackedActive.length}）
                  </span>
                  <div className="flex items-center rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden shrink-0">
                      <button
                        type="button"
                        onClick={() => setMatrixTab("ranked")}
                        className={cn(
                          "px-2 py-0.5 text-[10px] font-medium transition-colors",
                          activeMatrixTab === "ranked"
                            ? "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400"
                            : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800",
                        )}
                      >
                        在榜 {ranked.length}
                      </button>
                      <button
                        type="button"
                        onClick={() => setMatrixTab("unranked")}
                        className={cn(
                          "px-2 py-0.5 text-[10px] font-medium transition-colors border-l border-zinc-200 dark:border-zinc-700",
                          activeMatrixTab === "unranked"
                            ? "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400"
                            : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800",
                        )}
                      >
                        未在榜 {unranked.length}
                      </button>
                  </div>
                </div>
                {/* 第二行：勾选批量删除 + 补全译文/已删除（「已删除」点击打开页面级模态） */}
                <div className="h-9 flex items-center gap-1.5 px-4 whitespace-nowrap">
                  {urlScope === "top10" && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = new URLSearchParams(searchParams);
                        next.delete("scope");
                        setSearchParams(next);
                      }}
                      className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[10px] font-medium hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-colors"
                    >
                      前 10 ✕
                    </button>
                  )}
                  {urlScope === "paused" && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowPaused(false);
                        const next = new URLSearchParams(searchParams);
                        next.delete("scope");
                        setSearchParams(next);
                      }}
                      className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[10px] font-medium hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-colors"
                    >
                      已暂停 ✕
                    </button>
                  )}
                  {visibleRows.length > 0 && (
                    <>
                      <label
                        className="inline-flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400 cursor-pointer select-none shrink-0"
                        title="全选 / 取消全选（当前标签页的可见关键词）"
                      >
                        <input
                          type="checkbox"
                          checked={allRowsSelected}
                          onChange={toggleAllRows}
                          className="accent-amber-500"
                        />
                        全选
                      </label>
                      {selectedVisibleRows.length > 0 && (
                        <button
                          type="button"
                          onClick={() => void handleBatchRemove()}
                          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium transition-colors bg-red-500/10 dark:bg-red-500/15 text-red-600 dark:text-red-400 ring-1 ring-red-500/40 hover:bg-red-500/20 shrink-0"
                          title="批量删除勾选的关键词（可到「已删除」中恢复）"
                        >
                          批量删除 {selectedVisibleRows.length}
                        </button>
                      )}
                    </>
                  )}
                  {/* 补全译文：常驻占位（无缺译文时隐藏），避免按钮出现/消失引起布局跳动 */}
                  <span
                    className={cn(
                      "shrink-0 inline-flex",
                      missingTranslationCount === 0 && !translatingAll && "invisible",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => void runTranslateAll()}
                      disabled={translatingAll}
                      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium transition-colors bg-sky-500/15 dark:bg-sky-500/20 text-sky-700 dark:text-sky-400 ring-1 ring-sky-500/40 hover:bg-sky-500/25 disabled:opacity-60"
                      title="一次性翻译所有非中文关键词（简体中文标注）"
                    >
                      {translatingAll
                        ? `翻译中 ${translateProgress?.done ?? 0}/${translateProgress?.total ?? missingTranslationCount}`
                        : `补全译文 ${missingTranslationCount}`}
                    </button>
                  </span>
                  {/* 已删除：常驻占位（无已删除时隐藏）；点击打开页面级已删除模态 */}
                  <span
                    className={cn("shrink-0 inline-flex", removedForCurrent.length === 0 && "invisible")}
                  >
                    <button
                      type="button"
                      onClick={() => setShowDeleted(true)}
                      className={cn(
                        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors",
                        showDeleted
                          ? "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400"
                          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700",
                      )}
                    >
                      已删除 {removedForCurrent.length}
                    </button>
                  </span>
                </div>
              </div>
              {rowsToRender.length === 0 ? (
                <p className="text-sm text-zinc-400 dark:text-zinc-500 py-4 px-5 text-center">
                  {emptyMatrixMessage}
                </p>
              ) : (
                rowsToRender.map(({ row, dimmed }) => renderLeftCell(row, dimmed))
              )}
            </div>
            {/* 右块：商店列占满剩余宽度（尽量多列同屏，超出的横向滚动） */}
            <div
              ref={rightScrollRef}
              onScroll={() => syncScroll("right")}
              className="flex-1 min-w-0 overflow-auto scrollbar-hidden border-l border-zinc-200 dark:border-zinc-800"
            >
              <div
                className="min-w-max sticky top-0 z-20 bg-white dark:bg-zinc-900 border-b border-zinc-100 dark:border-zinc-800"
              >
                {isGlobalView && globalColumnGroups.length > 1 && (
                  <div
                    className="grid"
                    style={{ gridTemplateColumns: storeGridTemplate }}
                  >
                    {globalColumnGroups.map((group) => (
                      <div
                        key={group.label}
                        style={{ gridColumn: `span ${group.span}` }}
                        className="h-6 flex items-center justify-center text-[10px] font-medium text-zinc-500 dark:text-zinc-400 border-b border-zinc-100 dark:border-zinc-800"
                        title={group.label === "英语商店" ? "英语地区商店（en 本地化直接覆盖）" : "其他语言商店（未本地化的商店回退展示英语关键词）"}
                      >
                        {group.label}
                      </div>
                    ))}
                  </div>
                )}
                <div
                  className="grid min-w-max"
                  style={{ gridTemplateColumns: storeGridTemplate }}
                >
                {matrixColumns.map((column) => (
                <div
                  key={column.storefront}
                  className={cn(
                    "h-16 px-3 text-right border-l border-zinc-100 dark:border-zinc-800 flex flex-col justify-center",
                    column.meta.stale && "opacity-60",
                  )}
                >
                  <div className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    {storefrontDisplayName(column.storefront)}
                  </div>
                  <div className="mt-0.5 text-[10px] font-normal text-zinc-400 dark:text-zinc-500">
                    {column.meta.lastCheckedAt
                      ? formatColumnTime(column.meta.lastCheckedAt)
                      : "未查询"}
                    {column.meta.stale ? " · 过期" : ""}
                  </div>
                </div>
                ))}
                </div>
              </div>
              {rowsToRender.map(({ row, dimmed }) => renderRightRow(row, dimmed))}
            </div>
            </div>

            </div>

            {compareMode && compareChart.rows.length > 0 ? (
            <div className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm px-5 pt-5 pb-5">
              <div>
                <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                  <h4 className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    关键词对比趋势（{compareChart.words.length} 个词 · 当日跨店最优名次）
                  </h4>
                  {checkedRows.length > compareChart.words.length && (
                    <span className="text-[10px] text-amber-600 dark:text-amber-400">
                      已勾选 {checkedRows.length} 个词，仅显示最优前 {MAX_COMPARE_WORDS} 个
                    </span>
                  )}
                </div>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={compareChart.rows} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.18)" />
                      <XAxis
                        dataKey="time"
                        tickFormatter={(iso: string) => {
                          const dt = new Date(iso);
                          return `${dt.getMonth() + 1}/${dt.getDate()}`;
                        }}
                        tick={{ fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={40}
                        height={26}
                      />
                      <YAxis
                        reversed
                        domain={[1, compareMaxRank]}
                        allowDecimals={false}
                        ticks={compareTicks}
                        tick={{ fontSize: 11 }}
                        tickMargin={8}
                        tickLine={false}
                        axisLine={false}
                        width={34}
                      />
                      <Tooltip />
                      {compareChart.words.map((word, index) => (
                        <Line
                          key={word}
                          dataKey={word}
                          name={word}
                          type="monotone"
                          stroke={CHART_COLORS[index % CHART_COLORS.length]}
                          strokeWidth={2}
                          connectNulls
                          dot={{ r: 2.5 }}
                          activeDot={{ r: 4 }}
                        />
                      ))}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {compareChart.words.map((word, index) => (
                    <span
                      key={word}
                      className="inline-flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400"
                    >
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
                      />
                      {word}
                    </span>
                  ))}
                  <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                    勾选多个词即可对比（当日跨店最优名次）；取消勾选恢复单词逐店视图
                  </span>
                </div>
              </div>

            </div>
            ) : chartKeyword && chartData.length > 0 ? (
            <div className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm px-5 pt-5 pb-5">
                  <div>
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.18)" />
                          <XAxis
                            dataKey="time"
                            tickFormatter={(iso: string) => {
                              const dt = new Date(iso);
                              return `${dt.getMonth() + 1}/${dt.getDate()}`;
                            }}
                            tick={{ fontSize: 10 }}
                            tickLine={false}
                            axisLine={false}
                            minTickGap={40}
                            height={26}
                          />
                          <YAxis
                            reversed
                            domain={[1, chartMaxRank]}
                            allowDecimals={false}
                            ticks={chartTicks}
                            tick={{ fontSize: 11 }}
                            tickMargin={8}
                            tickLine={false}
                            axisLine={false}
                            width={34}
                          />
                          <Tooltip
                            content={<RankTooltip minN={GROUP_BAND_MIN_N} />}
                          />
                          {chartSeriesMeta.map((series, index) => (
                            <Area
                              key={`band:${series.storefront}`}
                              name={`${series.label}整组带`}
                              dataKey={(row: any) => {
                                const p25 = row?.[`${series.storefront}:p25`];
                                const p75 = row?.[`${series.storefront}:p75`];
                                return p25 != null && p75 != null ? [p25, p75] : null;
                              }}
                              type="monotone"
                              connectNulls
                              stroke="none"
                              fill={CHART_COLORS[index % CHART_COLORS.length]}
                              fillOpacity={0.2}
                              isAnimationActive={false}
                            />
                          ))}
                          {chartSeriesMeta.map((series, index) => (
                            <Line
                              key={series.storefront}
                              dataKey={series.storefront}
                              name={series.label}
                              type="monotone"
                              stroke={CHART_COLORS[index % CHART_COLORS.length]}
                              strokeWidth={2}
                              connectNulls
                              dot={{ r: 3 }}
                              activeDot={{ r: 5 }}
                            />
                          ))}
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <h4 className="text-xs font-medium text-zinc-700 dark:text-zinc-300 inline-flex items-center gap-1.5">
                        <KeywordRuby
                          keyword={chartKeyword}
                          translation={chartKeywordMeta?.translation}
                          annotate={Boolean(
                            chartKeywordMeta &&
                              chartKeywordMeta.language !== "zh-Hans" &&
                              chartKeywordMeta.language !== "zh-Hant",
                          )}
                        />
                        排名趋势（{chartSeriesMeta.length} 个商店）
                      </h4>
                      <span className="text-[10px] text-zinc-400 dark:text-zinc-500">位置越高越好</span>
                      {chartSeriesMeta.map((series, index) => (
                        <span
                          key={series.storefront}
                          className="inline-flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400"
                        >
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
                          />
                          {series.label}
                        </span>
                      ))}
                      <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                        同色半透明带 = 该商店整组在榜词的 P25–P75（未进榜 / 未检查的词不参与；当天在榜词不足{" "}
                        {GROUP_BAND_MIN_N} 时用邻近日连接）
                      </span>
                      {noBandStorefronts.length > 0 && (
                        <span className="text-[10px] text-amber-600 dark:text-amber-400">
                          「{noBandStorefronts.map((m) => m.label).join("、")}」整组词极少同日有
                          {GROUP_BAND_MIN_N} 个以上进前 200（不足 {GROUP_BAND_MIN_DAYS} 天），无整组带可绘
                          （只显示该词曲线；悬停可见当日在榜/未进榜词数）
                        </span>
                      )}
                    </div>
                  </div>

            </div>
            ) : null}

        </>
      )}

      {showDeleted && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6"
          onClick={() => setShowDeleted(false)}
        >
          <div
            className="w-full max-w-md max-h-[80vh] overflow-auto rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                已删除的关键词（手动）· {languageLabel(currentLang)}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void clearRemoved()}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-medium text-red-600 dark:text-red-400 ring-1 ring-red-500/40 hover:bg-red-500/10 transition-colors"
                  title="永久清空当前卡片已删除的关键词（不可恢复）"
                >
                  清空
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeleted(false)}
                  className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="p-4">
              {removedForCurrent.length === 0 ? (
                <p className="text-xs text-zinc-500 dark:text-zinc-400 py-6 text-center">
                  暂无已删除关键词。
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {removedForCurrent.map((item) => (
                    <span
                      key={`${item.language}:${item.keyword}`}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-500 dark:text-zinc-400"
                    >
                      {item.keyword}
                      <button
                        onClick={() => restoreTracked(item.language, item.keyword)}
                        className="text-amber-600 dark:text-amber-400 hover:underline"
                        title="恢复到关键词列表并重新参与采集（受采集预算硬上限检查）"
                      >
                        恢复
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <p className="mt-3 text-[11px] text-zinc-400 dark:text-zinc-500">
                已删除的词不再参与采集与排名统计；「恢复」会重新过一遍采集预算硬上限。
              </p>
            </div>
          </div>
        </div>
      )}

      {showPendingReview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6"
          onClick={() => setShowPendingReview(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[80vh] overflow-auto rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                待处理暂停复核 · {platformLabel(product.platform)}
              </h3>
              <button
                type="button"
                onClick={() => setShowPendingReview(false)}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                ✕
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                这些关键词已连续未在榜，已停止采集等待处理。分类建议来自规则层
                （文案覆盖 / 产品档案），可自行改判。
              </p>
              {pendingEntries.length === 0 ? (
                <p className="text-xs text-zinc-500 dark:text-zinc-400 py-6 text-center">
                  暂无待处理项。
                </p>
              ) : (
                pendingEntries.map((entry) => {
                  const actKey = `${entry.language}:${entry.keyword}:${entry.platform}`;
                  const busy = pendingActing === actKey;
                  // 根据暂停原因确定默认推荐动作（明显标出）。
                  const recommended =
                    entry.suggestion === "copy-gap"
                      ? "copy-gap"
                      : entry.suggestion === "off-topic"
                        ? "remove"
                        : "pause";
                  const recBtnClass = (kind: string) =>
                    cn(
                      "px-2 py-1 rounded-md text-[11px] font-medium disabled:opacity-50",
                      recommended === kind
                        ? kind === "remove"
                          ? "bg-red-600 text-white ring-2 ring-red-500/30 hover:bg-red-700"
                          : kind === "copy-gap"
                            ? "bg-sky-600 text-white ring-2 ring-sky-500/30 hover:bg-sky-700"
                            : "bg-amber-600 text-white ring-2 ring-amber-500/30 hover:bg-amber-700"
                        : "border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/60",
                    );
                  const suggestionMeta =
                    entry.suggestion === "copy-gap"
                      ? {
                          label: "可能文案缺口",
                          cls: "bg-sky-100 dark:bg-sky-500/15 text-sky-700 dark:text-sky-400",
                        }
                      : entry.suggestion === "competitive"
                        ? {
                            label: "竞争（文案已覆盖）",
                            cls: "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400",
                          }
                        : {
                            label: "可能与产品无关",
                            cls: "bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400",
                          };
                  return (
                    <div
                      key={actKey}
                      className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-3"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <KeywordRuby
                          keyword={entry.keyword}
                          translation={entry.translation}
                          annotate={
                            entry.language !== "zh-Hans" &&
                            entry.language !== "zh-Hant"
                          }
                          className="text-sm font-medium text-zinc-800 dark:text-zinc-200"
                        />
                        {entry.language !== "zh-Hans" &&
                          entry.language !== "zh-Hant" &&
                          !entry.translation && (
                            <button
                              type="button"
                              disabled={translatingKey === actKey}
                              onClick={() => void translatePendingKeyword(entry)}
                              className="text-[10px] text-sky-600 dark:text-sky-400 hover:underline disabled:opacity-50"
                              title="翻译为中文"
                            >
                              {translatingKey === actKey ? "翻译中…" : "翻译"}
                            </button>
                          )}
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                          {languageLabel(entry.language)}
                        </span>
                        <span
                          className={cn(
                            "px-1.5 py-0.5 rounded text-[10px]",
                            entry.state === "paused"
                              ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
                              : "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400",
                          )}
                        >
                          {entry.state === "paused"
                            ? "已暂停（历史自动）"
                            : "待处理"}
                        </span>
                        <span
                          className={cn(
                            "px-1.5 py-0.5 rounded text-[10px] font-medium",
                            suggestionMeta.cls,
                          )}
                          title={entry.suggestionDetail}
                        >
                          {suggestionMeta.label}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
                        {entry.reason}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void actPending(entry, "resume")}
                          className={recBtnClass("resume")}
                        >
                          恢复跟踪
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void actPending(entry, "pause")}
                          className={recBtnClass("pause")}
                          title={
                            recommended === "pause"
                              ? "推荐动作"
                              : undefined
                          }
                        >
                          {entry.state === "paused" ? "保持暂停" : "暂停"}
                          {recommended === "pause" && "（推荐）"}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void actPending(entry, "copy-gap")}
                          className={recBtnClass("copy-gap")}
                          title="暂停该平台，并把关键词列入下版文案素材（文案缺口）"
                        >
                          暂停并列入文案缺口
                          {recommended === "copy-gap" && "（推荐）"}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void actPending(entry, "remove")}
                          className={recBtnClass("remove")}
                        >
                          移除（无关）{recommended === "remove" && "（推荐）"}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      <CurationDialog
        curation={curation}
        curationOpen={curationOpen}
        curationConfirm={curationConfirm}
        budgetHint={`采集预算：每日 ${rankBudget.dailyInstances}/${rankBudget.hardLimit} 实例 · 剩余可采纳 ${rankBudget.remaining}（超限建议确认时会被自动裁剪）`}
        onApply={(resolved) => void applyCuration(resolved)}
        onDiscard={() => discardCuration()}
        onSetConfirm={setCurationConfirm}
      />
    </div>
  );
}

/* ── Settings Page (沿用，Phase A 暂不动) ── */
