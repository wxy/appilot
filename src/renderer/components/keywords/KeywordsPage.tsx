import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { storefrontDisplayName, storefrontsForLanguage } from "../../../engine/storefronts";
import { languageLabel, UI_SOURCE_LANGUAGE } from "../../lib/format";
import {
  matrixCellState,
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
import { CurationDialog } from "./CurationDialog";
import type { KeywordGeneration, KeywordSuggestion } from "./keywordTypes";
import { ChartTick, MatrixCellView, RankTooltip } from "./matrix";
import { CompetitorPanel } from "./CompetitorPanel";

export function KeywordsPage() {
  const { projects, currentProjectId, currentProductId, updateTrackedKeywords, removeTrackedKeyword, restoreTrackedKeyword, resumePausedKeyword, clearRemovedKeywords } = useProject();
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
    removals: { keyword: string; reason: string; choice: "accept" | "ignore" }[];
    adds: (KeywordSuggestion & { choice: "accept" | "ignore" })[];
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
  const [candidatesAdding, setCandidatesAdding] = useState(false);
  const [viewLang, setViewLang] = useState<string>("");
  const [loadingLangs, setLoadingLangs] = useState<Set<string>>(new Set());
  const [keywordProgress, setKeywordProgress] = useState<
    Record<string, { chars: number; phase: "reasoning" | "content" }>
  >({});
  const [showPaused, setShowPaused] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [matrixTab, setMatrixTab] = useState<"ranked" | "unranked">("ranked");
  const [enScope, setEnScope] = useState<"en" | "global">("en");
  const pausedPopoverRef = useRef<HTMLSpanElement>(null);
  const deletedPopoverRef = useRef<HTMLSpanElement>(null);

  // Close keyword popovers when clicking anywhere outside them.
  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const inside = [pausedPopoverRef, deletedPopoverRef].some(
        (ref) => ref.current?.contains(target),
      );
      if (!inside) {
        setShowPaused(false);
        setShowDeleted(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);
  const [error, setError] = useState("");
  const [selectedKeyword, setSelectedKeyword] = useState<string>("");
  const [schedulerStatus, setSchedulerStatus] = useState<{ enabled: boolean; total: number; due: number; failed: number; nextDueAt: string | null } | null>(null);
  const [runningDue, setRunningDue] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const urlKeyword = searchParams.get("keyword") || "";
  const urlLang = searchParams.get("lang") || "";
  const urlScope = searchParams.get("scope") || "";

  const languages = product?.supportedLanguages || [];
  const languageOptions = trackingLanguageOptions(languages);
  const activeViewLang = litLangs.includes(viewLang) ? viewLang : litLangs[0] || "";

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

  useEffect(() => {
    if (litLangs.length > 0 && !litLangs.includes(viewLang)) {
      setViewLang(litLangs[0] || "");
    }
  }, [litLangs, viewLang]);

  // Apply navigation params from the overview page: locate a keyword in a
  // language view, and/or narrow the matrix scope.
  useEffect(() => {
    if (!product) return;
    if (urlLang && languageOptions.some((option) => option.code === urlLang)) {
      setViewLang(urlLang);
      setLitLangs((prev) => (prev.includes(urlLang) ? prev : [...prev, urlLang]));
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

  const currentLang = activeViewLang;
  const queryLanguages = currentLang === "en" ? ["en"] : [currentLang, "en"];
  const tracked = (project.trackedKeywords || []).filter((k) => queryLanguages.includes(k.language));
  const trackedActive = tracked.filter((k) => k.status !== "paused");
  const pausedForCurrent = tracked.filter(
    (k) => k.status === "paused" || (k.pausedPlatforms || []).includes(product.platform),
  );
  const removedForCurrent = (project.removedKeywords || []).filter((item) => queryLanguages.includes(item.language));
  const storefronts =
    currentLang === "en" && enScope === "global"
      ? Array.from(
          new Set(
            (product?.supportedLanguages || []).flatMap((lang) =>
              storefrontsForLanguage(lang.code),
            ),
          ),
        )
      : storefrontsForLanguage(currentLang);
  const rankSnapshots = product.rankSnapshots || [];
  const matrixRows = matrixFilterKeywords(trackedActive, currentLang);
  const matrixColumns = storefronts.map((storefront) => ({
    storefront,
    meta: matrixColumnMeta(rankSnapshots, storefront),
  }));
  const matrixGridTemplate = `minmax(240px, 3fr) repeat(${matrixColumns.length}, minmax(68px, 0.9fr)) 44px`;
  const { ranked, unranked } = matrixRowGroups(matrixRows, matrixColumns, rankSnapshots);
  const scopeFilteredRanked =
    urlScope === "top10" ? ranked.filter((item) => item.bestRank <= 10) : ranked;
  const showUnrankedRows =
    matrixTab === "unranked" ||
    (matrixTab === "ranked" && !urlScope && scopeFilteredRanked.length === 0);
  const activeMatrixTab = showUnrankedRows ? "unranked" : matrixTab;
  const chartKeyword = matrixRows.some((keyword) => keyword.keyword === selectedKeyword)
    ? selectedKeyword
    : (ranked[0]?.row.keyword || trackedActive[0]?.keyword || "");
  const chartSnapshots = rankSnapshots
    .filter(
      (snapshot) =>
        queryLanguages.includes(snapshot.language) &&
        storefronts.includes(snapshot.storefront) &&
        snapshot.keyword === chartKeyword,
    )
    .sort((a, b) => new Date(a.checkedAt).getTime() - new Date(b.checkedAt).getTime());
  const chartSeriesMeta = Array.from(
    new Map(chartSnapshots.map((s) => [s.storefront, s.storefront])).keys(),
  ).map((storefront) => ({ storefront, label: storefrontDisplayName(storefront) }));
  // Merge all storefronts onto a shared timeline bucketed by hour: each row
  // holds the latest rank per storefront within that hour, so lines connect
  // and the tooltip can list several storefronts collected in the same hour.
  const chartData = (() => {
    const byTime = new Map<string, Record<string, any>>();
    const hourKey = (iso: string) => {
      const date = new Date(iso);
      date.setMinutes(0, 0, 0);
      return date.toISOString();
    };
    for (const snapshot of chartSnapshots) {
      if (snapshot.rank == null) continue;
      const time = hourKey(snapshot.checkedAt);
      const row = byTime.get(time) || { time };
      row[snapshot.storefront] = snapshot.rank;
      byTime.set(time, row);
    }
    return [...byTime.values()].sort(
      (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
    );
  })();
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

  const formatColumnTime = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const acceptedAdds = Object.values(curation).reduce(
    (sum, data) => sum + data.adds.filter((item) => item.choice === "accept").length,
    0,
  );
  const acceptedRemovals = Object.values(curation).reduce(
    (sum, data) => sum + data.removals.filter((item) => item.choice === "accept").length,
    0,
  );
  const ignoredCount = Object.values(curation).reduce(
    (sum, data) =>
      sum +
      data.adds.filter((item) => item.choice === "ignore").length +
      data.removals.filter((item) => item.choice === "ignore").length,
    0,
  );
  const activeProgress = keywordProgress[currentLang];
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

  const renderMatrixRow = (
    keyword: (typeof matrixRows)[number],
    dimmed: boolean,
    applied?: "add" | "remove" | null,
  ) => (
    <div
      key={`${keyword.language}:${keyword.keyword}`}
      data-keyword={keyword.keyword}
      data-language={keyword.language}
      onClick={() => {
        setSelectedKeyword(keyword.keyword);
        const next = new URLSearchParams(searchParams);
        next.set("keyword", keyword.keyword);
        next.set("lang", currentLang);
        setSearchParams(next, { replace: true });
      }}
      className={cn(
        "grid items-center border-b border-zinc-100 dark:border-zinc-800 last:border-b-0 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors",
        dimmed && "opacity-55",
        !dimmed && "bg-emerald-50/30 dark:bg-emerald-500/[0.04]",
        keyword.keyword === chartKeyword && "bg-amber-50/40 dark:bg-amber-500/5",
      )}
      style={{ gridTemplateColumns: matrixGridTemplate }}
    >
      <div className="py-1.5 pl-5 pr-4 min-w-0 sticky left-0 z-10 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800">
        <div
          className={cn(
            "font-mono text-sm truncate",
            dimmed ? "text-zinc-400 dark:text-zinc-500" : "text-zinc-800 dark:text-zinc-200",
            applied === "remove" && "line-through",
          )}
          title={keyword.rationale ? `${keyword.keyword} — ${keyword.rationale}` : keyword.keyword}
        >
          {keyword.keyword}
          {keyword.language === "en" && (
            <span className="ml-1.5 inline-flex px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[10px] font-sans font-medium text-zinc-500 dark:text-zinc-400 align-middle">
              全局
            </span>
          )}
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
        </div>
      </div>
      {matrixColumns.map((column) => {
        const cell = matrixCellState(rankSnapshots, keyword.keyword, column.storefront);
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
      <div className="pl-3 pr-5 py-1.5 text-right border-l border-zinc-100 dark:border-zinc-800">
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            removeTracked(keyword.keyword, keyword.language);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              removeTracked(keyword.keyword, keyword.language);
            }
          }}
          className="text-zinc-400 hover:text-red-500 text-xs cursor-pointer"
          title="移除"
        >
          ✕
        </span>
      </div>
    </div>
  );

  const generateOne = async (lang: string): Promise<{ lang: string; gen: KeywordGeneration | null }> => {
    try {
      const gen: KeywordGeneration = await (window as any).appilot.projects.generateKeywords(product.id, lang);
      return { lang, gen };
    } catch (e: any) {
      setError(e.message || "关键词生成失败。请先在设置里配置 AI。");
      return { lang, gen: null };
    }
  };

  const applyGenerations = async (results: { lang: string; gen: KeywordGeneration | null }[]) => {
    const latestProject = useProject.getState().projects.find((p) => p.id === currentProjectId);
    const latest = latestProject || project;
    let trackedNext = [...(latest.trackedKeywords || [])];

    for (const r of results) {
      if (!r.gen) continue;
      const existingKeys = new Set(trackedNext.map((k) => `${k.language}\u0000${k.keyword}`));
      const removedKeys = new Set(
        (latestProject?.removedKeywords || []).map((item) => `${item.language}\u0000${item.keyword}`),
      );
      const additions = r.gen.tracking
        .filter((s) => {
          const lang = s.language || r.lang;
          return !existingKeys.has(`${lang}\u0000${s.keyword}`) && !removedKeys.has(`${lang}\u0000${s.keyword}`);
        })
        .map((s) => ({
          language: s.language || r.lang,
          keyword: s.keyword,
          rationale: s.rationale,
          translation: s.translation || "",
        }));
      trackedNext = [...trackedNext, ...additions];
    }

    if (results.some((r) => r.gen)) {
      await (window as any).appilot.projects.saveTrackedKeywords(product.id, trackedNext);
      updateTrackedKeywords(product.id, trackedNext);
    }
  };

  const handleGenerateAll = async () => {
    setError("");
    setKeywordProgress({});
    if (litLangs.length === 0) {
      setError("请先点亮至少一个语言（点 ★ 参与生成）。");
      return;
    }
    const nextCuration: Record<string, any> = {};
    setLoadingLangs(new Set(litLangs));
    for (const lang of litLangs) {
    const tracked = project.trackedKeywords || [];
    const hasKeywords = tracked.some((k) => k.language === lang);
    if (!hasKeywords) {
      const result = await generateOne(lang);
      await applyGenerations([result]);
    } else {
      try {
        const result = await (window as any).appilot.projects.curateKeywords(product.id, lang);
        nextCuration[lang] = {
          removals: (result.removals || []).map((item: any) => ({ ...item, choice: "accept" })),
          adds: (result.adds || []).map((item: any) => ({ ...item, choice: "accept" })),
        };
      } catch (e: any) {
        setError(e.message || "关键词整理失败。");
      }
    }
    }
    setCuration((prev) => ({ ...prev, ...nextCuration }));
    setCurationOpen(Object.keys(nextCuration).length > 0);
    setCurationConfirm(null);
    setLoadingLangs(new Set());
    setKeywordProgress({});
  };

  const setItemChoice = (
    lang: string,
    key: "removals" | "adds",
    keyword: string,
    choice: "accept" | "ignore",
  ) => {
    setCuration((prev) => {
      const langData = prev[lang];
      if (!langData) return prev;
      return {
        ...prev,
        [lang]: {
          ...langData,
          [key]: langData[key].map((item) =>
            item.keyword === keyword ? { ...item, choice } : item,
          ),
        },
      };
    });
  };

  const selectAllCuration = (choice: "accept" | "ignore") => {
    setCuration((prev) => {
      const next: Record<string, any> = {};
      for (const [lang, data] of Object.entries(prev)) {
        next[lang] = {
          removals: data.removals.map((item) => ({ ...item, choice })),
          adds: data.adds.map((item) => ({ ...item, choice })),
        };
      }
      return next;
    });
  };

  const applyCuration = async () => {
    setCurationConfirm(null);
    for (const [lang, data] of Object.entries(curation)) {
      for (const item of data.adds) {
        if (item.choice !== "accept") continue;
        const latest = useProject.getState().projects.find((p) => p.id === currentProjectId);
        const current = latest || project;
        const existingKeys = new Set(
          (current.trackedKeywords || []).map((k) => `${k.language}\u0000${k.keyword}`),
        );
        if (existingKeys.has(`${lang}\u0000${item.keyword}`)) continue;
        const next = [
          ...(current.trackedKeywords || []),
          {
            language: lang,
            keyword: item.keyword,
            rationale: item.rationale,
            translation: item.translation || "",
            status: "active" as const,
            source: "ai" as const,
          },
        ];
        await (window as any).appilot.projects.saveTrackedKeywords(product.id, next);
        updateTrackedKeywords(product.id, next);
      }
      for (const item of data.removals) {
        if (item.choice === "accept") {
          await removeTracked(item.keyword, lang);
        }
      }
    }
    setCuration({});
    setCurationOpen(false);
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
    setCandidatesLoading(true);
    setSubmissionProgress(null);
    setRemovedCandidateKeys(new Set());
    setError("");
    try {
      const result = await (window as any).appilot.projects.extractSubmissionCandidates(product.id, currentLang);
      setCandidates(result?.candidates || []);
    } catch (e: any) {
      setError(e.message || "候选词抽取失败。");
    } finally {
      setCandidatesLoading(false);
      setSubmissionProgress(null);
    }
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
    setCandidatesAdding(true);
    try {
      const next = [
        ...(current.trackedKeywords || []),
        ...toAdd.map((candidate) => ({
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
      const addedKeywords = new Set(toAdd.map((candidate) => candidate.keyword));
      setCandidates((prev) => prev.filter((candidate) => !addedKeywords.has(candidate.keyword)));
      setRemovedCandidateKeys(new Set());
    } catch (e: any) {
      setError(e.message || "一键加入失败。");
    } finally {
      setCandidatesAdding(false);
    }
  };

  const removeTracked = async (kw: string, language: string) => {
    await removeTrackedKeyword(product.id, language, kw);
  };

  const restoreTracked = async (language: string, kw: string) => {
    await restoreTrackedKeyword(product.id, language, kw);
  };

  const clearRemoved = async () => {
    await clearRemovedKeywords(product.id, queryLanguages);
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
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
                            onClick={extractCandidates}
                            disabled={!submissionRef}
                            loading={candidatesLoading}
                            progress={submissionProgress}
                            idleLabel="抽取候选词"
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
                    onClick={handleGenerateAll}
                    loading={loadingLangs.size > 0}
                    progress={activeProgress}
                    idleLabel="为所选语言生成 / 整理"
                  />
                </div>
              </div>
              <p className="mt-3 text-[11px] font-medium tracking-wider text-zinc-400 dark:text-zinc-500">
                语言（点击切换查看；点 ★ 点亮/取消点亮，点亮语言参与生成）
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {languageOptions.map((option) => {
                  const lit = litLangs.includes(option.code);
                  const active = option.code === currentLang;
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
                        onClick={() => {
                          setViewLang(option.code);
                          setLitLangs((prev) => (prev.includes(option.code) ? prev : [...prev, option.code]));
                        }}
                        title={active ? "当前查看" : "点击查看该语言"}
                        className={cn(
                          "px-3 py-1.5 text-sm transition-colors",
                          active ? "font-medium" : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
                        )}
                      >
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

            </div>

            <div className="flex-1 min-h-0 overflow-auto [scrollbar-gutter:stable]">
            <div
              className="grid items-start border-b border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 sticky top-0 z-20"
              style={{ gridTemplateColumns: matrixGridTemplate }}
            >
              <div className="py-2.5 pl-5 pr-4 sticky left-0 z-30 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                      关键词（{trackedActive.length}）
                    </span>
                    <div className="flex items-center rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
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
                    {currentLang === "en" && (
                      <div className="flex items-center rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setEnScope("en")}
                          className={cn(
                            "px-2 py-0.5 text-[10px] font-medium transition-colors",
                            enScope === "en"
                              ? "bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-400"
                              : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800",
                          )}
                        >
                          英文商店
                        </button>
                        <button
                          type="button"
                          onClick={() => setEnScope("global")}
                          className={cn(
                            "px-2 py-0.5 text-[10px] font-medium transition-colors border-l border-zinc-200 dark:border-zinc-700",
                            enScope === "global"
                              ? "bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-400"
                              : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800",
                          )}
                        >
                          全局商店
                        </button>
                      </div>
                    )}
                  </div>
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
                  {(pausedForCurrent.length > 0 || removedForCurrent.length > 0 || unranked.length > 0) && (
                    <span className="flex items-center gap-1.5">
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
                                      onClick={() => resumePausedKeyword(product.id, item.language, item.keyword)}
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
                      {removedForCurrent.length > 0 && (
                        <span className="relative" ref={deletedPopoverRef}>
                          <button
                            type="button"
                            onClick={() => setShowDeleted((v) => !v)}
                            className={cn(
                              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors",
                              showDeleted
                                ? "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400"
                                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700",
                            )}
                          >
                            已删除 {removedForCurrent.length}
                          </button>
                          {showDeleted && (
                            <div className="absolute right-0 top-full mt-1.5 z-30 w-80 max-h-72 overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg p-3">
                              <div className="flex items-center justify-between mb-1.5">
                                <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                                  已删除（手动）
                                </p>
                                <button onClick={clearRemoved} className="text-[10px] text-zinc-400 hover:text-red-500">
                                  清空
                                </button>
                              </div>
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
                                      title="恢复"
                                    >
                                      恢复
                                    </button>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </span>
                      )}
                    </span>
                  )}
                </div>
                {schedulerStatus && (
                  <span className="mt-0.5 flex items-center gap-2 text-[10px] font-normal text-zinc-400 dark:text-zinc-500">
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
              </div>
              {matrixColumns.map((column) => (
                <div
                  key={column.storefront}
                  className={cn(
                    "px-3 py-2 text-right border-l border-zinc-100 dark:border-zinc-800",
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
              <div className="pl-3 pr-5 py-2 text-right border-l border-zinc-100 dark:border-zinc-800 text-xs font-medium text-zinc-400 dark:text-zinc-500">
                操作
              </div>
            </div>

                {matrixRows.length === 0 ? (
                  <p className="text-sm text-zinc-400 dark:text-zinc-500 py-4 text-center">
                    暂无关键词，点击「为所选语言生成」。
                  </p>
                ) : showUnrankedRows ? (
                  unranked.length > 0 ? (
                    unranked.map((row) => renderMatrixRow(row, true))
                  ) : (
                    <p className="text-sm text-zinc-400 dark:text-zinc-500 py-4 text-center">
                      该筛选范围内暂无关键词。
                    </p>
                  )
                ) : scopeFilteredRanked.length > 0 ? (
                  scopeFilteredRanked.map(({ row }) => renderMatrixRow(row, false))
                ) : (
                  <p className="text-sm text-zinc-400 dark:text-zinc-500 py-4 text-center">
                    该筛选范围内暂无关键词。
                  </p>
                )}
            </div>

            </div>

            <div className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm px-5 pt-5 pb-5 space-y-5">
                {chartKeyword && chartData.length > 0 && (
                  <div>
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.18)" />
                          <XAxis
                            dataKey="time"
                            tick={<ChartTick />}
                            tickLine={false}
                            axisLine={false}
                            minTickGap={28}
                            height={52}
                          />
                          <YAxis
                            reversed
                            domain={[1, "dataMax"]}
                            allowDecimals={false}
                            ticks={chartTicks}
                            tick={{ fontSize: 11 }}
                            tickMargin={8}
                            tickLine={false}
                            axisLine={false}
                            width={34}
                          />
                          <Tooltip content={<RankTooltip />} />
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
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <h4 className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        {chartKeyword} · 排名趋势（{chartSeriesMeta.length} 个商店）
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
                    </div>
                  </div>
                )}

            </div>

        </>
      )}

      <CurationDialog
        curation={curation}
        curationOpen={curationOpen}
        acceptedAdds={acceptedAdds}
        acceptedRemovals={acceptedRemovals}
        ignoredCount={ignoredCount}
        curationConfirm={curationConfirm}
        onItemChoice={(lang, kind, keyword, choice) =>
          setItemChoice(lang, kind, keyword, choice)
        }
        onApply={() => applyCuration()}
        onDiscard={() => discardCuration()}
        onSelectAll={(choice) => selectAllCuration(choice)}
        onSetConfirm={setCurationConfirm}
      />

      {project && product && (
        <CompetitorPanel
          projectId={project.id}
          product={{ platform: product.platform, supportedLanguages: product.supportedLanguages }}
          defaultTerm={selectedKeyword || ""}
          viewLang={currentLang}
        />
      )}
    </div>
  );
}

/* ── Settings Page (沿用，Phase A 暂不动) ── */
