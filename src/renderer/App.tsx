import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { Routes, Route, Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { useTheme } from "./stores/theme";
import { useProject, type RankSnapshot } from "./stores/project";
import { cn } from "./lib/utils";
import {
  STALE_MS,
  matrixCellState,
  matrixColumnMeta,
  matrixFilterKeywords,
  matrixRowGroups,
  trackingLanguageOptions,
  type MatrixCell,
} from "./lib/matrix";
import { storefrontDisplayName, storefrontsForLanguage } from "../engine/storefronts";
import { briefRuleSignals } from "./lib/overview-brief";
import type { BriefSuggestion } from "../engine/ai/overview-brief";
import { summarizeChanges, CHANGE_TYPE_META } from "./lib/release-summary";
import type { ChangeSummaryItem } from "./lib/release-summary";

/* ── Layout ── */

const NAV_ITEMS = [
  { to: "/overview", label: "总览", title: "总览" },
  { to: "/release", label: "发布", title: "发布工作台" },
  { to: "/keywords", label: "排名", title: "关键词排名" },
  { to: "/reviews", label: "评论", title: "评论" },
  { to: "/trend", label: "趋势", title: "长期效果" },
];

const LANGUAGE_LABELS: Record<string, string> = {
  en: "英文",
  de: "德文",
  fr: "法文",
  es: "西班牙文",
  it: "意大利文",
  nl: "荷兰文",
  pt: "葡萄牙文",
  "pt-BR": "巴西葡萄牙文",
  ja: "日文",
  ko: "韩文",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁体中文",
  ru: "俄文",
};

const UI_SOURCE_LANGUAGE = "zh-Hans";

function languageLabel(code: string): string {
  return LANGUAGE_LABELS[code] || code;
}

function platformLabel(platform: string): string {
  if (platform === "ios") return "iOS";
  if (platform === "macos") return "macOS";
  return "未识别";
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function formatHumanTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const target = new Date(iso);
  const now = new Date();
  const diffMs = target.getTime() - now.getTime();
  const absMs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (absMs < minute) return diffMs >= 0 ? "即将" : "刚刚";
  if (absMs < hour) {
    const count = Math.round(absMs / minute);
    return diffMs >= 0 ? `${count} 分钟后` : `${count} 分钟前`;
  }
  if (absMs < day) {
    const count = Math.round(absMs / hour);
    return diffMs >= 0 ? `${count} 小时后` : `${count} 小时前`;
  }

  const dayDiff = Math.round((startOfDay(target) - startOfDay(now)) / day);
  if (dayDiff === 1) return "明天";
  if (dayDiff === 2) return "后天";
  if (dayDiff === -1) return "昨天";
  if (dayDiff === -2) return "前天";
  if (dayDiff > 2 && dayDiff <= 7) return `${dayDiff} 天后`;
  if (dayDiff < -2 && dayDiff >= -7) return `${Math.abs(dayDiff)} 天前`;

  const monthDiff =
    (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());
  if (monthDiff === 1) return "下个月";
  if (monthDiff === -1) return "上个月";
  if (monthDiff > 1) return `${monthDiff} 个月后`;
  if (monthDiff < -1) return `${Math.abs(monthDiff)} 个月前`;

  return target.toLocaleDateString();
}

function Layout({ children }: { children: React.ReactNode }) {
  const { projects, currentProjectId, currentProductId, loading, load, select, selectProduct, addByFolder } = useProject();
  const location = useLocation();
  const [aiUsage, setAiUsage] = useState<{ totalTokens: number; cachedTokens: number } | null>(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => useTheme.getState().syncFromSystem();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const refresh = () => {
      (window as any).appilot?.stats?.aiUsage()
        .then((u: any) =>
          setAiUsage({
            totalTokens: u?.totalTokens ?? 0,
            cachedTokens: u?.cachedTokens ?? 0,
          }),
        )
        .catch(() => setAiUsage(null));
    };
    refresh();
    const timer = setInterval(refresh, 30_000);
    return () => clearInterval(timer);
  }, []);

  // Close dropdowns when clicking outside.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setProjectMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const handleAddProject = async () => {
    setProjectMenuOpen(false);
    const folder = await (window as any).appilot?.dialog?.selectFolder();
    if (folder) await addByFolder(folder);
  };

  const currentProject = projects.find((p) => p.id === currentProjectId) || null;
  const currentProduct = currentProject?.storeProducts?.find((product) => product.id === currentProductId)
    || currentProject?.storeProducts?.[0]
    || null;
  const currentProjectLabel = currentProject
    ? currentProject.storeProducts.length > 1 && currentProduct
      ? `${currentProject.name} · ${platformLabel(currentProduct.platform)}`
      : currentProject.name
    : "选择项目";

  return (
    <div className="flex flex-col h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Top bar */}
      <header className="shrink-0 z-30 flex items-center gap-2.5 px-4 h-14 border-b border-zinc-200/60 dark:border-zinc-800/60 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl">
        {/* Brand */}
        <Link to="/" className="flex items-center gap-2 shrink-0 pr-1" title="返回首页">
          <img src="./icon.png" alt="Appilot" className="w-8 h-8 rounded-lg object-cover" />
          <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Appilot</span>
        </Link>

        {/* Project switcher */}
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setProjectMenuOpen((v) => !v)}
            className="flex items-center gap-2 pl-3 pr-2.5 h-9 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white/70 dark:bg-zinc-900/70 text-zinc-700 dark:text-zinc-200 hover:border-amber-500/50 transition-colors max-w-64"
          >
            <span className="truncate">{currentProjectLabel}</span>
            <span className={cn("text-zinc-400 text-xs transition-transform", projectMenuOpen && "rotate-180")}>▾</span>
          </button>

          {projectMenuOpen && (
            <div className="absolute left-0 top-full mt-1.5 z-40 w-72 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg py-1 overflow-hidden">
              {projects.map((p) => {
                const products = p.storeProducts || [];
                if (products.length > 1) {
                  return (
                    <div key={p.id} className="py-1">
                      <div className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-zinc-600 dark:text-zinc-400">
                        <span className="text-xs text-transparent">✓</span>
                        <span className="truncate">{p.name}</span>
                      </div>
                      {products.map((product) => (
                        <button
                          key={product.id}
                          onClick={() => {
                            select(p.id);
                            selectProduct(product.id);
                            setProjectMenuOpen(false);
                          }}
                          className={cn(
                            "w-full flex items-center gap-2 pl-8 pr-3 py-1.5 text-xs text-left",
                            product.id === currentProductId
                              ? "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium"
                              : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
                          )}
                        >
                          <span className={cn("text-xs", product.id === currentProductId ? "text-amber-500" : "text-transparent")}>✓</span>
                          <span className="truncate">{platformLabel(product.platform)}</span>
                        </button>
                      ))}
                    </div>
                  );
                }

                const product = products[0];
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      select(p.id);
                      if (product) selectProduct(product.id);
                      setProjectMenuOpen(false);
                    }}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 text-sm text-left",
                      p.id === currentProjectId
                        ? "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium"
                        : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
                    )}
                  >
                    <span className={cn("text-xs", p.id === currentProjectId ? "text-amber-500" : "text-transparent")}>✓</span>
                    <span className="truncate">{p.name}</span>
                  </button>
                );
              })}
              <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
              <button
                onClick={handleAddProject}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
              >
                <span className="text-amber-500">＋</span> 添加项目
              </button>
              <Link
                to="/projects"
                onClick={() => setProjectMenuOpen(false)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
              >
                <span className="text-zinc-400">⚙</span> 管理项目
              </Link>
            </div>
          )}
        </div>

        <div className="w-px h-6 bg-zinc-200/70 dark:bg-zinc-800/70 mx-1" />

        {/* Page nav (persistent) */}
        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const active = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                title={item.title}
                className={cn(
                  "px-3 py-1.5 text-sm rounded-lg transition-colors",
                  active
                    ? "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium"
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Right: AI usage + task center + settings */}
        <div className="ml-auto flex items-center gap-2">
          <div
            className="flex items-center gap-1.5 px-2.5 h-7 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[11px] text-zinc-500 dark:text-zinc-400"
            title="AI 消耗 Token（其中缓存命中多少）"
          >
            <span className="hidden sm:inline">AI 用量</span>
            <span className="font-mono font-medium text-zinc-800 dark:text-zinc-200">
              {aiUsage === null
                ? "—"
                : `${formatTokens(aiUsage.totalTokens)} · 缓存 ${formatTokens(aiUsage.cachedTokens)}`}
            </span>
          </div>

          <Link
            to="/tasks"
            title="任务中心"
            className={cn(
              "flex items-center gap-1.5 px-2.5 h-7 rounded-full text-[11px] transition-colors",
              location.pathname === "/tasks"
                ? "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200",
            )}
          >
            <span className="text-xs">▦</span>
            <span className="hidden lg:inline">任务中心</span>
          </Link>
          <Link
            to="/settings"
            title="设置"
            className={cn(
              "flex items-center gap-1.5 px-2.5 h-7 rounded-full text-[11px] transition-colors",
              location.pathname === "/settings"
                ? "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200",
            )}
          >
            <span className="text-xs">⚙</span>
            <span className="hidden lg:inline">设置</span>
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto">
        <div className="h-full">
          {loading && projects.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-sm text-zinc-400 dark:text-zinc-500">
              <span className="w-5 h-5 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-transparent animate-spin" />
              正在载入…
            </div>
          ) : (
            children
          )}
        </div>
      </main>
    </div>
  );
}

/* ── Pages ── */

function HomePage() {
  const { projects, select, addByFolder } = useProject();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    setAdding(true);
    try {
      const folder = await (window as any).appilot?.dialog?.selectFolder();
      if (folder) {
        await addByFolder(folder);
        navigate("/overview");
      }
    } finally {
      setAdding(false);
    }
  };

  const openProject = (id: string) => {
    select(id);
    navigate("/overview");
  };

  return (
    <div className="p-10 max-w-3xl mx-auto">
      <h2 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
        欢迎回来，副驾驶待命中
      </h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        选择一个项目开始，或接入一个新的应用仓库。
      </p>

      {projects.length > 0 && (
        <div className="mt-10">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">你的项目</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => openProject(p.id)}
                className="flex items-center gap-3 px-4 py-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-left shadow-sm hover:border-amber-500/50 transition-colors"
              >
                {p.artworkUrl ? (
                  <img
                    src={p.artworkUrl}
                    alt=""
                    className="w-10 h-10 rounded-xl border border-zinc-200 dark:border-zinc-800 object-cover shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center shrink-0">
                    <span className="text-amber-500">⌖</span>
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                    {p.trackName || p.name}
                  </p>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate mt-0.5">
                    {(p.storeProducts || []).map((product) =>
                      product.platform === "ios" ? "iOS" : product.platform === "macos" ? "macOS" : "未识别",
                    ).join(" · ") || "未识别"}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-10 rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 p-10 text-center">
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
          接入一个本地应用仓库，让副驾驶识别产品并建立基础档案。
        </p>
        <button onClick={handleAdd} disabled={adding} className={btnPrimary}>
          {adding ? "正在分析..." : "＋ 添加项目"}
        </button>
      </div>
    </div>
  );
}

interface OverviewRankRow {
  keyword: string;
  language: string;
  bestRank: number;
  storefront: string;
  trend: "up" | "down" | "same" | "new";
  delta: number | null;
  checkedAt: string | null;
  stale: boolean;
}

/**
 * Per-keyword rank summary across every storefront: the best *current* rank
 * (latest snapshot per storefront), the storefront it was achieved in, and
 * the trend vs. that storefront's previous snapshot.
 */
function overviewRankRows(
  keywords: { keyword: string; language: string }[],
  snapshots: RankSnapshot[],
): OverviewRankRow[] {
  const rows: OverviewRankRow[] = [];
  for (const keyword of keywords) {
    const own = snapshots
      .filter((s) => s.keyword === keyword.keyword && s.language === keyword.language)
      .sort((a, b) => new Date(a.checkedAt).getTime() - new Date(b.checkedAt).getTime());
    const byStorefront = new Map<string, RankSnapshot[]>();
    for (const snapshot of own) {
      const list = byStorefront.get(snapshot.storefront) || [];
      list.push(snapshot);
      byStorefront.set(snapshot.storefront, list);
    }
    let bestRank: number | null = null;
    let bestStorefront = "";
    let bestTrend: OverviewRankRow["trend"] = "same";
    let bestDelta: number | null = null;
    let bestCheckedAt: string | null = null;
    for (const [storefront, list] of byStorefront) {
      const latest = list[list.length - 1];
      if (latest.rank == null) continue;
      if (bestRank !== null && latest.rank >= bestRank) continue;
      const previous = list[list.length - 2];
      bestRank = latest.rank;
      bestStorefront = storefront;
      bestCheckedAt = latest.checkedAt;
      if (!previous || previous.rank == null) {
        bestTrend = "new";
        bestDelta = null;
      } else {
        bestDelta = previous.rank - latest.rank;
        bestTrend = bestDelta > 0 ? "up" : bestDelta < 0 ? "down" : "same";
      }
    }
    if (bestRank !== null) {
      rows.push({
        keyword: keyword.keyword,
        language: keyword.language,
        bestRank,
        storefront: bestStorefront,
        trend: bestTrend,
        delta: bestDelta,
        checkedAt: bestCheckedAt,
        stale: bestCheckedAt ? Date.now() - new Date(bestCheckedAt).getTime() > STALE_MS : true,
      });
    }
  }
  rows.sort((a, b) => a.bestRank - b.bestRank);
  return rows;
}

const OVERVIEW_CHART_DAYS = 14;
const OVERVIEW_CHART_COLORS = ["#f59e0b", "#3b82f6", "#10b981", "#8b5cf6", "#ef4444"];
const STORE_STATUS_META: Record<
  string,
  { label: string; tone: "muted" | "amber" | "emerald" | "red" | "blue" }
> = {
  prepared: { label: "未提交", tone: "muted" },
  copied: { label: "已复制", tone: "blue" },
  submitted: { label: "已提交", tone: "blue" },
  in_review: { label: "审核中", tone: "amber" },
  rejected: { label: "被驳回", tone: "red" },
  released: { label: "已发布", tone: "emerald" },
};

function StatusChip({
  label,
  tone,
}: {
  label: string;
  tone: "muted" | "amber" | "emerald" | "red" | "blue";
}) {
  const tones: Record<string, string> = {
    muted: "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400",
    amber: "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400",
    emerald: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    red: "bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400",
    blue: "bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-400",
  };
  return (
    <span
      className={cn(
        "shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium",
        tones[tone],
      )}
    >
      {label}
    </span>
  );
}

function localDayKey(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Best rank per day (last 14 days) for the top ranked keywords, as chart series. */
function overviewTrendData(
  rows: OverviewRankRow[],
  snapshots: RankSnapshot[],
  days = OVERVIEW_CHART_DAYS,
): { series: { key: string; label: string }[]; data: Record<string, string | number>[] } {
  const top = rows.slice(0, OVERVIEW_CHART_COLORS.length);
  const series = top.map((row) => ({
    key: `${row.language}\u0000${row.keyword}`,
    label: row.keyword,
  }));
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const byDay = new Map<string, Record<string, string | number>>();
  for (const row of top) {
    const key = `${row.language}\u0000${row.keyword}`;
    const bestPerDay = new Map<string, number>();
    for (const snapshot of snapshots) {
      if (
        snapshot.keyword !== row.keyword ||
        snapshot.language !== row.language ||
        snapshot.rank == null ||
        new Date(snapshot.checkedAt).getTime() < cutoff
      ) {
        continue;
      }
      const day = localDayKey(snapshot.checkedAt);
      const current = bestPerDay.get(day);
      if (current === undefined || snapshot.rank < current) bestPerDay.set(day, snapshot.rank);
    }
    for (const [day, rank] of bestPerDay) {
      const point = byDay.get(day) || { day };
      point[key] = rank;
      byDay.set(day, point);
    }
  }
  const data = [...byDay.values()].sort((a, b) => String(a.day).localeCompare(String(b.day)));
  return { series, data };
}

function MetricBlock({
  to,
  label,
  value,
  sub,
  warn,
  highlight,
}: {
  to: string;
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
  highlight?: boolean;
}) {
  return (
    <Link
      to={to}
      title={`查看${label}`}
      className={cn(
        "block rounded-2xl border px-4 py-3 bg-white dark:bg-zinc-900 shadow-sm transition-colors hover:border-amber-500/50",
        warn
          ? "border-amber-300/70 dark:border-amber-500/30"
          : "border-zinc-200 dark:border-zinc-800",
      )}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-xl font-mono font-semibold leading-none",
          highlight || warn
            ? "text-amber-600 dark:text-amber-400"
            : "text-zinc-900 dark:text-zinc-100",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500 truncate">{sub}</p>}
    </Link>
  );
}

function OverviewPage() {
  const { projects, currentProjectId, currentProductId, selectProduct, recordBriefAction } = useProject();
  const navigate = useNavigate();
  const project = projects.find((p) => p.id === currentProjectId);
  const product = project?.storeProducts?.find((item) => item.id === currentProductId) || project?.storeProducts?.[0] || null;
  const [releaseOverview, setReleaseOverview] = useState<{
    draft: { name: string | null; tag: string; publishedAt: string; commitCount: number } | null;
    submission: any | null;
  } | null>(null);
  const [chartDays, setChartDays] = useState(OVERVIEW_CHART_DAYS);
  const [briefState, setBriefState] = useState<{
    status: "idle" | "loading" | "ready" | "error";
    suggestions: BriefSuggestion[];
    progress: { chars: number; phase: "reasoning" | "content" } | null;
    error: string;
  }>({ status: "idle", suggestions: [], progress: null, error: "" });

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    setReleaseOverview(null);
    (window as any).appilot?.release?.list(project.id)
      .then((result: any) => {
        if (cancelled) return;
        const latest = result?.latestDraft || null;
        const release = (result?.releases || [])[0] || null;
        const submission =
          (release?.submissionDrafts || []).find(
            (item: any) => item?.productId === product?.id,
          ) || null;
        setReleaseOverview(
          latest
            ? {
                draft: {
                  name: latest.name,
                  tag: latest.tag,
                  publishedAt: latest.publishedAt,
                  commitCount: Array.isArray(latest.material?.commits)
                    ? latest.material.commits.length
                    : 0,
                },
                submission,
              }
            : null,
        );
      })
      .catch(() => {
        if (!cancelled) setReleaseOverview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [project?.id, product?.id]);

  if (!project || !product) {
    return (
      <EmptyState
        title="还没有项目"
        desc="添加一个项目，副驾驶帮你看路。"
      />
    );
  }

  const languages = product.supportedLanguages || [];
  const storeLinks = product.storeLinks || [];
  const trackedKeywords = project.trackedKeywords || [];
  const trackedActive = trackedKeywords.filter((k) => k.status !== "paused");
  const pausedCount = trackedKeywords.length - trackedActive.length;
  const rankSnapshots = product.rankSnapshots || [];
  const rankRows = overviewRankRows(trackedActive, rankSnapshots);
  const top10Count = rankRows.filter((row) => row.bestRank <= 10).length;
  const bestRankNow = rankRows[0]?.bestRank ?? null;
  const newestSnapshot = rankSnapshots.reduce<RankSnapshot | null>(
    (latest, snapshot) =>
      !latest || new Date(snapshot.checkedAt).getTime() > new Date(latest.checkedAt).getTime()
        ? snapshot
        : latest,
    null,
  );
  const newestCheckedAt = newestSnapshot?.checkedAt || null;
  const dataStale = newestCheckedAt ? Date.now() - new Date(newestCheckedAt).getTime() > STALE_MS : false;
  const { series: chartSeries, data: chartData } = overviewTrendData(rankRows, rankSnapshots, chartDays);
  const repoGithubUrl = project.repo?.githubUrl || null;
  const releaseDraft = releaseOverview?.draft ?? null;
  const submissionDraft = releaseOverview?.submission ?? null;
  const submissionLanguages = submissionDraft ? localizationList(submissionDraft) : [];
  const generatedLanguageCount = submissionLanguages.filter((loc: any) =>
    [loc.name, loc.subtitle, loc.promotionalText, loc.description, loc.whatsNew, loc.keywords]
      .some((value) => value && String(value).trim()),
  ).length;
  const languageTotal = languages.length || submissionLanguages.length;
  const confirmChip = submissionDraft
    ? submissionDraft.batchConfirmedAt
      ? ({ label: "整批已确定", tone: "emerald" } as const)
      : submissionDraft.masterConfirmedAt
        ? ({ label: "母本已确定", tone: "amber" } as const)
        : null
    : null;
  const storeChip = submissionDraft?.storeStatus
    ? STORE_STATUS_META[submissionDraft.storeStatus] || null
    : null;
  const handledBriefIds = new Set(
    (project.briefActions || []).map((item) => item.id),
  );
  const ruleSignals = briefRuleSignals({
    rankRows,
    trackedActiveCount: trackedActive.length,
    pausedCount,
    languageTotal,
    generatedLanguageCount,
  }).filter((signal) => !handledBriefIds.has(signal.id));
  const briefSuggestions = briefState.suggestions.filter(
    (item) => !handledBriefIds.has(item.id),
  );
  const showRuleSignals =
    briefState.status === "idle" || briefState.status === "error";
  const visibleBriefItems = showRuleSignals ? ruleSignals : briefSuggestions;

  const handleGenerateBrief = useCallback(async () => {
    if (!project || !product) return;
    setBriefState({ status: "loading", suggestions: [], progress: null, error: "" });
    try {
      const result = await (window as any).appilot?.projects?.generateBrief(
        project.id,
        product.id,
      );
      setBriefState({
        status: "ready",
        suggestions: result?.suggestions || [],
        progress: null,
        error: "",
      });
    } catch (err: any) {
      setBriefState({
        status: "error",
        suggestions: [],
        progress: null,
        error: err?.message || "生成失败",
      });
    }
  }, [project?.id, product?.id]);

  useEffect(() => {
    const off = (window as any).appilot?.projects?.onBriefProgress?.((progress: any) => {
      if (progress && typeof progress.chars === "number") {
        setBriefState((prev) => ({
          ...prev,
          progress: {
            chars: progress.chars,
            phase: progress.phase === "content" ? "content" : "reasoning",
          },
        }));
      }
    });
    return () => off?.();
  }, []);

  const handleBriefAction = useCallback(
    async (suggestion: BriefSuggestion, status: "adopted" | "ignored") => {
      if (!project) return;
      await recordBriefAction(project.id, {
        id: suggestion.id,
        action: suggestion.action,
        status,
      });
      if (status === "adopted") {
        if (suggestion.action === "release") {
          navigate(
            releaseDraft?.tag
              ? `/release?tag=${encodeURIComponent(releaseDraft.tag)}`
              : "/release",
          );
        } else if (suggestion.action === "trend") {
          navigate("/trend");
        } else {
          navigate(
            suggestion.target
              ? `/keywords?keyword=${encodeURIComponent(suggestion.target)}`
              : "/keywords",
          );
        }
      }
    },
    [project?.id, recordBriefAction, navigate, releaseDraft?.tag],
  );

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* App identity */}
      <div className="flex items-center gap-3 mb-5">
        {product.artworkUrl ? (
          <img
            src={product.artworkUrl}
            alt=""
            className="w-12 h-12 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm object-cover"
          />
        ) : (
          <div className="w-12 h-12 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center">
            <span className="text-amber-500 text-lg">⌖</span>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 truncate">
            {product.trackName || project.name}
          </h2>
          <div className="flex items-center gap-1 mt-0.5 text-xs font-mono text-zinc-400 dark:text-zinc-500 min-w-0">
            <button
              onClick={() => (window as any).appilot?.revealInFolder?.(project.localPath)}
              className="group flex items-center gap-1 max-w-full min-w-0 truncate hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
              title="在访达中显示"
            >
              <span className="truncate">{project.localPath}</span>
              <span className="shrink-0 opacity-60 group-hover:opacity-100">⌗</span>
            </button>
            {repoGithubUrl && (
              <>
                <span className="shrink-0">(</span>
                <button
                  onClick={() => {
                    if (repoGithubUrl) (window as any).appilot?.openExternal(repoGithubUrl);
                  }}
                  className="shrink-0 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                  title="打开 GitHub 仓库"
                >
                  GitHub
                </button>
                <span className="shrink-0">)</span>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0 min-w-0">
          <div className="flex items-center gap-1.5">
            {(project.storeProducts || []).map((item) => {
              const active = item.id === product.id;
              return (
                <button
                  key={item.id}
                  onClick={() => selectProduct(item.id)}
                  title={active ? "当前查看的平台" : `切换到 ${platformLabel(item.platform)}`}
                  className={cn(
                    "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors",
                    active
                      ? "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-1 ring-amber-500/30"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700",
                  )}
                >
                  {platformLabel(item.platform)}
                </button>
              );
            })}
            <button
              onClick={() => navigate(`/projects/${project.id}/settings`)}
              className="inline-flex items-center px-2.5 h-7 rounded-full border border-zinc-200 dark:border-zinc-700 text-[11px] text-zinc-500 dark:text-zinc-400 hover:border-amber-500/50 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
              title="仓库路径、GitHub 链接与 API 凭据"
            >
              项目设置
            </button>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
            {languages.length > 0 && (
              <span
                className="flex items-center gap-1 min-w-0"
                title={languages.map((l) => l.name).join(" · ")}
              >
                {languages.slice(0, 3).map((l) => (
                  <span
                    key={l.code}
                    className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[10px] text-zinc-600 dark:text-zinc-300"
                  >
                    {l.name}
                  </span>
                ))}
                {languages.length > 3 && <span className="shrink-0">+{languages.length - 3}</span>}
              </span>
            )}
            {storeLinks[0] && (
              <>
                <span className="w-px h-3 bg-zinc-200 dark:bg-zinc-800" />
                <button
                  onClick={() => (window as any).appilot?.openExternal(storeLinks[0].url)}
                  className="text-[11px] font-medium text-amber-600 dark:text-amber-400 hover:underline shrink-0"
                  title={storeLinks[0].name}
                >
                  App Store ↗
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Copilot brief */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm mb-4">
        <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">副驾驶简报</h3>
          {briefState.status === "loading" ? (
            <span className="text-[11px] text-zinc-400 dark:text-zinc-500 shrink-0">
              {briefState.progress?.phase === "content" ? "生成中" : "思考中"} · {briefState.progress?.chars ?? 0} 字
            </span>
          ) : (
            <button onClick={handleGenerateBrief} className={btnSmSecondary}>
              生成简报
            </button>
          )}
        </div>
        {briefState.status === "error" && (
          <p className="px-5 py-2 text-[11px] text-red-500 dark:text-red-400 border-b border-zinc-100 dark:border-zinc-800">
            {briefState.error}（已显示规则信号）
          </p>
        )}
        {briefState.status === "loading" ? (
          <div className="px-5 py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">
            AI 正在分析排名与发布状态…
          </div>
        ) : visibleBriefItems.length === 0 ? (
          <div className="px-5 py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">
            {briefState.status === "ready" ? "本周事项已清空" : "暂无建议，点「生成简报」让副驾驶看路"}
          </div>
        ) : (
          <ul>
            {visibleBriefItems.map((item, index) => (
              <li
                key={item.id}
                className="flex items-center gap-3 px-5 py-2 border-b border-zinc-100 dark:border-zinc-800 last:border-b-0"
              >
                <span className="w-4 shrink-0 text-xs font-mono text-zinc-400 dark:text-zinc-500">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">{item.title}</p>
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate" title={item.reason}>
                    {item.reason}
                  </p>
                </div>
                <button
                  onClick={() => handleBriefAction(item, "adopted")}
                  className={cn(btnSmSecondary, "!px-2.5 !py-1")}
                >
                  采纳
                </button>
                <button
                  onClick={() => handleBriefAction(item, "ignored")}
                  className="px-2.5 py-1 text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                >
                  忽略
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <MetricBlock
          to="/keywords?scope=tracked"
          label="跟踪关键词"
          value={String(trackedActive.length)}
          sub={pausedCount > 0 ? `暂停 ${pausedCount}` : "跟踪中"}
        />
        <MetricBlock
          to="/keywords?scope=ranked"
          label="当前入榜"
          value={String(rankRows.length)}
          sub={bestRankNow !== null ? `最佳 #${bestRankNow}` : "暂无上榜"}
        />
        <MetricBlock to="/keywords?scope=top10" label="前 10" value={String(top10Count)} highlight={top10Count > 0} />
        <MetricBlock
          to="/keywords"
          label="最近采集"
          value={newestCheckedAt ? formatHumanTime(newestCheckedAt) : "—"}
          warn={dataStale}
          sub={dataStale ? "数据已过期" : "排名页详情"}
        />
      </div>

      {/* Rank trend chart + top keywords */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="lg:col-span-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">排名趋势</h3>
            <div className="flex items-center gap-2.5 shrink-0">
              <div className="flex items-center rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                {[7, 14, 30].map((days) => (
                  <button
                    key={days}
                    onClick={() => setChartDays(days)}
                    className={cn(
                      "px-2 py-0.5 text-[11px] font-medium transition-colors",
                      chartDays === days
                        ? "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400"
                        : "bg-white dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800",
                    )}
                  >
                    {days}天
                  </button>
                ))}
              </div>
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                {newestCheckedAt ? (
                  <span className={cn(dataStale && "text-amber-600 dark:text-amber-400")}>
                    数据截至 {formatHumanTime(newestCheckedAt)}
                  </span>
                ) : (
                  "暂无数据"
                )}
              </span>
            </div>
          </div>
          {chartSeries.length === 0 || chartData.length === 0 ? (
            <div className="h-56 flex flex-col items-center justify-center gap-3">
              <p className="text-sm text-zinc-400 dark:text-zinc-500">
                {trackedActive.length === 0
                  ? "还没有跟踪关键词"
                  : `近 ${chartDays} 天暂无排名数据`}
              </p>
              <Link to="/keywords" className={btnSmSecondary}>
                {trackedActive.length === 0 ? "去生成关键词" : "去排名页"}
              </Link>
            </div>
          ) : (
            <div className="p-3">
              <ResponsiveContainer width="100%" height={224}>
                <LineChart data={chartData} margin={{ top: 8, right: 16, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 10, fill: "#a1a1aa" }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={28}
                  />
                  <YAxis
                    reversed
                    domain={[1, "dataMax"]}
                    tick={{ fontSize: 10, fill: "#a1a1aa" }}
                    tickLine={false}
                    axisLine={false}
                    width={44}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e4e4e7" }}
                    formatter={(value: any, name: any) => [`#${value}`, String(name)]}
                    labelFormatter={(label) => `${label} 排名`}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11 }}
                    onClick={(entry: any) => {
                      const key = typeof entry?.dataKey === "string" ? entry.dataKey : "";
                      const sep = key.indexOf("\u0000");
                      if (sep > 0) {
                        navigate(
                          `/keywords?keyword=${encodeURIComponent(key.slice(sep + 1))}&lang=${encodeURIComponent(key.slice(0, sep))}`,
                        );
                      } else {
                        navigate("/keywords");
                      }
                    }}
                  />
                  {chartSeries.map((entry, index) => (
                    <Line
                      key={entry.key}
                      type="monotone"
                      dataKey={entry.key}
                      name={entry.label}
                      stroke={OVERVIEW_CHART_COLORS[index % OVERVIEW_CHART_COLORS.length]}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 3.5 }}
                      connectNulls={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
              <p className="text-center text-[10px] text-zinc-300 dark:text-zinc-600">
                近 {chartDays} 天 · 点击图例进入排名页
              </p>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Top 关键词</h3>
            <Link to="/keywords" className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline">
              查看全部 →
            </Link>
          </div>
          {rankRows.length === 0 ? (
            <div className="p-8 text-center text-sm text-zinc-400 dark:text-zinc-500">暂无排名数据</div>
          ) : (
            <ul>
              {rankRows.slice(0, 5).map((row, index) => (
                <Link
                  key={`${row.language}:${row.keyword}`}
                  to={`/keywords?keyword=${encodeURIComponent(row.keyword)}&lang=${encodeURIComponent(row.language)}`}
                  className={cn(
                    "flex items-center gap-2.5 px-4 py-2 border-b border-zinc-100 dark:border-zinc-800 last:border-b-0 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors",
                    row.stale && "opacity-55",
                  )}
                >
                  <span className="w-4 shrink-0 text-xs font-mono text-zinc-400 dark:text-zinc-500">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 font-mono text-[13px] text-zinc-800 dark:text-zinc-200 truncate">
                    {row.keyword}
                  </span>
                  {row.language === "en" ? (
                    <span className="shrink-0 inline-flex px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                      全局
                    </span>
                  ) : (
                    <span className="shrink-0 text-[10px] text-zinc-400 dark:text-zinc-500">
                      {languageLabel(row.language)}
                    </span>
                  )}
                  <span
                    className={cn(
                      "shrink-0 w-8 text-right font-mono text-[13px] font-semibold",
                      row.bestRank <= 10
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-zinc-800 dark:text-zinc-200",
                    )}
                  >
                    #{row.bestRank}
                  </span>
                  <span className="shrink-0 w-11 text-right text-[11px]">
                    {row.trend === "up" && (
                      <span className="text-emerald-600 dark:text-emerald-400">▲{row.delta}</span>
                    )}
                    {row.trend === "down" && (
                      <span className="text-red-500 dark:text-red-400">▼{Math.abs(row.delta ?? 0)}</span>
                    )}
                    {row.trend === "new" && <span className="text-amber-600 dark:text-amber-400">进榜</span>}
                    {row.trend === "same" && <span className="text-zinc-400">—</span>}
                  </span>
                </Link>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Release status */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm px-5 py-3.5 flex items-center gap-3 mb-4">
        <span className="shrink-0 text-lg text-amber-500">📦</span>
        {releaseDraft ? (
          <>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <Link
                  to={releaseDraft?.tag ? `/release?tag=${encodeURIComponent(releaseDraft.tag)}` : "/release"}
                  className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                >
                  {releaseDraft.name || releaseDraft.tag}
                </Link>
                {releaseDraft.commitCount > 0 && (
                  <span className="text-[11px] text-zinc-400 dark:text-zinc-500 shrink-0">
                    · {releaseDraft.commitCount} 次提交
                  </span>
                )}
                {submissionDraft && (
                  <StatusChip
                    label={
                      generatedLanguageCount > 0
                        ? `${generatedLanguageCount}/${languageTotal} 语言`
                        : "未生成文案"
                    }
                    tone={
                      languageTotal > 0 && generatedLanguageCount >= languageTotal
                        ? "emerald"
                        : "muted"
                    }
                  />
                )}
                {confirmChip && <StatusChip label={confirmChip.label} tone={confirmChip.tone} />}
                {storeChip && <StatusChip label={storeChip.label} tone={storeChip.tone} />}
              </div>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                {formatHumanTime(releaseDraft.publishedAt)} 更新 · 提交素材
              </p>
            </div>
            <Link
              to={releaseDraft?.tag ? `/release?tag=${encodeURIComponent(releaseDraft.tag)}` : "/release"}
              className={btnSmPrimary}
            >
              打开发布工作台
            </Link>
          </>
        ) : (
          <>
            <p className="flex-1 min-w-0 text-sm text-zinc-400 dark:text-zinc-500 truncate">
              暂无待处理发布（有新提交或新 tag 后自动发现素材）
            </p>
            <Link to="/release" className={btnSmSecondary}>
              去发布页
            </Link>
          </>
        )}
      </div>

    </div>
  );
}

/** Resolve a submission draft into per-language localization objects (legacy drafts included). */
function localizationList(draft: any): any[] {
  if (draft?.localizations?.length) return draft.localizations;
  return [
    {
      language: draft?.submissionKeywords?.[0]?.language || "en",
      name: draft?.name || "",
      subtitle: draft?.subtitle || "",
      promotionalText: draft?.promotionalText || "",
      description: draft?.description || "",
      whatsNew: draft?.whatsNew || "",
      keywords: draft?.submissionKeywords?.[0]?.text || "",
    },
  ];
}

function ReferenceSection({
  title,
  meta,
  checked = false,
  defaultOpen = false,
  action,
  children,
}: {
  title: string;
  meta?: string;
  checked?: boolean;
  defaultOpen?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div className="w-full flex items-center justify-between gap-3 px-5 py-3.5">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2.5 min-w-0 text-left"
          title={open ? "折叠" : "展开"}
        >
          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{title}</span>
          {checked ? <span className="text-xs text-emerald-500 shrink-0">✓</span> : null}
          {meta ? (
            <span className="text-xs text-zinc-400 dark:text-zinc-500 truncate">{meta}</span>
          ) : null}
        </button>
        <span className="flex items-center gap-1.5 shrink-0">
          {action}
          <svg
            viewBox="0 0 16 16"
            fill="none"
            className={cn(
              "w-4 h-4 text-zinc-400 dark:text-zinc-500 shrink-0 transition-transform duration-200",
              open && "rotate-180",
            )}
          >
            <path
              d="M4 6l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>
      {open ? <div className="px-5 pb-5">{children}</div> : null}
    </div>
  );
}

function formatVersionDate(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return (
    date.toLocaleDateString("zh-CN", sameYear ? { month: "numeric", day: "numeric" } : { year: "numeric", month: "numeric", day: "numeric" }) +
    " " +
    date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
  );
}

function draftVersionLabel(item: any): string {
  const tag = String(item.releaseTag || item.appVersion || "");
  if (/^v?\d+(\.\d+)*$/.test(tag)) return tag.startsWith("v") ? tag : `v${tag}`;
  return formatVersionDate(item.updatedAt) || tag || "未知版本";
}

/** Merge draft records that belong to the same release version (same releaseTag),
 *  consolidating their localizations by language so a version is never split
 *  into multiple rows because its languages were translated at different times. */
function mergeHistoryDrafts(drafts: any[]): any[] {
  const byTag = new Map<string, any>();
  for (const draft of drafts) {
    const key = String(draft.releaseTag || draft.id || "");
    const existing = byTag.get(key);
    if (!existing) {
      byTag.set(key, { ...draft, localizations: [...(draft.localizations || [])] });
      continue;
    }
    const langs = new Map<string, any>(
      (existing.localizations || []).map((item: any) => [item.language, item]),
    );
    for (const loc of draft.localizations || []) {
      if (loc?.language) langs.set(loc.language, loc);
    }
    const next: any = { ...existing, localizations: [...langs.values()] };
    if (!next.updatedAt || new Date(draft.updatedAt).getTime() > new Date(next.updatedAt).getTime()) {
      next.updatedAt = draft.updatedAt;
    }
    next.summary = next.summary || draft.summary || "";
    byTag.set(key, next);
  }
  return [...byTag.values()].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

function HistoryPanel({
  drafts,
  selectedDraft,
  onSelect,
  currentTag,
}: {
  drafts: any[];
  selectedDraft: any;
  onSelect: (draft: any) => void;
  currentTag?: string;
}) {
  const merged = mergeHistoryDrafts(drafts);
  return (
    <ReferenceSection title="文案列表" meta={merged.length > 0 ? `${merged.length} 个版本` : "暂无文案"} defaultOpen>
      {merged.length === 0 ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-500 py-1">还没有文案。</p>
      ) : (
        <div className="space-y-1">
          {merged.map((item: any, index: number) => {
            const isCurrent = item.releaseTag === currentTag;
            const active =
              selectedDraft?.releaseTag === item.releaseTag ||
              (!selectedDraft && isCurrent);
            const languages = (item.localizations || [])
              .map((loc: any) => String(loc?.language || "").trim())
              .filter(Boolean);
            return (
              <button
                key={item.releaseTag || index}
                type="button"
                onClick={() => onSelect(isCurrent ? null : item)}
                className={cn(
                  "w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left transition-colors",
                  active
                    ? "bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300"
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{draftVersionLabel(item)}</span>
                  {isCurrent && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 shrink-0">
                      当前
                    </span>
                  )}
                  <span className="text-xs text-zinc-400 dark:text-zinc-500 shrink-0">
                    {formatHumanTime(item.updatedAt)}
                  </span>
                </span>
                {languages.length > 0 && (
                  <span className="mt-1 flex flex-wrap gap-1">
                    {languages.map((lang: string) => (
                      <span
                        key={lang}
                        className="px-1.5 py-0.5 text-[10px] rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
                      >
                        {languageLabel(lang)}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </ReferenceSection>
  );
}

function HistoryViewer({ draft }: { draft: any }) {
  const [language, setLanguage] = useState("");
  const localizations = localizationList(draft);
  const activeLanguage = localizations.some((item: any) => item.language === language)
    ? language
    : localizations[0]?.language || "";
  const loc = localizations.find((item: any) => item.language === activeLanguage) || localizations[0] || null;

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
      <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">文案列表</h3>
          <span className="text-xs text-zinc-400 dark:text-zinc-500 truncate">
            {draftVersionLabel(draft)} · 更新于 {formatHumanTime(draft.updatedAt)}
          </span>
        </div>
      </div>
      <div className="p-6 space-y-6">
        {localizations.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {localizations.map((item: any) => {
              const active = item.language === activeLanguage;
              return (
                <button
                  key={item.language}
                  type="button"
                  onClick={() => setLanguage(item.language)}
                  className={cn(
                    "px-3 py-1.5 text-sm rounded-lg border transition-colors",
                    active
                      ? "border-amber-500 ring-2 ring-amber-500/20 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium"
                      : "border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600",
                  )}
                >
                  {languageLabel(item.language)}
                </button>
              );
            })}
          </div>
        )}

        {loc && (
          <>
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-4">
              <p className="text-[11px] font-semibold tracking-wider text-zinc-400 dark:text-zinc-500">
                应用信息
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <FieldHeader label="软件名称" text={loc.name || ""} />
                  <input value={loc.name || ""} readOnly className={inputLineClass} />
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500 px-1">
                    {(loc.name || "").length}/30 字符
                  </p>
                </div>
                <div className="space-y-1.5">
                  <FieldHeader label="软件副标题" text={loc.subtitle || ""} />
                  <input value={loc.subtitle || ""} readOnly className={inputLineClass} />
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500 px-1">
                    {(loc.subtitle || "").length}/30 字符
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-4">
              <p className="text-[11px] font-semibold tracking-wider text-zinc-400 dark:text-zinc-500">
                软件版本信息
              </p>
              <div className="space-y-1.5">
                <FieldHeader label="推广文本" text={loc.promotionalText || ""} />
                <input value={loc.promotionalText || ""} readOnly className={inputLineClass} />
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500 px-1">
                  {(loc.promotionalText || "").length}/170 字符
                </p>
              </div>
              <div className="space-y-1.5">
                <FieldHeader label="软件描述" text={loc.description || ""} />
                <textarea
                  value={(loc.description || "").replace(/^──── 介绍 ────\n?/, "")}
                  readOnly
                  className={inputClass + " min-h-40 resize-y"}
                />
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500 px-1">
                  {(loc.description || "").replace(/^──── 介绍 ────\n?/, "").length}/4000 字符
                </p>
              </div>
              <div className="space-y-1.5">
                <FieldHeader label="新增内容" text={loc.whatsNew || ""} />
                <textarea value={loc.whatsNew || ""} readOnly className={inputClass + " min-h-28 resize-y"} />
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500 px-1">
                  {(loc.whatsNew || "").length}/4000 字符
                </p>
              </div>
              <div className="space-y-1.5">
                <FieldHeader label="关键词（提交字段）" text={loc.keywords || ""} />
                <input value={loc.keywords || ""} readOnly className={inputLineClass} />
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500 px-1">
                  {(loc.keywords || "").length}/100 字符
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ReleasePage() {
  const { projects, currentProjectId, currentProductId } = useProject();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTag = searchParams.get("tag") || "";
  const project = projects.find((item) => item.id === currentProjectId);
  const products = project?.storeProducts || [];
  const [productId, setProductId] = useState(currentProductId || products[0]?.id || "");
  const [releases, setReleases] = useState<any[]>([]);
  const [selectedTag, setSelectedTag] = useState("");
  const [active, setActive] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [releasesLoaded, setReleasesLoaded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<{
    chars: number;
    phase: "reasoning" | "content";
  } | null>(null);
  const [error, setError] = useState("");
  const [activeLanguage, setActiveLanguage] = useState("");
  const [sourceLanguage, setSourceLanguage] = useState("");
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [releaseContext, setReleaseContext] = useState<any>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [historyDraft, setHistoryDraft] = useState<any>(null);
  const [translatingLanguages, setTranslatingLanguages] = useState<Set<string>>(new Set());
  const translatingRef = useRef<Set<string>>(new Set());
  const [summaryChecked, setSummaryChecked] = useState<Set<string>>(new Set());
  const [pendingVersion, setPendingVersion] = useState("");

  useEffect(() => {
    const off = (window as any).appilot?.release?.onGenerateProgress?.((progress: any) => {
      if (progress?.kind === "chars" && typeof progress.chars === "number") {
        setGenerationProgress({
          chars: progress.chars,
          phase: progress.phase === "content" ? "content" : "reasoning",
        });
      }
    });
    return () => off?.();
  }, []);

  const loadReleases = async () => {
    if (!project?.id) return;
    setChecking(true);
    setError("");
    try {
      const next = await (window as any).appilot.release.list(project.id);
      setReleases(next.releases || []);
      setActive((prev: any) => {
        if (prev?.draft?.releaseTag && next.releases?.some((item: any) => item.tag === prev.draft.releaseTag)) {
          return prev;
        }
        return null;
      });
      const draft = next.releases?.find((item: any) => item.draft) || next.releases?.[0];
      setSelectedTag((current) => {
        if (urlTag && next.releases?.some((item: any) => item.tag === urlTag)) {
          return urlTag;
        }
        if (current && next.releases?.some((item: any) => item.tag === current)) {
          return current;
        }
        return draft?.tag || "";
      });
    } catch (e: any) {
      setError(e.message || "发布列表加载失败。");
    } finally {
      setChecking(false);
      setReleasesLoaded(true);
    }
  };

  useEffect(() => {
    void loadReleases();
  }, [project?.id, searchParams]);

  // Keep the selected product valid when the project or its products change
  // (e.g. switching project, or products arriving after the initial load).
  useEffect(() => {
    setProductId((current) => {
      if (products.some((item) => item.id === current)) return current;
      if (currentProductId && products.some((item) => item.id === currentProductId)) {
        return currentProductId;
      }
      return products[0]?.id || "";
    });
  }, [products, currentProductId]);

  // Keep the URL's ?tag= in sync with the release selected in the workbench,
  // so navigating away and back preserves the current draft.
  useEffect(() => {
    if (!project?.id || !selectedTag) return;
    if (urlTag === selectedTag) return;
    const next = new URLSearchParams(searchParams);
    next.set("tag", selectedTag);
    setSearchParams(next, { replace: true });
  }, [project?.id, selectedTag, urlTag, searchParams]);

  useEffect(() => {
    setSourceLanguage(UI_SOURCE_LANGUAGE);
    setTranslatingLanguages(new Set());
    setActiveLanguage("");
    setStep(1);
  }, [productId, project?.id]);

  useEffect(() => {
    if (!project?.id || !productId || !selectedTag) return;
    if (!products.some((item) => item.id === productId)) return;
    let cancelled = false;
    setContextLoading(true);
    setHistoryDraft(null);
    (window as any).appilot?.release?.context(project.id, productId, selectedTag)
      .then((context: any) => {
        if (!cancelled) {
          setReleaseContext(context);
          setContextLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReleaseContext(null);
          setContextLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [project?.id, productId, selectedTag]);

  const draft = active?.draft || null;
  const release = active?.release || null;
  const localizations = draft ? localizationList(draft) : [];
  const activeLocalization =
    localizations.find((item: any) => item.language === activeLanguage) || localizations[0] || null;
  const primaryLanguage = localizations[0]?.language || "";
  const masterConfirmed = Boolean(draft?.masterConfirmedAt);
  const batchConfirmed = Boolean(draft?.batchConfirmedAt);
  const selectedRelease = releases.find((item) => item.tag === selectedTag) || null;
  const selectedProduct = products.find((item) => item.id === productId) || null;
  const availableLanguages = (selectedProduct?.supportedLanguages || [])
    .map((item: any) => String(item?.code || "").trim())
    .filter(Boolean);
  const orderedLanguages = availableLanguages.includes(UI_SOURCE_LANGUAGE)
    ? [
        UI_SOURCE_LANGUAGE,
        ...availableLanguages.filter((language) => language !== UI_SOURCE_LANGUAGE),
      ]
    : availableLanguages;
  const remainingTranslationCount = orderedLanguages.filter(
    (language) =>
      language !== primaryLanguage &&
      !localizations.some((item: any) => item.language === language),
  ).length;
  const selectedExistingDraft =
    active?.draft?.productId === productId && active?.draft?.releaseTag === selectedTag
      ? active.draft
      : selectedRelease?.submissionDrafts?.find(
          (item: any) => item?.productId === productId,
        ) || null;
  const feedbackReadOnly = Boolean(release && !release.draft);
  const isReadOnly =
    feedbackReadOnly ||
    batchConfirmed ||
    (masterConfirmed && activeLocalization?.language === primaryLanguage);
  const busy = generating || loadingDraft;
  const summaryMaterial = selectedRelease?.material || null;
  const summaryItems: ChangeSummaryItem[] = summaryMaterial
    ? summarizeChanges(summaryMaterial)
    : [];
  const summaryPrCount = summaryMaterial?.pullRequests?.length ?? 0;
  const summaryCommitCount = summaryMaterial?.commits?.length ?? 0;
  const sinceMs = summaryMaterial?.sinceDate
    ? Date.now() - new Date(summaryMaterial.sinceDate).getTime()
    : null;
  const durationLabel =
    sinceMs != null && sinceMs >= 0
      ? sinceMs >= 86400000
        ? `${Math.round(sinceMs / 86400000)} 天`
        : `${Math.max(1, Math.round(sinceMs / 3600000))} 小时`
      : "";
  const checkedCount = summaryItems.filter((item) => summaryChecked.has(item.id)).length;
  const previousDraft =
    (releaseContext?.drafts || []).find((item: any) => item.releaseTag !== selectedTag) || null;
  const latestCodeDate = summaryMaterial?.commits?.[0]?.date || "";
  const fixedMaterialRows = (() => {
    const rows: { label: string; meta: string }[] = [];
    rows.push({
      label: "README 全文",
      meta: releaseContext?.readme ? `${releaseContext.readme.length.toLocaleString()} 字符` : "无",
    });
    rows.push({
      label: "产品档案",
      meta: `${selectedProduct?.trackName || project?.name || ""} · ${platformLabel(selectedProduct?.platform || "unknown")} · ${selectedProduct?.supportedLanguages?.length ?? 0} 语言`,
    });
    const historyDrafts = releaseContext?.drafts || [];
    rows.push({
      label: "文案列表（含历次发布公告）",
      meta:
        historyDrafts.length > 0
          ? `最近 ${historyDrafts.length} 份${historyDrafts[0]?.appVersion ? `（最新 v${String(historyDrafts[0].appVersion).replace(/^v/i, "")}）` : ""}`
          : "无",
    });
    const activeKeywordCount = (selectedProduct?.trackedKeywords || []).filter(
      (keyword: any) => keyword.status !== "paused",
    ).length;
    rows.push({
      label: "跟踪关键词与排名",
      meta: activeKeywordCount > 0 ? `${activeKeywordCount} 个关键词` : "无",
    });
    const githubRelease = summaryMaterial?.githubRelease;
    if (githubRelease) {
      rows.push({
        label: "GitHub 发布公告",
        meta: `${githubRelease.name || "发布正文"}${githubRelease.publishedAt ? ` · ${formatHumanTime(githubRelease.publishedAt)}` : ""}`,
      });
    }
    if (draft?.reviewFeedback) {
      rows.push({
        label: "驳回意见",
        meta: String(draft.reviewFeedback).split("\n")[0].slice(0, 40),
      });
    }
    return rows;
  })();

  useEffect(() => {
    const items = selectedRelease?.material ? summarizeChanges(selectedRelease.material) : [];
    const stored = draft?.summaryChecklist;
    setSummaryChecked(
      new Set(stored && stored.length > 0 ? stored : items.map((item) => item.id)),
    );
  }, [draft?.id, selectedRelease?.tag]);

  const persistSummaryChecklist = async (ids: string[]) => {
    const current = active?.draft;
    if (!current || !project?.id) return;
    const nextDraft = { ...current, summaryChecklist: ids };
    setActive((prev: any) => ({ ...prev, draft: nextDraft }));
    try {
      const saved = await (window as any).appilot.release.saveDraft(project.id, nextDraft);
      setActive((prev: any) => ({ ...prev, draft: saved }));
    } catch {
      // Keep the local state; persistence retries on the next toggle.
    }
  };

  const persistCurrentDraft = async () => {
    const current = active?.draft;
    if (!current || !project?.id) return;
    try {
      const saved = await (window as any).appilot.release.saveDraft(project.id, current);
      setActive((prev: any) => ({ ...prev, draft: saved }));
    } catch {
      // Keep the local edit; persistence retries on the next blur.
    }
  };

  const toggleSummaryItem = async (id: string) => {
    const next = new Set(summaryChecked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSummaryChecked(next);
    await persistSummaryChecklist([...next]);
  };

  const setAllSummaryChecked = async (checked: boolean) => {
    const next = new Set<string>();
    if (checked) summaryItems.forEach((item) => next.add(item.id));
    setSummaryChecked(next);
    await persistSummaryChecklist([...next]);
  };

  useEffect(() => {
    if (!activeLanguage && localizations[0]?.language) {
      setActiveLanguage(localizations[0].language);
    }
  }, [activeLanguage, localizations]);

  const updateLocalizationField = (
    field: "name" | "subtitle" | "promotionalText" | "description" | "whatsNew" | "keywords",
    value: string,
  ) => {
    setActive((prev: any) => {
      if (!prev?.draft) return prev;
      const nextLocalizations = (prev.draft.localizations || []).map((item: any) =>
        item.language === activeLocalization?.language
          ? { ...item, [field]: value }
          : item,
      );
      return {
        ...prev,
        draft: {
          ...prev.draft,
          localizations: nextLocalizations,
        },
      };
    });
  };

  const updateDraftField = (key: string, value: string) => {
    setActive((prev: any) => prev?.draft ? { ...prev, draft: { ...prev.draft, [key]: value } } : prev);
  };

  const handleLoad = async (force: boolean) => {
    if (!project || !productId || !selectedTag) return;
    if (force) {
      setGenerating(true);
      setGenerationProgress(null);
    } else {
      setLoadingDraft(true);
    }
    setError("");
    try {
      if (force && active?.draft) {
        const saved = await (window as any).appilot.release.saveDraft(project.id, active.draft);
        setActive((prev: any) => ({ ...prev, draft: saved }));
      }
      const next = await (window as any).appilot.release.get(
        project.id,
        productId,
        selectedTag,
        force,
        force ? sourceLanguage : undefined,
        force
          ? summaryItems.flatMap((item) =>
              summaryChecked.has(item.id) ? item.commits.map((commit) => commit.sha) : [],
            )
          : undefined,
        (draft?.appVersion || pendingVersion) || undefined,
        summaryItems
          .filter((item) => summaryChecked.has(item.id))
          .map((item) => item.title),
      );
      setActive(next);
      setStep(2);
    } catch (e: any) {
      setError(e.message || "发布工作单加载失败。");
    } finally {
      setGenerating(false);
      setLoadingDraft(false);
    }
  };

  const handleProductChange = async (value: string) => {
    setProductId(value);
    setActive(null);
    setActiveLanguage("");
    setReleaseContext(null);
    setHistoryDraft(null);
    const existing = selectedRelease?.submissionDrafts?.find(
      (item: any) => item?.productId === value,
    );
    if (!existing || !project || !selectedTag) return;

    setLoadingDraft(true);
    try {
      const next = await (window as any).appilot.release.get(project.id, value, selectedTag, false);
      setActive(next);
      setStep(2);
    } catch (e: any) {
      setError(e.message || "已有文案加载失败。");
    } finally {
      setLoadingDraft(false);
    }
  };

  const persistConfirm = async (patch: Record<string, string>) => {
    if (!project?.id || !draft) return;
    try {
      const saved = await (window as any).appilot.release.saveDraft(project.id, { ...draft, ...patch });
      setActive((prev: any) => ({ ...prev, draft: saved }));
    } catch (e: any) {
      setError(e.message || "保存失败。");
    }
  };

  const handleConfirmMaster = () => {
    if (!draft?.appVersion?.trim()) {
      setError("请先填写目标版本后再确定文案。");
      return;
    }
    if (!draft?.masterConfirmedAt) {
      void persistConfirm({ masterConfirmedAt: new Date().toISOString() });
    }
  };

  const handleConfirmBatch = () => {
    if (!draft?.appVersion?.trim()) {
      setError("请先填写目标版本后再确定文案。");
      return;
    }
    const now = new Date().toISOString();
    void persistConfirm({
      masterConfirmedAt: draft?.masterConfirmedAt || now,
      batchConfirmedAt: now,
    });
  };

  const handleTranslateOne = async (language: string) => {
    if (!project || !draft || !selectedTag || translatingRef.current.has(language)) return;
    if (
      !masterConfirmed ||
      batchConfirmed ||
      feedbackReadOnly ||
      localizations.some((item: any) => item.language === language)
    ) {
      return;
    }

    translatingRef.current.add(language);
    setTranslatingLanguages((prev) => new Set(prev).add(language));
    setError("");
    try {
      const currentDraft = active?.draft;
      if (currentDraft) {
        const saved = await (window as any).appilot.release.saveDraft(project.id, currentDraft);
        setActive((prev: any) => ({ ...prev, draft: saved }));
      }
      const next = await (window as any).appilot.release.translate(
        project.id,
        currentDraft?.productId || draft.productId,
        currentDraft?.releaseTag || draft.releaseTag,
        [language],
        sourceLanguage || currentDraft?.localizations?.[0]?.language || draft.localizations?.[0]?.language,
      );
      setActive((prev: any) => ({ ...prev, draft: next }));
      setActiveLanguage(language);
    } catch (e: any) {
      setError(e.message || `${languageLabel(language)} 翻译失败。`);
    } finally {
      translatingRef.current.delete(language);
      setTranslatingLanguages((prev) => {
        const next = new Set(prev);
        next.delete(language);
        return next;
      });
    }
  };

  useEffect(() => {
    if (!draft && selectedExistingDraft && selectedRelease?.draft && project && selectedTag) {
      void handleLoad(false);
    }
  }, [draft?.id, selectedExistingDraft?.id, project?.id, selectedTag]);

  if (!project) {
    return <EmptyState title="还没有项目" desc="添加一个项目后，这里会展示发布工作台。" />;
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">发布工作台</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
            自上次生成以来的提交与 PR 素材，由你确认后生成 App Store 提交文案。
          </p>
        </div>
        <div className="flex items-center gap-3">
          {products.length > 0 && (
            <div className="inline-flex rounded-xl bg-zinc-100 dark:bg-zinc-800/80 p-1 gap-1">
              {products.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => handleProductChange(product.id)}
                  className={cn(
                    "px-3.5 py-1.5 text-sm rounded-lg transition-colors",
                    product.id === productId
                      ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm font-medium"
                      : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300",
                  )}
                >
                  {platformLabel(product.platform)}
                </button>
              ))}
            </div>
          )}
          <button onClick={loadReleases} disabled={checking} className={btnPrimary}>
            {checking ? "检查中..." : "检查发布"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/50 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {releases.length === 0 ? (
        !releasesLoaded || checking ? (
          <div className="py-16 text-center text-sm text-zinc-400 dark:text-zinc-500">
            正在检查发布状态…
          </div>
        ) : (
          <EmptyState
            title="尚未检测到新的发布"
            desc="有新提交或创建新 tag（GitHub 发布会自动打 tag）后，这里会自动生成发布文案素材。"
          />
        )
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] items-start">
          <aside className="min-w-0">
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">参考</h3>
              </div>
              {selectedRelease && (
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  <ReferenceSection
                    title="变更摘要"
                    meta={
                      summaryItems.length > 0
                        ? `${summaryPrCount} PR · ${summaryCommitCount} 提交${durationLabel ? ` · ${durationLabel}` : ""}`
                        : "无变更"
                    }
                    checked={step > 1}
                    defaultOpen
                    action={
                      summaryItems.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => void setAllSummaryChecked(checkedCount < summaryItems.length)}
                          className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline"
                          title={
                            checkedCount === summaryItems.length
                              ? "取消全部选择"
                              : checkedCount === 0
                                ? "全部选择"
                                : "全部确认"
                          }
                        >
                          {checkedCount === summaryItems.length
                            ? "已全选"
                            : checkedCount === 0
                              ? "未选择"
                              : "全部确认"}
                        </button>
                      ) : undefined
                    }
                  >
                    {(previousDraft || latestCodeDate) && (
                      <div className="mb-2 space-y-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">
                        {previousDraft && (
                          <p>
                            上一次文案：{draftVersionLabel(previousDraft)} ·{" "}
                            {formatHumanTime(previousDraft.updatedAt)} 生成
                          </p>
                        )}
                        {latestCodeDate && <p>最新代码更新：{formatHumanTime(latestCodeDate)}</p>}
                      </div>
                    )}
                    {summaryItems.length === 0 ? (
                      <p className="text-sm text-zinc-400 dark:text-zinc-500">本次无变更</p>
                    ) : (
                      <>
                        <div className="space-y-1">
                          {summaryItems.map((item) => {
                            const included = summaryChecked.has(item.id);
                            const tone = CHANGE_TYPE_META[item.type].tone;
                            const latestDate = item.commits[item.commits.length - 1]?.date || "";
                            const subLine =
                              item.commits.length > 1
                                ? `${item.refs.join(" · ")} · ${item.commits.length} 次提交${latestDate ? ` · 最新 ${formatHumanTime(latestDate)}` : ""}`
                                : `${item.refs.join(" · ")}${latestDate ? ` · ${formatHumanTime(latestDate)}` : ""}`;
                            return (
                              <div
                                key={item.id}
                                className={cn(
                                  "w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg",
                                  !included && "opacity-55",
                                )}
                              >
                                <span
                                  role="checkbox"
                                  aria-checked={included}
                                  tabIndex={0}
                                  onClick={() => void toggleSummaryItem(item.id)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      void toggleSummaryItem(item.id);
                                    }
                                  }}
                                  title={included ? "从 AI 素材中排除" : "作为 AI 素材提供"}
                                  className={cn(
                                    "mt-0.5 w-4 h-4 shrink-0 rounded border flex items-center justify-center text-[10px] transition-colors cursor-pointer",
                                    included
                                      ? "bg-amber-500 border-amber-500 text-white"
                                      : "border-zinc-300 dark:border-zinc-600",
                                  )}
                                >
                                  {included ? "✓" : ""}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block text-xs text-zinc-800 dark:text-zinc-200 truncate">
                                    {item.title}
                                  </span>
                                  <span
                                    className="block text-[10px] text-zinc-400 dark:text-zinc-500 truncate"
                                  >
                                    {subLine}
                                  </span>
                                </span>
                                <span
                                  className={cn(
                                    "shrink-0 inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium",
                                    tone === "amber" && "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400",
                                    tone === "emerald" && "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                                    tone === "sky" && "bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-400",
                                    tone === "muted" && "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400",
                                  )}
                                >
                                  {CHANGE_TYPE_META[item.type].label}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
                          以上 {checkedCount}/{summaryItems.length} 项将作为素材提供给 AI；未勾选项不会进入文案生成。
                        </p>
                      </>
                    )}
                  </ReferenceSection>

                  {step <= 2 &&
                    (contextLoading ? (
                      <div className="px-5 py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">
                        正在载入发布参考…
                      </div>
                    ) : releaseContext ? (
                      <>
                        <ReferenceSection title="固定素材" meta="始终发送给 AI" defaultOpen>
                          <ul className="space-y-1.5">
                            {fixedMaterialRows.map((row) => (
                              <li
                                key={row.label}
                                className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-zinc-50/60 dark:bg-zinc-800/30"
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="block text-xs text-zinc-700 dark:text-zinc-300 truncate">
                                    {row.label}
                                  </span>
                                  <span className="block text-[10px] text-zinc-400 dark:text-zinc-500 truncate">
                                    {row.meta}
                                  </span>
                                </span>
                                <span className="shrink-0 inline-flex px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[10px] text-zinc-500 dark:text-zinc-400">
                                  始终发送
                                </span>
                              </li>
                            ))}
                          </ul>
                          <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
                            这些素材无需逐项查看；如需调整素材范围，可在上方变更摘要中取消对应条目。
                          </p>
                        </ReferenceSection>
                        <HistoryPanel
                          drafts={releaseContext.drafts || []}
                          selectedDraft={historyDraft}
                          onSelect={(draft: any) => setHistoryDraft(draft)}
                          currentTag={selectedTag}
                        />
                      </>
                    ) : null)}
                </div>
              )}
            </div>
          </aside>

          <div className="min-w-0 space-y-6">
            {selectedRelease && (
              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm px-5 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[11px] text-zinc-400 dark:text-zinc-500 shrink-0">文档</span>
                  <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                    {historyDraft
                      ? `文案列表 · ${draftVersionLabel(historyDraft)}`
                      : `当前文案 · ${draft?.appVersion || "版本待定"}`}
                  </span>
                  {!historyDraft && (
                    <span className="flex items-center gap-1.5 shrink-0 flex-wrap">
                      {masterConfirmed && !batchConfirmed && (
                        <StatusChip label="母本已确定" tone="amber" />
                      )}
                      {batchConfirmed && <StatusChip label="整批已确定" tone="emerald" />}
                      {draft?.storeStatus && STORE_STATUS_META[draft.storeStatus] && (
                        <StatusChip
                          label={STORE_STATUS_META[draft.storeStatus].label}
                          tone={STORE_STATUS_META[draft.storeStatus].tone}
                        />
                      )}
                      {draft && localizations.length > 0 && (
                        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                          {localizations.length}/{availableLanguages.length} 语言
                        </span>
                      )}
                    </span>
                  )}
                </div>
                {historyDraft && (
                  <button type="button" onClick={() => setHistoryDraft(null)} className={btnSmSecondary}>
                    ← 返回当前文案
                  </button>
                )}
              </div>
            )}
            {historyDraft ? (
              <HistoryViewer draft={historyDraft} />
            ) : (
              <>
            {selectedRelease && step === 1 && (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold tracking-wider text-zinc-400 dark:text-zinc-500 shrink-0">
                    目标版本
                  </span>
                  <input
                    value={draft?.appVersion ?? pendingVersion}
                    onChange={(e) => {
                      if (draft) updateDraftField("appVersion", e.target.value);
                      else setPendingVersion(e.target.value);
                    }}
                    onBlur={() => void persistCurrentDraft()}
                    placeholder="如 1.2.6"
                    className={inputLineClass + " max-w-32"}
                  />
                  <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                    {draft ? "文案列表将按此版本标识" : "生成文案时将写入此版本"}
                  </span>
                </div>
                <div>
                  <p className="text-xs font-semibold tracking-wider text-zinc-400 dark:text-zinc-500 mb-2">语言</p>
                  <div className="flex flex-wrap gap-2">
                    {orderedLanguages.map((language, index) => (
                      <span
                        key={language}
                        className={cn(
                          "px-3 py-1.5 text-sm rounded-lg border",
                          index === 0
                            ? "border-amber-500/50 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium"
                            : "border-zinc-200 dark:border-zinc-700 text-zinc-400 dark:text-zinc-500",
                        )}
                      >
                        {languageLabel(language)}{index === 0 ? " ✓" : ""}
                      </span>
                    ))}
                  </div>
                </div>

                {selectedRelease.draft && !draft && (
                  summaryItems.length > 0 ? (
                    <AIProgressButton
                      onClick={() => handleLoad(true)}
                      disabled={busy && !generating}
                      loading={generating}
                      progress={generationProgress}
                      idleLabel="下一步：生成文案"
                    />
                  ) : (
                    <p className="text-sm text-zinc-400 dark:text-zinc-500">
                      本次无变更，无需生成新文案。
                    </p>
                  )
                )}

                {!selectedRelease.draft && (
                  <div>
                    {selectedExistingDraft ? (
                      <button onClick={() => handleLoad(false)} disabled={busy} className="px-4 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60">
                        {loadingDraft ? "加载中..." : "查看文案列表"}
                      </button>
                    ) : (
                      <span className="text-sm text-zinc-400 dark:text-zinc-500">该正式发布没有文案</span>
                    )}
                  </div>
                )}
              </>
            )}

            {!draft ? (
              selectedRelease && step > 1 ? (
                <EmptyState
                  title={selectedRelease.draft ? "等待生成提交文案" : "该正式发布没有文案"}
                  desc={selectedRelease.draft ? "确认后由 AI 生成名称、副标题、Promotional Text、描述、What's New 和关键词。" : "正式发布只作为完成信号，不再生成新的商店文案。"}
                />
              ) : null
            ) : (
              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between gap-4">
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">商店提交工作单</h3>
                </div>

                <div className="p-6 space-y-6">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold tracking-wider text-zinc-400 dark:text-zinc-500 shrink-0">
                      目标版本
                    </span>
                    <input
                      value={draft.appVersion || ""}
                      onChange={(e) => updateDraftField("appVersion", e.target.value)}
                      onBlur={() => void persistCurrentDraft()}
                      placeholder="如 1.2.6"
                      className={inputLineClass + " max-w-32"}
                    />
                    <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                      确定文案前需填写
                    </span>
                  </div>
                  {activeLocalization && (
                    <>
                      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-4">
                        <p className="text-[11px] font-semibold tracking-wider text-zinc-400 dark:text-zinc-500">
                          应用信息
                        </p>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <FieldHeader label="软件名称" text={activeLocalization.name || ""} />
                            <input
                              value={activeLocalization.name || ""}
                              onChange={(e) => updateLocalizationField("name", e.target.value)}
                              disabled={isReadOnly}
                              className={inputLineClass}
                            />
                            <p className="text-[11px] text-amber-600/80 dark:text-amber-500/70 px-1">
                              建议：名称后加冒号和描述性短句（如 GloWalk: Path of Light）
                            </p>
                            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 px-1">
                              {(activeLocalization.name || "").length}/30 字符
                            </p>
                          </div>
                          <div className="space-y-1.5">
                            <FieldHeader label="软件副标题" text={activeLocalization.subtitle || ""} />
                            <input
                              value={activeLocalization.subtitle || ""}
                              onChange={(e) => updateLocalizationField("subtitle", e.target.value)}
                              disabled={isReadOnly}
                              className={inputLineClass}
                            />
                            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 px-1">
                              {(activeLocalization.subtitle || "").length}/30 字符
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-4">
                        <p className="text-[11px] font-semibold tracking-wider text-zinc-400 dark:text-zinc-500">
                          软件版本信息
                        </p>
                        <div className="space-y-1.5">
                          <FieldHeader label="推广文本" text={activeLocalization.promotionalText} />
                          <input
                            value={activeLocalization.promotionalText}
                            onChange={(e) => updateLocalizationField("promotionalText", e.target.value)}
                            disabled={isReadOnly}
                            className={inputLineClass}
                          />
                          <p className="text-[11px] text-zinc-400 dark:text-zinc-500 px-1">
                            {activeLocalization.promotionalText.length}/170 字符
                          </p>
                        </div>

                        <div className="space-y-1.5">
                          <FieldHeader label="软件描述" text={activeLocalization.description} />
                          <textarea
                            value={activeLocalization.description}
                            onChange={(e) => updateLocalizationField("description", e.target.value)}
                            disabled={isReadOnly}
                            className={inputClass + " min-h-40 resize-y"}
                          />
                          <p className="text-[11px] text-zinc-400 dark:text-zinc-500 px-1">
                            {activeLocalization.description.length}/4000 字符
                          </p>
                        </div>

                        <div className="space-y-1.5">
                          <FieldHeader label="新增内容" text={activeLocalization.whatsNew} />
                          <textarea
                            value={activeLocalization.whatsNew}
                            onChange={(e) => updateLocalizationField("whatsNew", e.target.value)}
                            disabled={isReadOnly}
                            className={inputClass + " min-h-28 resize-y"}
                          />
                          <p className="text-[11px] text-zinc-400 dark:text-zinc-500 px-1">
                            {activeLocalization.whatsNew.length}/4000 字符
                          </p>
                        </div>

                        <div className="space-y-1.5">
                          <FieldHeader label="关键词（提交字段）" text={activeLocalization.keywords} />
                          <input
                            value={activeLocalization.keywords}
                            onChange={(e) => updateLocalizationField("keywords", e.target.value)}
                            disabled={isReadOnly}
                            className={inputLineClass}
                          />
                          <p className="text-[11px] text-zinc-400 dark:text-zinc-500 px-1">
                            {activeLocalization.keywords.length}/100 字符
                          </p>
                        </div>
                      </div>
                    </>
                  )}

                  <div className="border-t border-zinc-100 dark:border-zinc-800 pt-5 space-y-4">
                    <div className="flex flex-wrap gap-2">
                      {orderedLanguages.map((language) => {
                        const generated = localizations.some((item: any) => item.language === language);
                        const translating = translatingLanguages.has(language);
                        const active = activeLocalization?.language === language;
                        const clickable =
                          masterConfirmed &&
                          !batchConfirmed &&
                          !feedbackReadOnly &&
                          !generated &&
                          !translating;
                        const chipTitle = generated
                          ? `${languageLabel(language)}文案`
                          : clickable
                            ? `翻译为${languageLabel(language)}文案`
                            : feedbackReadOnly
                              ? "正式发布后只读，不可翻译"
                              : batchConfirmed
                                ? "整批文案已确定，只读"
                                : "先确定母本语言，再翻译其他语言";
                        return (
                          <button
                            key={language}
                            title={chipTitle}
                            onClick={() => {
                              if (generated) {
                                setActiveLanguage(language);
                              } else if (clickable) {
                                void handleTranslateOne(language);
                              }
                            }}
                            disabled={generating || (!generated && !clickable)}
                            className={cn(
                              "px-3 py-1.5 text-sm rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                              active
                                ? "border-amber-500 ring-2 ring-amber-500/20 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium"
                                : generated
                                  ? "border-emerald-500/50 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                  : "border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600",
                            )}
                          >
                            {languageLabel(language)}
                            {translating ? (
                              <span className="inline-flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full border-2 border-current border-t-transparent animate-spin" />
                                {formatKilo(generationProgress?.chars || 0)}
                              </span>
                            ) : generated ? (
                              " ✓"
                            ) : (
                              ""
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {!feedbackReadOnly && !batchConfirmed && (
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <span className="text-xs text-zinc-400 dark:text-zinc-500">
                          {!masterConfirmed
                            ? "确定母本语言后，可逐一翻译其他语言"
                            : remainingTranslationCount > 0
                              ? `还有 ${remainingTranslationCount} 个语言未翻译（可选）`
                              : "全部语言已翻译"}
                        </span>
                        <button
                          onClick={masterConfirmed ? handleConfirmBatch : handleConfirmMaster}
                          className={btnPrimary}
                        >
                          {masterConfirmed ? "确定整个文案" : "确定母本语言"}
                        </button>
                      </div>
                    )}

                    {batchConfirmed && !feedbackReadOnly && (
                      <div className="flex justify-end">
                        <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                          文案已确定
                        </span>
                      </div>
                    )}
                  </div>

                  <FieldBlock label="驳回意见 / 我的修改意见（重新生成时作为上下文）">
                    <textarea
                      value={draft.reviewFeedback || ""}
                      onChange={(e) => updateDraftField("reviewFeedback", e.target.value)}
                      disabled={feedbackReadOnly}
                      className={inputClass + " min-h-20 resize-y"}
                    />
                    {!feedbackReadOnly && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <AIProgressButton
                          onClick={() => handleLoad(true)}
                          disabled={busy && !generating}
                          loading={generating}
                          progress={generationProgress}
                          idleLabel="重新生成"
                        />
                      </div>
                    )}
                  </FieldBlock>
                </div>
              </div>
            )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FieldBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500 mb-2">{label}</p>
      {children}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="text-xs text-amber-600 dark:text-amber-400 hover:underline"
    >
      {copied ? "已复制" : "复制"}
    </button>
  );
}

function FieldHeader({ label, text, copy = true }: { label: string; text: string; copy?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500">{label}</span>
      {copy ? <CopyButton text={text} /> : null}
    </div>
  );
}

function TaskCenterPage() {
  const [data, setData] = useState<{
    running: boolean;
    nowRunning: any;
    overview: any;
    timeline: {
      recent: { hour: number; success: number; failed: number }[];
      upcoming: { hour: number; count: number }[];
    };
    tasks: any[];
  } | null>(null);
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [languageFilter, setLanguageFilter] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      (window as any).appilot?.scheduler?.list()
        .then((next: any) => {
          if (!cancelled) setData(next);
        })
        .catch(() => {
          if (!cancelled) setData(null);
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const projectOptions = Array.from(
    new Set(
      (data?.tasks || [])
        .map((task: any) => task.projectName)
        .filter((name: string) => name && name !== "已删除项目"),
    ),
  ).sort();
  const platformOptions = Array.from(
    new Set((data?.tasks || []).map((task: any) => task.platform).filter(Boolean)),
  ).sort();
  const languageOptions = Array.from(
    new Set(
      (data?.tasks || [])
        .map((task: any) => task.queryLanguage)
        .filter((lang: string) => Boolean(lang)),
    ),
  ).sort();
  const tasks = (data?.tasks || [])
    .filter((task) => projectFilter === "all" || task.projectName === projectFilter)
    .filter((task) => platformFilter === "all" || task.platform === platformFilter)
    .filter((task) => languageFilter === "all" || task.queryLanguage === languageFilter);
  const pending = tasks.filter((task) => task.enabled);
  const failed = tasks.filter((task) => task.lastStatus === "failed");

  const pendingGroups = groupTasks(pending);
  const failedGroups = groupTasks(failed);
  const overview = data?.overview;
  const nowRunning = data?.nowRunning;
  const timeline = data?.timeline;

  return (
    <div className="p-10 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">任务中心</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
            后台排名采集的调度健康度、执行负载与时间线。
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {nowRunning && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              正在执行 {nowRunning.keyword}
            </span>
          )}
          <span
            className={cn(
              "px-2.5 py-1 rounded-full text-xs font-medium",
              data?.running
                ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400",
            )}
          >
            {data?.running ? "调度器运行中" : "调度器未运行"}
          </span>
        </div>
      </div>

      {data === null && (
        <div className="mb-6 flex items-center gap-2 text-sm text-zinc-400 dark:text-zinc-500">
          <span className="w-4 h-4 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-transparent animate-spin" />
          正在载入任务中心…
        </div>
      )}

      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard
            label="任务总数"
            value={String(overview.total)}
            sub={`待执行 ${overview.pending} · 积压 ${overview.overdue}`}
          />
          <StatCard
            label="已执行"
            value={String(overview.executedToday)}
            sub={`今日 · 累计 ${overview.totalExecuted}`}
          />
          <StatCard
            label="执行密度"
            value={String(overview.densityPerHour)}
            sub="次/小时（近24h，含未运行时段）"
          />
          <StatCard
            label="平均耗时"
            value={formatDuration(overview.avgDurationMs)}
            sub="近24h"
          />
          <StatCard
            label="成功率"
            value={overview.successRate == null ? "—" : `${overview.successRate}%`}
            sub="近24h"
          />
          <StatCard
            label="入榜率"
            value={overview.hitRate == null ? "—" : `${overview.hitRate}%`}
            sub="成功采集中找到排名"
          />
          <StatCard
            label="流量"
            value={`${formatBytes(overview.requestBytes)} / ${formatBytes(overview.responseBytes)}`}
            sub="请求 / 响应（近24h）"
          />
          <StatCard
            label="下次执行"
            value={
              overview.overdue > 0
                ? `已到期 ×${overview.overdue}`
                : overview.nextDueAt
                  ? formatHumanTime(overview.nextDueAt)
                  : "—"
            }
            sub="最近的计划任务"
          />
        </div>
      )}

      <TaskTimelineChart timeline={timeline} />

      <div className="mt-6 mb-6 flex flex-wrap gap-2">
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className={inputLineClass + " max-w-44"}
        >
          <option value="all">全部项目</option>
          {projectOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value)}
          className={inputLineClass + " max-w-32"}
        >
          <option value="all">全部平台</option>
          {platformOptions.map((platform) => (
            <option key={platform} value={platform}>
              {platformLabel(platform)}
            </option>
          ))}
        </select>
        <select
          value={languageFilter}
          onChange={(e) => setLanguageFilter(e.target.value)}
          className={inputLineClass + " max-w-36"}
        >
          <option value="all">全部语言</option>
          {languageOptions.map((lang) => (
            <option key={lang} value={lang}>
              {languageLabel(lang) || lang}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-6">
        <TaskSection title={`准备进行（${pendingGroups.length} 组）`} groups={pendingGroups} />
        <TaskSection title={`失败（${failedGroups.length} 组）`} groups={failedGroups} />
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 shadow-sm">
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100 leading-tight">
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">{sub}</div>}
    </div>
  );
}

function niceStep(target: number): number {
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  for (const step of steps) {
    if (target <= step) return step;
  }
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  const base = target / pow;
  const multiplier = base <= 1 ? 1 : base <= 2 ? 2 : base <= 5 ? 5 : 10;
  return multiplier * pow;
}

function TaskTimelineChart({
  timeline,
}: {
  timeline?: {
    recent: { hour: number; success: number; failed: number }[];
    upcoming: { hour: number; count: number }[];
  };
}) {
  const [hovered, setHovered] = useState<{
    index: number;
    title: string;
    lines: [string, string][];
  } | null>(null);
  const recent = timeline?.recent ?? [];
  const upcoming = timeline?.upcoming ?? [];
  // One continuous timeline. The current hour appears in BOTH the recent
  // (executed) and upcoming (planned) arrays, so merge it into a single
  // stacked bucket: 23 past + 1 current + 23 future = 47 bars.
  const buckets: { hour: number; planned: number; success: number; failed: number }[] = [];
  for (let index = 0; index < 23; index++) {
    const r = recent[index] || { hour: 0, success: 0, failed: 0 };
    buckets.push({ hour: r.hour, planned: 0, success: r.success, failed: r.failed });
  }
  const currentR = recent[23] || { hour: 0, success: 0, failed: 0 };
  const currentU = upcoming[0] || { hour: 0, count: 0 };
  buckets.push({
    hour: currentR.hour || currentU.hour,
    planned: currentU.count,
    success: currentR.success,
    failed: currentR.failed,
  });
  for (let index = 1; index < 24; index++) {
    const u = upcoming[index] || { hour: 0, count: 0 };
    buckets.push({ hour: u.hour, planned: u.count, success: 0, failed: 0 });
  }
  const W = 780;
  const H = 200;
  const padL = 36;
  const padR = 10;
  const padT = 26;
  const padB = 30;
  const chartW = W - padL - padR;
  const currentIndex = 23;
  const barW = chartW / buckets.length;
  const plotH = H - padT - padB;
  const maxV = Math.max(
    1,
    ...buckets.map((b) => b.planned + b.success + b.failed),
  );
  const step = niceStep(Math.max(1, Math.ceil(maxV / 4)));
  const yTicks: number[] = [];
  for (let value = 0; value < maxV; value += step) yTicks.push(value);
  yTicks.push(maxV);
  const nowX = padL + (currentIndex + 0.5) * barW;
  const y = (v: number) => padT + plotH - (v / maxV) * plotH;
  const hourLabel = (ts: number) =>
    `${String(new Date(ts).getHours()).padStart(2, "0")}:00`;
  const xTickIndexes = [0, 6, 12, 18, 23, 29, 35, 41, 46];
  const relLabel = (i: number) =>
    i === 23 ? "现在" : `${i < 23 ? "-" : "+"}${Math.abs(i - 23)}h`;

  const hoverInfo = (index: number): { title: string; lines: [string, string][] } => {
    const b = buckets[index] || { hour: 0, planned: 0, success: 0, failed: 0 };
    const lines: [string, string][] = [];
    if (b.planned > 0) lines.push(["计划任务", `${b.planned} 个`]);
    if (b.success > 0) lines.push(["成功", `${b.success} 次`]);
    if (b.failed > 0) lines.push(["失败", `${b.failed} 次`]);
    if (lines.length === 0) lines.push(["本时段", "无活动"]);
    return {
      title: hourLabel(b.hour),
      lines,
    };
  };

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
      <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">执行时间线</h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
          每小时计划任务与实际执行叠加（悬停查看详情）
        </p>
      </div>
      <div className="px-6 py-4 relative">
        {hovered && (
          <div
            className="absolute z-10 -translate-x-1/2 pointer-events-none rounded-lg bg-zinc-900/95 dark:bg-zinc-800/95 text-white px-2.5 py-1.5 shadow-lg"
            style={{
              left: `${((padL + (hovered.index + 0.5) * barW) / W) * 100}%`,
              top: 8,
            }}
          >
            <div className="text-[11px] font-semibold">{hovered.title}</div>
            {hovered.lines.map(([label, value]) => (
              <div key={label} className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-300">
                <span>{label}</span>
                <span className="font-mono text-white">{value}</span>
              </div>
            ))}
          </div>
        )}
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={padL}
                y1={y(tick)}
                x2={W - padR}
                y2={y(tick)}
                stroke="currentColor"
                className="text-zinc-100 dark:text-zinc-800"
                strokeWidth="1"
              />
              <text x={padL - 6} y={y(tick) + 3} textAnchor="end" fontSize="10" className="fill-zinc-400">
                {tick}
              </text>
            </g>
          ))}
          <line
            x1={padL}
            y1={padT + plotH}
            x2={W - padR}
            y2={padT + plotH}
            stroke="currentColor"
            className="text-zinc-300 dark:text-zinc-700"
            strokeWidth="1"
          />
          {buckets.map((b, i) => {
            const x = padL + i * barW;
            const plannedH = (b.planned / maxV) * plotH;
            const successH = (b.success / maxV) * plotH;
            const failedH = (b.failed / maxV) * plotH;
            return (
              <g key={`b-${i}`}>
                {b.planned > 0 && (
                  <rect
                    x={x}
                    y={padT + plotH - plannedH}
                    width={barW - 1}
                    height={plannedH}
                    fill="#f59e0b"
                    opacity="0.55"
                    rx="1"
                  />
                )}
                {b.success > 0 && (
                  <rect
                    x={x}
                    y={padT + plotH - plannedH - successH}
                    width={barW - 1}
                    height={successH}
                    fill="#10b981"
                    rx="1"
                  />
                )}
                {b.failed > 0 && (
                  <rect
                    x={x}
                    y={padT + plotH - plannedH - successH - failedH}
                    width={barW - 1}
                    height={failedH}
                    fill="#ef4444"
                    rx="1"
                  />
                )}
              </g>
            );
          })}
          {hovered && (
            <line
              x1={padL + (hovered.index + 0.5) * barW}
              y1={padT}
              x2={padL + (hovered.index + 0.5) * barW}
              y2={padT + plotH}
              stroke="#a1a1aa"
              strokeWidth="1"
              strokeDasharray="2 2"
            />
          )}
          <line
            x1={nowX}
            y1={padT - 4}
            x2={nowX}
            y2={padT + plotH}
            stroke="#f59e0b"
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />
          {xTickIndexes.map((i) => (
            <text
              key={i}
              x={padL + (i + 0.5) * barW}
              y={H - 10}
              textAnchor="middle"
              fontSize="10"
              className={i === 24 ? "fill-amber-500 font-medium" : "fill-zinc-400"}
            >
              {relLabel(i)}
            </text>
          ))}
          <text x={W - padR} y={H - 10} textAnchor="end" fontSize="10" className="fill-zinc-400">
            +24h
          </text>
          {Array.from({ length: buckets.length }, (_, i) => (
            <rect
              key={`o-${i}`}
              x={padL + i * barW}
              y={padT}
              width={barW}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHovered({ index: i, ...hoverInfo(i) })}
              onMouseLeave={() => setHovered(null)}
            />
          ))}
        </svg>
        <div className="mt-3 flex items-center gap-4 text-[11px] text-zinc-500 dark:text-zinc-400">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />成功
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-red-500" />失败
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 opacity-55" />计划任务
          </span>
        </div>
      </div>
    </div>
  );
}

function groupTasks(tasks: any[]): any[] {
  const map = new Map<string, any>();
  for (const task of tasks) {
    const key = `${task.projectName}\u0000${task.platform}\u0000${task.queryLanguage || ""}\u0000${task.storefront || ""}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        key,
        kind: "rank",
        projectName: task.projectName,
        productName: task.productName,
        platform: task.platform,
        queryLanguage: task.queryLanguage,
        storefront: task.storefront,
        tasks: [task],
        lastRunAt: task.lastRunAt,
        nextRunAt: task.nextRunAt,
        firstRunAt: task.firstRunAt,
        executionCount: task.executionCount || 0,
      });
    } else {
      existing.tasks.push(task);
      if (task.lastRunAt && (!existing.lastRunAt || new Date(task.lastRunAt) > new Date(existing.lastRunAt))) {
        existing.lastRunAt = task.lastRunAt;
      }
      if (new Date(task.nextRunAt) < new Date(existing.nextRunAt)) {
        existing.nextRunAt = task.nextRunAt;
      }
      existing.executionCount += task.executionCount || 0;
      if (task.firstRunAt && (!existing.firstRunAt || new Date(task.firstRunAt) < new Date(existing.firstRunAt))) {
        existing.firstRunAt = task.firstRunAt;
      }
    }
  }
  return [...map.values()];
}

function TaskSection({ title, groups }: { title: string; groups: any[] }) {
  const [page, setPage] = useState(0);
  const pageSize = 8;
  useEffect(() => {
    setPage(0);
  }, [title, groups.length]);
  if (groups.length === 0) return null;
  const totalPages = Math.max(1, Math.ceil(groups.length / pageSize));
  const visible = groups.slice(page * pageSize, page * pageSize + pageSize);

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
      <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
      </div>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {visible.map((group) => (
          <div key={group.key} className="px-5 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2 min-w-0">
                <span
                  className="mt-0.5 px-2 py-0.5 rounded text-[10px] font-medium shrink-0 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
                >
                  排名
                </span>
                <div className="min-w-0">
                  <div className="text-sm text-zinc-800 dark:text-zinc-200 truncate">
                    {`${group.projectName} · ${
                      group.platform === "ios"
                        ? "iOS"
                        : group.platform === "macos"
                          ? "macOS"
                          : "未识别"
                    } · ${languageLabel(group.queryLanguage || "")} · ${
                      storefrontDisplayName(group.storefront || "")
                    } · ${group.tasks.length} 个关键词`}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <TaskMeta label="下次执行" value={formatHumanTime(group.nextRunAt)} />
              <TaskMeta
                label="上次执行"
                value={group.lastRunAt ? formatHumanTime(group.lastRunAt) : "尚未执行"}
              />
              <TaskMeta label="执行次数" value={`${group.executionCount} 次`} />
              <TaskMeta
                label="首次执行"
                value={group.firstRunAt ? formatHumanTime(group.firstRunAt) : "—"}
              />
            </div>
          </div>
        ))}
      </div>
      {totalPages > 1 && (
        <div className="px-6 py-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between text-xs text-zinc-400 dark:text-zinc-500">
          <span>
            {page + 1} / {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((value) => Math.max(0, value - 1))}
              disabled={page === 0}
              className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 disabled:opacity-40"
            >
              上一页
            </button>
            <button
              onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}
              disabled={page >= totalPages - 1}
              className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 disabled:opacity-40"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TaskMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mb-0.5">{label}</div>
      <div className="text-zinc-600 dark:text-zinc-300 truncate">{value}</div>
    </div>
  );
}

function PlaceholderPage({ title, desc }: { title: string; desc: string }) {
  const { projects, currentProjectId } = useProject();
  if (!projects.some((p) => p.id === currentProjectId)) {
    return <EmptyState title="还没有项目" desc="添加一个项目后，这里会展示数据。" />;
  }
  return (
    <div className="p-10 max-w-6xl mx-auto">
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">{title}</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-8">{desc}</p>
      <div className="rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 p-10 text-center text-sm text-zinc-400 dark:text-zinc-500">
        该界面将在 Phase A 后续步骤实现
      </div>
    </div>
  );
}

function EmptyState({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="p-10 max-w-2xl mx-auto">
      <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl bg-white dark:bg-zinc-900/50">
        <div className="w-12 h-12 rounded-full bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center mb-3">
          <span className="text-amber-500 text-lg">⌖</span>
        </div>
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">{title}</h3>
        <p className="text-sm text-zinc-400 dark:text-zinc-500">{desc}</p>
      </div>
    </div>
  );
}

/* ── Manage projects (remove is a deliberate, typed-confirmation action) ── */

function ManageProjectsPage() {
  const { projects, remove } = useProject();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");

  return (
    <div className="p-10 max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">管理项目</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-8">移除项目是不可撤销的操作，需输入项目名确认。</p>

      {projects.length === 0 && (
        <EmptyState title="还没有项目" desc="在侧栏「选择项目」里添加一个项目。" />
      )}

      <div className="space-y-3">
        {projects.map((p) => (
          <div key={p.id} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
            <div className="px-5 py-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">{p.name}</p>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate mt-0.5">{p.localPath}</p>
              </div>
              {confirmingId !== p.id && (
                <button
                  onClick={() => { setConfirmingId(p.id); setConfirmText(""); }}
                  className="shrink-0 px-3 py-1.5 text-sm rounded-lg text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/50 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
                >
                  移除
                </button>
              )}
            </div>

            {confirmingId === p.id && (
              <div className="px-5 py-4 border-t border-red-200 dark:border-red-800/50 bg-red-50/50 dark:bg-red-950/10 space-y-3">
                <p className="text-sm text-red-700 dark:text-red-400">
                  移除项目「{p.name}」？移除后，关键词、排名历史、素材将不再显示。此操作不可撤销。
                </p>
                <input
                  autoFocus
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={`输入 ${p.name} 以确认`}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => { setConfirmingId(null); setConfirmText(""); }}
                    className="px-3 py-1.5 text-sm rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
                  >
                    取消
                  </button>
                  <button
                    disabled={confirmText !== p.name}
                    onClick={async () => { await remove(p.id); setConfirmingId(null); setConfirmText(""); }}
                    className="px-3 py-1.5 text-sm rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    确认移除
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Keywords (tracking vs submission, one AI request per language) ── */

interface KeywordSuggestion {
  language: string;
  keyword: string;
  rationale: string;
  translation: string;
}

interface KeywordGeneration {
  tracking: KeywordSuggestion[];
}

function MatrixCellView({ cell }: { cell: MatrixCell }) {
  const rankText = cell.beyond200 ? "200+" : cell.rank ?? "—";
  const trendText =
    cell.trend === "new" ? "进榜"
    : cell.trend === "lost" ? "掉榜"
    : cell.trend === "up" ? `▲ ${cell.delta}`
    : cell.trend === "down" ? `▼ ${Math.abs(cell.delta ?? 0)}`
    : null;
  return (
    <span className="inline-flex items-baseline gap-1 justify-end">
      <span
        className={cn(
          "font-mono",
          cell.rank !== null && cell.rank <= 10
            ? "text-amber-600 dark:text-amber-400 font-semibold"
            : "text-zinc-600 dark:text-zinc-300",
        )}
      >
        {rankText}
      </span>
      {trendText && (
        <span
          className={cn(
            "text-[10px] font-mono",
            cell.trend === "up" || cell.trend === "new"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400",
          )}
        >
          {trendText}
        </span>
      )}
    </span>
  );
}

function formatKilo(chars: number): string {
  return `${(chars / 1000).toFixed(1).replace(/\.0$/, "")}K字`;
}

function formatTokens(n: number): string {
  if (n < 1000) return `${Math.round(n)}`;
  return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0B";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatDuration(ms: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}分${s > 0 ? `${String(s).padStart(2, "0")}秒` : ""}`;
}

function AIProgressButton({
  onClick,
  disabled = false,
  idleLabel,
  loading,
  progress,
}: {
  onClick: () => void;
  disabled?: boolean;
  idleLabel: string;
  loading: boolean;
  progress: { chars: number; phase: "reasoning" | "content" } | null;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!loading) return;
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [loading]);
  const chars = progress?.chars || 0;
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(btnPrimary, "h-10 min-w-36 whitespace-nowrap", loading && "py-1")}
    >
      {loading ? (
        <span className="flex flex-col items-center text-[11px] leading-tight">
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
            {progress?.phase === "content" ? "生成中" : "思考中"}
          </span>
          <span className="mt-0.5 font-mono">{formatKilo(chars)} · {formatElapsed(elapsed)}</span>
        </span>
      ) : (
        idleLabel
      )}
    </button>
  );
}

function RankTooltip({ active, payload, label }: any) {
  if (!active || !Array.isArray(payload)) return null;
  const rows = payload.filter((item: any) => item.value != null);
  if (rows.length === 0) return null;
  const date = new Date(label);
  const labelText = Number.isNaN(date.getTime())
    ? String(label)
    : `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-zinc-500 dark:text-zinc-400">{labelText}</p>
      {rows.map((item: any) => (
        <p key={item.dataKey} className="flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300">
          <span
            className="inline-block w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: item.stroke || item.color }}
          />
          {item.name}：第 {item.value} 名
        </p>
      ))}
    </div>
  );
}

function ChartTick({ x, y, payload }: any) {
  const date = new Date(payload.value);
  if (Number.isNaN(date.getTime())) return null;
  return (
    <text x={x} y={y} textAnchor="middle" fill="#71717a" fontSize={10}>
      <tspan x={x} dy={20}>{date.toLocaleDateString()}</tspan>
      <tspan x={x} dy={12}>{date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</tspan>
    </text>
  );
}

function KeywordsPage() {
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
  const [showUnranked, setShowUnranked] = useState(false);
  const [error, setError] = useState("");
  const [selectedKeyword, setSelectedKeyword] = useState<string>("");
  const [schedulerStatus, setSchedulerStatus] = useState<{ enabled: boolean; total: number; due: number; failed: number; nextDueAt: string | null } | null>(null);
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
  const storefronts = storefrontsForLanguage(currentLang);
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
      <div className="py-1.5 pl-5 pr-4 min-w-0">
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
    setShowUnranked(true);
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
    <div className="p-8 max-w-6xl mx-auto h-full flex flex-col">
      {error && (
        <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/50 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {languages.length === 0 ? (
        <EmptyState title="未识别支持语言" desc="请先在总览确认项目已识别出语言，再生成关键词。" />
      ) : (
        <>
          <div className="flex-1 min-h-0 flex flex-col rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
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

            <div
              className="grid items-start border-b border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 pr-1.5"
              style={{ gridTemplateColumns: matrixGridTemplate }}
            >
              <div className="py-2.5 pl-5 pr-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    关键词（{trackedActive.length}）
                  </span>
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
                        <span className="relative">
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
                        <span className="relative">
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
                      {unranked.length > 0 && (
                        <span className="relative">
                          <button
                            type="button"
                            onClick={() => setShowUnranked((v) => !v)}
                            className={cn(
                              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors",
                              showUnranked
                                ? "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400"
                                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700",
                            )}
                          >
                            未在榜 {unranked.length}
                          </button>
                          {showUnranked && (
                            <div className="absolute right-0 top-full mt-1.5 z-30 w-80 max-h-72 overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg p-3">
                              <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
                                未在榜（尚未采集到排名）
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {unranked.map((row) => (
                                  <span
                                    key={`${row.language}:${row.keyword}`}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-500 dark:text-zinc-400"
                                  >
                                    {row.keyword}
                                    <span className="text-[10px] text-zinc-400">
                                      {row.language === "en" ? "全局" : languageLabel(row.language)}
                                    </span>
                                  </span>
                                ))}
                              </div>
                              <p className="mt-2 text-[10px] text-zinc-400 dark:text-zinc-500">
                                这些关键词已排入自动采集任务，获得排名数据后会自动进入入榜列表。
                              </p>
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
                          ? " · 已到期"
                          : ` · 下次 ${new Date(schedulerStatus.nextDueAt).toLocaleString()}`
                        : ""}
                    </span>
                    <button
                      onClick={() => (window as any).appilot?.scheduler?.runDue()}
                      className="text-amber-600 dark:text-amber-400 hover:underline"
                      title="立即执行已到期的采集任务"
                    >
                      立即执行
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

            <div className="flex-1 min-h-0 overflow-auto [scrollbar-gutter:stable]">
                {matrixRows.length === 0 ? (
                  <p className="text-sm text-zinc-400 dark:text-zinc-500 py-4 text-center">
                    暂无关键词，点击「为所选语言生成」。
                  </p>
                ) : scopeFilteredRanked.length === 0 && unranked.length === 0 ? (
                  <p className="text-sm text-zinc-400 dark:text-zinc-500 py-4 text-center">
                    该筛选范围内暂无关键词。
                  </p>
                ) : (
                  <>
                    {scopeFilteredRanked.map(({ row }) => renderMatrixRow(row, false))}
                    {scopeFilteredRanked.length === 0 &&
                      unranked.map((row) => renderMatrixRow(row, true))}
                  </>
                )}
            </div>

            <div className="shrink-0 px-5 pb-5 space-y-5 border-t border-zinc-100 dark:border-zinc-800">
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

          </div>
        </>
      )}

      {curationOpen && Object.keys(curation).length > 0 && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6">
          <div className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between gap-4">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">关键词整理建议</h3>
              <span className="text-xs text-zinc-400 dark:text-zinc-500">
                新增 {acceptedAdds} · 移除 {acceptedRemovals} · 忽略/保留 {ignoredCount}
              </span>
            </div>

            <div className="flex-1 min-h-0 overflow-auto p-5 space-y-4">
              {Object.entries(curation).map(([lang, data]) => (
                <div key={lang} className="space-y-2">
                  <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{languageLabel(lang)}</p>
                  {data.removals.map((item) => (
                    <div
                      key={`rm:${item.keyword}`}
                      className={cn(
                        "flex items-start justify-between gap-3 rounded-lg border px-3 py-2 transition-colors",
                        item.choice === "accept"
                          ? "border-red-200/70 dark:border-red-500/40 bg-red-50/40 dark:bg-red-500/5"
                          : "opacity-60 border-zinc-200 dark:border-zinc-700",
                      )}
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-zinc-800 dark:text-zinc-200">
                          {item.keyword}
                          <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-500/15 text-[10px] font-medium text-red-600 dark:text-red-400 align-middle">
                            移除
                          </span>
                        </p>
                        <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">{item.reason}</p>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <button
                          onClick={() => setItemChoice(lang, "removals", item.keyword, "accept")}
                          className={cn(
                            "px-2.5 py-1 text-xs rounded-lg border transition-colors",
                            item.choice === "accept"
                              ? "border-red-300 dark:border-red-500/50 bg-red-500 text-white"
                              : "border-red-200 dark:border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10",
                          )}
                        >
                          采纳移除
                        </button>
                        <button
                          onClick={() => setItemChoice(lang, "removals", item.keyword, "ignore")}
                          className={cn(
                            "px-2.5 py-1 text-xs rounded-lg border transition-colors",
                            item.choice === "ignore"
                              ? "border-zinc-400 dark:border-zinc-500 bg-zinc-500 text-white"
                              : "border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
                          )}
                        >
                          保留
                        </button>
                      </div>
                    </div>
                  ))}
                  {data.adds.map((item) => (
                    <div
                      key={`add:${item.keyword}`}
                      className={cn(
                        "flex items-start justify-between gap-3 rounded-lg border px-3 py-2 transition-colors",
                        item.choice === "accept"
                          ? "border-emerald-200/70 dark:border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-500/5"
                          : "opacity-60 border-zinc-200 dark:border-zinc-700",
                      )}
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-zinc-800 dark:text-zinc-200">
                          {item.keyword}
                          {item.translation && item.translation !== item.keyword ? `（${item.translation}）` : ""}
                          <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 align-middle">
                            新增
                          </span>
                        </p>
                        <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">{item.rationale}</p>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <button
                          onClick={() => setItemChoice(lang, "adds", item.keyword, "accept")}
                          className={cn(
                            "px-2.5 py-1 text-xs rounded-lg border transition-colors",
                            item.choice === "accept"
                              ? "border-emerald-300 dark:border-emerald-500/50 bg-emerald-500 text-white"
                              : "border-emerald-200 dark:border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10",
                          )}
                        >
                          采纳新增
                        </button>
                        <button
                          onClick={() => setItemChoice(lang, "adds", item.keyword, "ignore")}
                          className={cn(
                            "px-2.5 py-1 text-xs rounded-lg border transition-colors",
                            item.choice === "ignore"
                              ? "border-zinc-400 dark:border-zinc-500 bg-zinc-500 text-white"
                              : "border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
                          )}
                        >
                          忽略
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div className="px-5 py-4 border-t border-zinc-100 dark:border-zinc-800 space-y-3">
              {curationConfirm === "apply" && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200/70 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/10 px-3 py-2">
                  <p className="text-xs text-zinc-700 dark:text-zinc-300">
                    将新增 {acceptedAdds} 个、移除 {acceptedRemovals} 个关键词，确认执行？
                  </p>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => applyCuration()}
                      className="text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline"
                    >
                      确认
                    </button>
                    <button
                      onClick={() => setCurationConfirm(null)}
                      className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
              {curationConfirm === "discard" && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2">
                  <p className="text-xs text-zinc-600 dark:text-zinc-300">关闭后将丢弃本次建议，确认？</p>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => discardCuration()}
                      className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
                    >
                      确认丢弃
                    </button>
                    <button
                      onClick={() => setCurationConfirm(null)}
                      className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex gap-2">
                  <button
                    onClick={() => selectAllCuration("accept")}
                    className="px-3 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
                  >
                    全部采纳/移除
                  </button>
                  <button
                    onClick={() => selectAllCuration("ignore")}
                    className="px-3 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
                  >
                    全部忽略/保留
                  </button>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setCurationConfirm("apply")} className={btnPrimary}>
                    确定
                  </button>
                  <button onClick={() => setCurationConfirm("discard")} className={btnSecondary}>
                    关闭
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Settings Page (沿用，Phase A 暂不动) ── */

const AI_PRESETS = [
  { label: "OpenAI", url: "https://api.openai.com/v1", model: "gpt-4o" },
  { label: "OpenAI (Mini)", url: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { label: "DeepSeek", url: "https://api.deepseek.com", model: "deepseek-v4-flash" },
  { label: "Groq", url: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  { label: "Ollama (Local)", url: "http://localhost:11434/v1", model: "llama3" },
  { label: "Custom", url: "", model: "" },
];

const inputClass = "w-full px-3.5 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 dark:focus:border-amber-400 transition-shadow";
const inputLineClass = "w-full h-9 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 dark:focus:border-amber-400 transition-shadow";
const btnPrimary = "inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-amber-500 hover:bg-amber-600 text-white shadow-sm transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed";
const btnSecondary = "inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-all duration-150";
const btnSmPrimary = "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-500 hover:bg-amber-600 text-white shadow-sm transition-all duration-150";
const btnSmSecondary = "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-all duration-150";

function ProjectSettingsPage() {
  const { projectId = "" } = useParams();
  const { projects, load } = useProject();
  const project = projects.find((item) => item.id === projectId) || null;
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoMsg, setInfoMsg] = useState("");
  const [error, setError] = useState("");
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [creds, setCreds] = useState<any>(null);

  useEffect(() => {
    if (!projectId) return;
    (window as any).appilot?.projects
      ?.getCredentials(projectId)
      .then(setCreds)
      .catch(() => setCreds(null));
  }, [projectId]);

  const refreshCreds = async () => {
    if (!projectId) return;
    const next = await (window as any).appilot.projects.getCredentials(projectId);
    setCreds(next);
  };
  const hasOverride =
    creds?.githubSource === "project" || creds?.ascSource === "project";

  useEffect(() => {
    if (!project) return;
    setName(project.name);
    setLocalPath(project.localPath);
    setGithubUrl(project.repo?.githubUrl || "");
  }, [project?.id]);

  if (!project) {
    return <EmptyState title="项目不存在" desc="返回总览选择一个项目。" />;
  }

  const handleSaveInfo = async () => {
    setSavingInfo(true);
    setInfoMsg("");
    setError("");
    try {
      await (window as any).appilot.projects.updateSettings(project.id, {
        name: name.trim(),
        localPath: localPath.trim(),
        githubUrl: githubUrl.trim() || null,
      });
      await load();
      setInfoMsg("已保存");
    } catch (e: any) {
      setError(e.message || "保存失败");
    } finally {
      setSavingInfo(false);
    }
  };

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate("/overview")}
          className="text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 text-lg"
          title="返回总览"
        >
          ←
        </button>
        <div>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">项目设置</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
            {project.name} · 基本信息与 API 凭据
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/50 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* 基本信息 */}
      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden mb-6">
        <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">基本信息</h3>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
              项目名称
            </label>
            <input
              className={inputLineClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="项目显示名"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
              本地仓库路径
            </label>
            <div className="flex gap-2">
              <input
                className={inputLineClass}
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                placeholder="/path/to/repo"
              />
              <button
                onClick={async () => {
                  const folder = await (window as any).appilot?.dialog?.selectFolder();
                  if (folder) setLocalPath(folder);
                }}
                className={btnSmSecondary + " shrink-0"}
                type="button"
              >
                选择…
              </button>
            </div>
            <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
              仓库移动/改名后在此重新指向；保存时会校验目录与 .git 并重扫仓库信息。
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
              GitHub 仓库 URL
            </label>
            <input
              className={inputLineClass}
              value={githubUrl}
              onChange={(e) => setGithubUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
            />
            <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
              默认从 git remote 探测；留空保存则恢复自动探测。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void handleSaveInfo()} disabled={savingInfo} className={btnPrimary}>
              {savingInfo ? "保存中…" : "保存基本信息"}
            </button>
            {infoMsg && <span className="text-xs text-emerald-600 dark:text-emerald-400">{infoMsg}</span>}
          </div>
        </div>
      </section>

      {/* 凭据（本项目覆盖） */}
      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden mb-6">
        <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            API 凭据（本项目覆盖）
          </h3>
        </div>
        {!overrideOpen ? (
          <div className="p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm text-zinc-800 dark:text-zinc-200">
                  {hasOverride ? "已使用本项目凭据" : "默认使用全局凭据"}
                </div>
                <div className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-1">
                  全局 GitHub Token {creds?.globalGithubTokenSet ? "✓ 已配置" : "✕ 未配置"}
                  {" · "}全局 ASC Key {creds?.globalAscKeySet ? "✓ 已配置" : "✕ 未配置"}
                  {hasOverride
                    ? "；本项目已覆盖，可点击右侧查看/修改。"
                    : "；未配置全局时相关能力不可用。"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOverrideOpen(true)}
                className={btnSmSecondary + " shrink-0"}
              >
                {hasOverride ? "查看/修改本项目凭据" : "使用其他凭证"}
              </button>
            </div>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                全局凭据自动适用于本项目；这里填写的内容仅覆盖本项目，未填写的项继续使用全局。
                清除本项目凭据后回退全局。
              </p>
              <button
                type="button"
                onClick={() => setOverrideOpen(false)}
                className={btnSmSecondary + " shrink-0"}
              >
                收起
              </button>
            </div>
            <CredentialsForm
              projectId={project.id}
              scope="project"
              onChanged={() => void refreshCreds()}
            />
          </div>
        )}
      </section>
    </div>
  );
}

function GithubIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="currentColor"
      className="text-zinc-700 dark:text-zinc-300 shrink-0"
      aria-hidden="true"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="currentColor"
      className="text-zinc-700 dark:text-zinc-300 shrink-0"
      aria-hidden="true"
    >
      <path d="M17.05 12.53c-.02-2.36 1.93-3.49 2.02-3.55-1.1-1.61-2.81-1.83-3.42-1.85-1.45-.15-2.83.86-3.57.86-.74 0-1.88-.84-3.09-.82-1.59.02-3.06.92-3.88 2.35-1.65 2.87-.42 7.12 1.19 9.45.79 1.14 1.73 2.42 2.96 2.37 1.19-.05 1.64-.77 3.08-.77s1.84.77 3.11.74c1.28-.02 2.1-1.16 2.88-2.3.91-1.33 1.28-2.62 1.3-2.68-.03-.01-2.5-.96-2.52-3.84zM14.45 5.41c.65-.79 1.09-1.89.97-2.99-.94.04-2.08.63-2.75 1.42-.6.7-1.13 1.83-.99 2.91 1.05.08 2.12-.54 2.77-1.34z" />
    </svg>
  );
}

const GITHUB_CAPABILITIES = ["私有/草案 release 公告", "真实 PR 素材", "远程仓库数据"];
const ASC_CAPABILITIES = ["版本/审核状态回读", "审核意见", "评论洞察", "销量/下载分析"];

function CredentialsForm({
  projectId,
  scope,
  onChanged,
}: {
  projectId: string;
  scope: "global" | "project";
  onChanged?: () => void;
}) {
  const [githubToken, setGithubToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [ascIssuerId, setAscIssuerId] = useState("");
  const [ascKeyId, setAscKeyId] = useState("");
  const [ascKeyPath, setAscKeyPath] = useState("");
  const [creds, setCreds] = useState<any>(null);
  const [testing, setTesting] = useState<"github" | "asc" | null>(null);
  const [feedback, setFeedback] = useState<{
    github?: { ok: boolean; msg: string };
    asc?: { ok: boolean; msg: string };
  }>({});
  const [saved, setSaved] = useState<{ github: boolean; asc: boolean }>({
    github: false,
    asc: false,
  });
  const [saveError, setSaveError] = useState<"github" | "asc" | null>(null);
  const [editing, setEditing] = useState<{ github: boolean; asc: boolean }>({
    github: false,
    asc: false,
  });
  const [confirmClear, setConfirmClear] = useState<{ github: boolean; asc: boolean }>({
    github: false,
    asc: false,
  });

  useEffect(() => {
    refreshCreds().catch(() => setCreds(null));
  }, [projectId]);

  // Re-enter mode always shows the saved values: fill empty fields whenever
  // credentials arrive/refresh, preserving anything the user typed.
  useEffect(() => {
    if (!editing.github || !creds?.githubTokenMasked) return;
    setGithubToken((current) => current || creds.githubTokenMasked || "");
  }, [editing.github, creds?.githubTokenMasked]);

  useEffect(() => {
    if (!editing.asc || !creds) return;
    setAscIssuerId((current) => current || creds.ascIssuerId || "");
    setAscKeyId((current) => current || creds.ascKeyId || "");
    setAscKeyPath((current) => current || creds.ascPrivateKeyPath || "");
  }, [editing.asc, creds]);

  const refreshCreds = async () => {
    const next = await (window as any).appilot.projects.getCredentials(projectId);
    setCreds(next);
  };

  const githubUnlocked = Boolean(creds?.hasGithubToken);
  const ascUnlocked = Boolean(creds?.hasAscKey);
  const githubSource =
    creds?.githubSource === "project" ? "项目覆盖" : creds?.githubSource === "global" ? "全局" : null;
  const ascSource =
    creds?.ascSource === "project" ? "项目覆盖" : creds?.ascSource === "global" ? "全局" : null;

  const testAndSave = async (kind: "github" | "asc") => {
    setTesting(kind);
    setSaveError(null);
    try {
      const githubValue =
        kind === "github" && githubToken === creds?.githubTokenMasked
          ? undefined
          : githubToken;
      const r =
        kind === "github"
          ? await (window as any).appilot.projects.testGithubToken(projectId, githubValue)
          : await (window as any).appilot.projects.testAscKey(projectId, {
              issuerId: ascIssuerId,
              keyId: ascKeyId,
              privateKeyPath: ascKeyPath,
            });
      if (!r.ok) {
        setFeedback((prev) => ({
          ...prev,
          [kind]: { ok: false, msg: r.error || "测试失败" },
        }));
        return;
      }
      setFeedback((prev) => ({
        ...prev,
        [kind]: { ok: true, msg: "测试通过" },
      }));
      await (window as any).appilot.projects.saveCredentials(projectId, {
        scope,
        githubToken: kind === "github" ? githubValue : undefined,
        ascIssuerId: kind === "asc" ? ascIssuerId : undefined,
        ascKeyId: kind === "asc" ? ascKeyId : undefined,
        ascPrivateKeyPath: kind === "asc" ? ascKeyPath : undefined,
      });
      setSaved((prev) => ({ ...prev, [kind]: true }));
      setEditing((prev) => ({ ...prev, [kind]: false }));
      setConfirmClear((prev) => ({ ...prev, [kind]: false }));
      if (kind === "github") setGithubToken("");
      else {
        setAscIssuerId("");
        setAscKeyId("");
        setAscKeyPath("");
      }
      await refreshCreds();
      onChanged?.();
    } catch (e: any) {
      setSaveError(kind);
      setFeedback((prev) => ({
        ...prev,
        [kind]: { ok: false, msg: e.message || "测试失败" },
      }));
    } finally {
      setTesting(null);
    }
  };

  const clearBlock = async (kind: "github" | "asc") => {
    if (!confirmClear[kind]) {
      setConfirmClear((prev) => ({ ...prev, [kind]: true }));
      return;
    }
    setConfirmClear((prev) => ({ ...prev, [kind]: false }));
    setSaveError(null);
    try {
      await (window as any).appilot.projects.saveCredentials(projectId, {
        scope,
        githubToken: kind === "github" ? "" : undefined,
        ascIssuerId: kind === "asc" ? "" : undefined,
        ascKeyId: kind === "asc" ? "" : undefined,
        ascPrivateKeyPath: kind === "asc" ? "" : undefined,
      });
      setSaved((prev) => ({ ...prev, [kind]: false }));
      setFeedback((prev) => ({ ...prev, [kind]: undefined }));
      setEditing((prev) => ({ ...prev, [kind]: false }));
      if (kind === "github") setGithubToken("");
      else {
        setAscIssuerId("");
        setAscKeyId("");
        setAscKeyPath("");
      }
      await refreshCreds();
      onChanged?.();
    } catch (e: any) {
      setSaveError(kind);
    }
  };

  const handleTestGithub = async () => {
    setTesting("github");
    setSaveError(null);
    try {
      const r = await (window as any).appilot.projects.testGithubToken(
        projectId,
        githubToken || undefined,
      );
      setFeedback((prev) => ({
        ...prev,
        github: r.ok
          ? { ok: true, msg: `测试通过${r.user ? `：${r.user}` : ""}` }
          : { ok: false, msg: r.error || "连接失败" },
      }));
    } catch (e: any) {
      setFeedback((prev) => ({
        ...prev,
        github: { ok: false, msg: e.message || "连接失败" },
      }));
    } finally {
      setTesting(null);
    }
  };

  const handleTestAsc = async () => {
    setTesting("asc");
    setSaveError(null);
    try {
      const r = await (window as any).appilot.projects.testAscKey(projectId, {
        issuerId: ascIssuerId || undefined,
        keyId: ascKeyId || undefined,
        privateKeyPath: ascKeyPath || undefined,
      });
      setFeedback((prev) => ({
        ...prev,
        asc: r.ok
          ? { ok: true, msg: "测试通过" }
          : { ok: false, msg: r.error || "连接失败" },
      }));
    } catch (e: any) {
      setFeedback((prev) => ({
        ...prev,
        asc: { ok: false, msg: e.message || "连接失败" },
      }));
    } finally {
      setTesting(null);
    }
  };

  const basename = (full: string) => full.split("/").pop() || full;

  return (
    <div className="space-y-5">
      {!githubUnlocked || editing.github ? (
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <GithubIcon />
          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">GitHub Token</span>
          <CredentialStatus unlocked={githubUnlocked} source={githubSource} />
        </div>
        <div className="flex gap-2">
          <input
            className={inputLineClass + " font-mono"}
            type={showToken ? "text" : "password"}
            value={githubToken}
            onChange={(e) => {
              setGithubToken(e.target.value);
              setSaved((prev) => ({ ...prev, github: false }));
              setFeedback((prev) => ({ ...prev, github: undefined }));
              setConfirmClear((prev) => ({ ...prev, github: false }));
            }}
            placeholder={githubUnlocked ? "原 Token（修改则输入新值）" : "ghp_… 或 github_pat_…"}
          />
          <button
            type="button"
            onClick={() => setShowToken((value) => !value)}
            className={btnSmSecondary + " shrink-0"}
            title={showToken ? "隐藏" : "显示"}
          >
            {showToken ? "隐藏" : "显示"}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void testAndSave("github")}
            disabled={testing === "asc" || !githubToken.trim()}
            className={cn(
              btnSmPrimary,
              saveError === "github" && "!bg-red-500",
              saved.github && "!bg-emerald-500",
            )}
            title={
              !githubToken.trim()
                ? "请先输入 Token"
                : saveError === "github"
                  ? "保存失败，请重试"
                  : saved.github
                    ? "已保存"
                    : feedback.github?.msg
            }
          >
            {!githubToken.trim()
              ? "测试并保存"
              : testing === "github"
                ? "测试中…"
                : saveError === "github"
                  ? "✕ 保存失败"
                  : saved.github
                    ? "✓ 已保存"
                    : feedback.github && !feedback.github.ok
                      ? "✕ 测试失败"
                      : "测试并保存"}
          </button>
          <button
            type="button"
            onClick={() => void clearBlock("github")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors",
              confirmClear.github
                ? "bg-red-500 border-red-500 text-white hover:bg-red-600"
                : "border-red-300 dark:border-red-800 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20",
            )}
          >
            {confirmClear.github ? "确认清除？" : "清除"}
          </button>
          {githubUnlocked && (
            <button
              type="button"
              onClick={() => {
                setEditing((prev) => ({ ...prev, github: false }));
                setConfirmClear((prev) => ({ ...prev, github: false }));
                setGithubToken("");
                setFeedback((prev) => ({ ...prev, github: undefined }));
              }}
              className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              放弃修改
            </button>
          )}
        </div>
        {feedback.github && !feedback.github.ok && (
          <p className="text-[11px] text-red-500 dark:text-red-400">{feedback.github.msg}</p>
        )}
        <div className="text-[11px] text-zinc-400 dark:text-zinc-500 space-y-1">
          <p>
            获取：GitHub → Settings → Developer settings → Personal access tokens 创建；
            建议 fine-grained，仓库权限 Contents: Read、Releases: Read/Write。
          </p>
          <button
            type="button"
            onClick={() => (window as any).appilot?.openExternal("https://github.com/settings/personal-access-tokens")}
            className="text-amber-600 dark:text-amber-400 hover:underline"
          >
            前往创建 GitHub Token ↗
          </button>
        </div>
      </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <GithubIcon />
            <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">GitHub Token</span>
            <CredentialStatus unlocked source={githubSource} />
          </div>
          <ul className="space-y-1">
            {GITHUB_CAPABILITIES.map((capability) => (
              <li
                key={capability}
                className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400"
              >
                <span className="text-emerald-500">✓</span> {capability}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleTestGithub()}
              disabled={testing === "asc"}
              className={cn(
                btnSmSecondary,
                feedback.github?.ok &&
                  "!text-emerald-600 dark:!text-emerald-400 !border-emerald-300 dark:!border-emerald-800",
                feedback.github &&
                  !feedback.github.ok &&
                  "!text-red-600 dark:!text-red-400 !border-red-300 dark:!border-red-800",
              )}
              title={feedback.github?.msg}
            >
              {testing === "github"
                ? "测试中…"
                : feedback.github
                  ? feedback.github.ok
                    ? "✓ 测试通过"
                    : "✕ 测试失败"
                  : "测试凭证"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing((prev) => ({ ...prev, github: true }));
                setGithubToken(creds?.githubTokenMasked || "");
                setConfirmClear((prev) => ({ ...prev, github: false }));
              }}
              className={btnSmSecondary}
            >
              重新输入凭证
            </button>
          </div>
          {feedback.github && !feedback.github.ok && (
            <p className="text-[11px] text-red-500 dark:text-red-400">
              已保存的凭证可能已失效，可点击「重新输入凭证」更新。
            </p>
          )}
        </div>
      )}

      {!ascUnlocked || editing.asc ? (
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <AppleIcon />
          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            App Store Connect API Key
          </span>
          <CredentialStatus unlocked={ascUnlocked} source={ascSource} />
        </div>
        <div>
          <label className="block text-[11px] text-zinc-400 mb-1">Issuer ID</label>
          <input
            className={inputLineClass + " font-mono"}
            value={ascIssuerId}
            onChange={(e) => {
              setAscIssuerId(e.target.value);
              setSaved((prev) => ({ ...prev, asc: false }));
              setFeedback((prev) => ({ ...prev, asc: undefined }));
              setConfirmClear((prev) => ({ ...prev, asc: false }));
            }}
            placeholder={ascUnlocked ? "原 Issuer ID（修改则输入新值）" : "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"}
          />
        </div>
        <div>
          <label className="block text-[11px] text-zinc-400 mb-1">Key ID</label>
          <input
            className={inputLineClass + " font-mono"}
            value={ascKeyId}
            onChange={(e) => {
              setAscKeyId(e.target.value);
              setSaved((prev) => ({ ...prev, asc: false }));
              setFeedback((prev) => ({ ...prev, asc: undefined }));
              setConfirmClear((prev) => ({ ...prev, asc: false }));
            }}
            placeholder={ascUnlocked ? "原 Key ID（修改则输入新值）" : "XXXXXXXXXX"}
          />
        </div>
        <div>
          <label className="block text-[11px] text-zinc-400 mb-1">私钥（.p8 文件）</label>
          <div className="flex gap-2">
            <input
              className={inputLineClass + " font-mono text-xs"}
              value={ascKeyPath ? basename(ascKeyPath) : ""}
              onChange={(e) => setAscKeyPath(e.target.value)}
              placeholder="仅通过文件选择"
              readOnly
            />
            <button
              type="button"
              onClick={async () => {
                const file = await (window as any).appilot?.projects?.selectAscKeyFile();
                if (file) {
                  setAscKeyPath(file);
                  setSaved((prev) => ({ ...prev, asc: false }));
                  setFeedback((prev) => ({ ...prev, asc: undefined }));
                  setConfirmClear((prev) => ({ ...prev, asc: false }));
                }
              }}
              className={btnSmSecondary + " shrink-0"}
            >
              选择文件…
            </button>
          </div>
          <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
            {(ascKeyPath || creds?.ascPrivateKeyPath) && (
              <button
                type="button"
                onClick={() =>
                  (window as any).appilot?.revealInFolder?.(
                    ascKeyPath || creds?.ascPrivateKeyPath,
                  )
                }
                className="text-amber-600 dark:text-amber-400 hover:underline"
              >
                在访达中显示
              </button>
            )}
            {!ascKeyPath && !creds?.ascPrivateKeyPath && "仅支持文件选择，不提供粘贴"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void testAndSave("asc")}
            disabled={
              testing === "github" ||
              !ascIssuerId.trim() ||
              !ascKeyId.trim() ||
              !ascKeyPath
            }
            className={cn(
              btnSmPrimary,
              saveError === "asc" && "!bg-red-500",
              saved.asc && "!bg-emerald-500",
            )}
            title={
              !ascIssuerId.trim() || !ascKeyId.trim() || !ascKeyPath
                ? "请填写 Issuer / Key ID / .p8 文件"
                : saveError === "asc"
                  ? "保存失败，请重试"
                  : saved.asc
                    ? "已保存"
                    : feedback.asc?.msg
            }
          >
            {!ascIssuerId.trim() || !ascKeyId.trim() || !ascKeyPath
              ? "测试并保存"
              : testing === "asc"
                ? "测试中…"
                : saveError === "asc"
                  ? "✕ 保存失败"
                  : saved.asc
                    ? "✓ 已保存"
                    : feedback.asc && !feedback.asc.ok
                      ? "✕ 测试失败"
                      : "测试并保存"}
          </button>
          <button
            type="button"
            onClick={() => void clearBlock("asc")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors",
              confirmClear.asc
                ? "bg-red-500 border-red-500 text-white hover:bg-red-600"
                : "border-red-300 dark:border-red-800 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20",
            )}
          >
            {confirmClear.asc ? "确认清除？" : "清除"}
          </button>
          {ascUnlocked && (
            <button
              type="button"
              onClick={() => {
                setEditing((prev) => ({ ...prev, asc: false }));
                setConfirmClear((prev) => ({ ...prev, asc: false }));
                setAscIssuerId("");
                setAscKeyId("");
                setAscKeyPath("");
                setFeedback((prev) => ({ ...prev, asc: undefined }));
              }}
              className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              放弃修改
            </button>
          )}
        </div>
        {feedback.asc && !feedback.asc.ok && (
          <p className="text-[11px] text-red-500 dark:text-red-400">{feedback.asc.msg}</p>
        )}
        <div className="text-[11px] text-zinc-400 dark:text-zinc-500 space-y-1">
          <p>
            获取：App Store Connect → 用户和访问 → 集成 → App Store Connect API；
            Issuer ID 在该页顶部，Key ID 与 .p8 文件在创建密钥时下载。一把 Key 适用于同一账户（Team）
            下的所有应用；不同账户的应用需单独一把 Key（可在项目设置中覆盖）。
            创建密钥时**权限请选择 App Manager（App 管理）**，否则无法读取/更新应用元数据。
          </p>
          <p>
            保存时会把 .p8 复制到应用数据目录（副本随凭据保存，原文件移动/删除不影响）；
            Apple 不支持重新下载密钥，请妥善保管或必要时新建。
          </p>
          <button
            type="button"
            onClick={() => (window as any).appilot?.openExternal("https://appstoreconnect.apple.com/access/integrations/api")}
            className="text-amber-600 dark:text-amber-400 hover:underline"
          >
            前往 App Store Connect API 密钥 ↗
          </button>
        </div>
      </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <AppleIcon />
            <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              App Store Connect API Key
            </span>
            <CredentialStatus unlocked source={ascSource} />
          </div>
          <ul className="space-y-1">
            {ASC_CAPABILITIES.map((capability) => (
              <li
                key={capability}
                className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400"
              >
                <span className="text-emerald-500">✓</span> {capability}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleTestAsc()}
              disabled={testing === "github"}
              className={cn(
                btnSmSecondary,
                feedback.asc?.ok &&
                  "!text-emerald-600 dark:!text-emerald-400 !border-emerald-300 dark:!border-emerald-800",
                feedback.asc &&
                  !feedback.asc.ok &&
                  "!text-red-600 dark:!text-red-400 !border-red-300 dark:!border-red-800",
              )}
              title={feedback.asc?.msg}
            >
              {testing === "asc"
                ? "测试中…"
                : feedback.asc
                  ? feedback.asc.ok
                    ? "✓ 测试通过"
                    : "✕ 测试失败"
                  : "测试凭证"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing((prev) => ({ ...prev, asc: true }));
                setAscIssuerId(creds?.ascIssuerId || "");
                setAscKeyId(creds?.ascKeyId || "");
                setAscKeyPath(creds?.ascPrivateKeyPath || "");
                setConfirmClear((prev) => ({ ...prev, asc: false }));
              }}
              className={btnSmSecondary}
            >
              重新输入凭证
            </button>
          </div>
          {feedback.asc && !feedback.asc.ok && (
            <p className="text-[11px] text-red-500 dark:text-red-400">
              已保存的凭证可能已失效，可点击「重新输入凭证」更新。
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function CredentialStatus({ unlocked, source }: { unlocked: boolean; source: string | null }) {
  if (!unlocked) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] text-zinc-400 dark:text-zinc-500"
        title="先填写并测试通过，再保存后解锁"
      >
        <span className="text-zinc-300 dark:text-zinc-600">🔒</span> 未解锁
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium"
      title="已通过测试并保存"
    >
      <span>✓</span> 已解锁{source ? ` · ${source}` : ""}
    </span>
  );
}

function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [preset, setPreset] = useState("OpenAI");
  const [providerUrl, setProviderUrl] = useState("https://api.openai.com/v1");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyBroken, setApiKeyBroken] = useState(false);
  const [model, setModel] = useState("gpt-4o");
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [modelCustom, setModelCustom] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [statusMsg, setStatusMsg] = useState("");

  useEffect(() => {
    (window as any).appilot?.ai?.getConfig().then((c: any) => {
      if (c?.providerUrl) setProviderUrl(c.providerUrl);
      if (c?.apiKey) setApiKey(c.apiKey);
      if (c?.model) setModel(c.model);
      setApiKeyBroken(Boolean(c?.apiKeyBroken));
    }).catch(() => {});
  }, []);

  const listModels = useCallback(async (url: string, key: string) => {
    if (!url.trim()) return;
    setModelsLoading(true);
    setModelsError("");
    try {
      const result = await (window as any).appilot?.ai?.listModels({ providerUrl: url, apiKey: key });
      const list = Array.isArray(result?.models) ? result.models : [];
      setModels(list);
      if (list.length === 0 && result?.error) setModelsError(result.error);
    } catch (e: any) {
      setModelsError(e.message || "模型列表获取失败");
    } finally {
      setModelsLoading(false);
    }
  }, []);

  // Discover the provider's supported models whenever URL or key changes
  // (debounced; the very first render with defaults is skipped).
  const didInitModels = useRef(false);
  useEffect(() => {
    if (!didInitModels.current) {
      didInitModels.current = true;
      return;
    }
    if (!providerUrl.trim()) return;
    const timer = window.setTimeout(() => void listModels(providerUrl, apiKey), 400);
    return () => window.clearTimeout(timer);
  }, [providerUrl, apiKey, listModels]);

  // Keep the preset selector in sync with the actual URL + model: prefer an
  // exact URL+model match, fall back to a URL match, otherwise Custom.
  useEffect(() => {
    const exact = AI_PRESETS.find((p) => p.url === providerUrl && p.model === model);
    const byUrl = AI_PRESETS.find((p) => p.url === providerUrl);
    setPreset((prev) => {
      const prevMatch = AI_PRESETS.find((p) => p.label === prev);
      if (prevMatch && prevMatch.url === providerUrl && prevMatch.model === model) return prev;
      return (exact || byUrl)?.label || "Custom";
    });
  }, [providerUrl, model]);

  const handlePresetChange = (label: string) => {
    setPreset(label);
    const p = AI_PRESETS.find((p) => p.label === label);
    // Selecting a provider only sets its endpoint; the supported models are
    // discovered from the provider API (see the model field below).
    if (p && p.label !== "Custom") setProviderUrl(p.url);
  };

  const handleSave = async () => {
    try {
      await (window as any).appilot?.ai?.saveConfig({ providerUrl, apiKey, model });
      const refreshed = await (window as any).appilot?.ai?.getConfig().catch(() => null);
      if (refreshed) setApiKeyBroken(Boolean(refreshed.apiKeyBroken));
      setStatus("success"); setStatusMsg("已保存");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (e: any) { setStatus("error"); setStatusMsg(e.message || "保存失败"); }
  };

  const handleTest = async () => {
    setTesting(true); setStatus("idle");
    try {
      const result = await (window as any).appilot?.ai?.testConnection({ providerUrl, apiKey, model });
      const ok = result?.ok ?? false;
      setStatus(ok ? "success" : "error");
      setStatusMsg(ok ? "连接成功" : result?.error ? `连接失败：${result.error}` : "连接失败");
    } catch (e: any) { setStatus("error"); setStatusMsg(e.message || "出错"); }
    finally { setTesting(false); }
  };

  return (
    <div className="p-10 max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">设置</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-8">配置 AI 供应商以启用分析能力。</p>

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden mb-8 shadow-sm">
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">AI 供应商</h3>
        </div>
        <div className="p-6 space-y-5">
          <div>
            <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">供应商</label>
            <select value={preset} onChange={(e) => handlePresetChange(e.target.value)} className={inputClass}>
              {AI_PRESETS.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">URL</label>
            <input type="text" value={providerUrl} onChange={(e) => setProviderUrl(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">API Key</label>
            <div className="relative">
              <input
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setApiKeyBroken(false);
                }}
                className={inputClass + " pr-10"}
                placeholder="sk-..."
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowApiKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                title={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
              >
                {showApiKey ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                    <path d="M3 3l18 18" />
                    <path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17.9 17.9 0 0 1-2.9 3.9M6.6 6.6A16.3 16.3 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.4-1.1" />
                    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
            {apiKeyBroken && (
              <p className="text-[11px] text-red-500 dark:text-red-400 mt-1.5">
                已保存的 API Key 无法解密（可能曾被多次加密或系统钥匙串异常），请重新粘贴真实的 Key 后保存。
              </p>
            )}
          </div>
          <div>
            <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">模型</label>
            <div className="flex gap-2">
              {models.length > 0 && !modelCustom ? (
                <select
                  value={models.includes(model) ? model : ""}
                  onChange={(e) => {
                    if (e.target.value === "__custom__") setModelCustom(true);
                    else setModel(e.target.value);
                  }}
                  className={inputClass}
                >
                  {!models.includes(model) && <option value="">请选择模型</option>}
                  {models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                  <option value="__custom__">自定义…</option>
                </select>
              ) : (
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className={inputClass}
                  placeholder="模型名称"
                />
              )}
              <button
                type="button"
                onClick={() => listModels(providerUrl, apiKey)}
                disabled={modelsLoading}
                className={btnSecondary + " shrink-0 px-3"}
                title="刷新模型列表"
              >
                {modelsLoading ? "…" : "⟳"}
              </button>
            </div>
            {modelCustom && models.length > 0 && (
              <button
                type="button"
                onClick={() => setModelCustom(false)}
                className="mt-1.5 text-xs text-amber-600 dark:text-amber-400 hover:underline"
              >
                从列表选择模型
              </button>
            )}
            {modelsLoading && (
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-1.5">正在获取模型列表…</p>
            )}
            {!modelsLoading && models.length > 0 && (
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-1.5">
                该服务商支持 {models.length} 个模型
              </p>
            )}
            {!modelsLoading && modelsError && (
              <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-1.5">
                模型列表获取失败：{modelsError}（可手动输入模型名）
              </p>
            )}
          </div>
          <div className="flex gap-3 items-center pt-1">
            <button onClick={handleSave} className={btnPrimary}>保存</button>
            <button onClick={handleTest} disabled={testing} className={btnSecondary}>{testing ? "测试中..." : "测试连接"}</button>
            {status !== "idle" && (
              <span className={`text-[13px] font-medium flex items-center gap-1.5 ${status === "success" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
                {statusMsg}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm mb-8">
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">全局项目凭据</h3>
        </div>
        <div className="p-6">
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mb-4">
            适用于所有项目的 GitHub / App Store Connect 凭据；单个项目可在「项目设置」中用本项目凭据覆盖。凭据加密存储，仅用于本地读取增强，不进入 AI 提示词。
          </p>
          <CredentialsForm projectId="" scope="global" />
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm mb-8">
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">外观</h3>
        </div>
        <div className="p-6">
          <select value={theme} onChange={(e) => setTheme(e.target.value as any)} className={inputClass + " max-w-xs"}>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
            <option value="system">跟随系统</option>
          </select>
        </div>
      </div>

      <p className="text-[11px] text-zinc-400 dark:text-zinc-500">Appilot · Phase A</p>
    </div>
  );
}

/* ── App Root ── */

function MenuCommandListener() {
  const navigate = useNavigate();
  const { load, select, selectProduct, addByFolder } = useProject();

  useEffect(() => {
    const off = (window as any).appilot?.menu?.onCommand?.(async (command: any) => {
      if (command?.view === "settings") {
        navigate("/settings");
        return;
      }
      if (command?.view === "add") {
        const folder = await (window as any).appilot?.dialog?.selectFolder();
        if (folder) {
          await addByFolder(folder);
          navigate("/overview");
        }
        return;
      }
      if (command?.projectId) {
        await load();
        select(command.projectId);
        if (command.productId) {
          selectProduct(command.productId);
        }
        navigate(command.view === "release" ? "/release" : "/overview");
      }
    });
    return () => {
      off?.();
    };
  }, []);

  return null;
}

export function App() {
  return (
    <Layout>
      <MenuCommandListener />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/keywords" element={<KeywordsPage />} />
        <Route path="/tasks" element={<TaskCenterPage />} />
        <Route path="/release" element={<ReleasePage />} />
        <Route path="/reviews" element={<PlaceholderPage title="评论洞察" desc="用户评论聚类与洞察。" />} />
        <Route path="/trend" element={<PlaceholderPage title="长期效果" desc="增长时间线与你采纳的动作。" />} />
        <Route path="/projects" element={<ManageProjectsPage />} />
        <Route path="/projects/:projectId/settings" element={<ProjectSettingsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </Layout>
  );
}
