import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { Routes, Route, Link, useLocation, useNavigate } from "react-router-dom";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTheme } from "./stores/theme";
import { useProject, type RankSnapshot } from "./stores/project";
import { cn } from "./lib/utils";
import { defaultStorefrontForLanguage, storefrontDisplayName, storefrontsForLanguage } from "../engine/storefronts";

/* ── Layout ── */

const NAV_ITEMS = [
  { to: "/overview", label: "总览", title: "总览" },
  { to: "/release", label: "发布", title: "发布工作台" },
  { to: "/keywords", label: "关键词", title: "关键词" },
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
  const { projects, currentProjectId, currentProductId, load, select, selectProduct, addByFolder } = useProject();
  const location = useLocation();
  const [cost, setCost] = useState<number | null>(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => useTheme.getState().syncFromSystem();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  useEffect(() => { load(); }, []);

  useEffect(() => {
    (window as any).appilot?.stats?.aiUsage()
      .then((u: any) => setCost(u?.estimatedCost ?? 0))
      .catch(() => setCost(0));
  }, []);

  // Close dropdowns when clicking outside.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setProjectMenuOpen(false);
      }
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
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

        {/* Right: cost + overflow menu */}
        <div className="ml-auto flex items-center gap-2">
          <div
            className="flex items-center gap-1.5 px-2.5 h-7 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[11px] text-zinc-500 dark:text-zinc-400"
            title="本月 AI 成本"
          >
            <span>本月 AI</span>
            <span className="font-mono font-medium text-zinc-800 dark:text-zinc-200">
              {cost === null ? "—" : `$${cost.toFixed(2)}`}
            </span>
          </div>

          <div ref={overflowRef} className="relative">
            <button
              onClick={() => setOverflowOpen((v) => !v)}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-lg text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors"
              title="更多"
              aria-label="更多"
            >
              ⋯
            </button>
            {overflowOpen && (
              <div className="absolute right-0 top-full mt-1.5 z-40 w-48 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg py-1 overflow-hidden">
                <Link
                  to="/tasks"
                  onClick={() => setOverflowOpen(false)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
                >
                  <span className="text-zinc-400 text-xs">▦</span> 任务中心
                </Link>
                <Link
                  to="/settings"
                  onClick={() => setOverflowOpen(false)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
                >
                  <span className="text-zinc-400 text-xs">⚙</span> 设置
                </Link>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto">
        <div className="min-h-full">{children}</div>
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

function OverviewPage() {
  const { projects, currentProjectId, currentProductId } = useProject();
  const project = projects.find((p) => p.id === currentProjectId);
  const product = project?.storeProducts?.find((item) => item.id === currentProductId) || project?.storeProducts?.[0] || null;

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
  const storeGroups = [
    { label: "macOS", links: storeLinks.filter((l) => l.platform === "macos") },
    { label: "iOS", links: storeLinks.filter((l) => l.platform === "ios") },
    { label: "其他", links: storeLinks.filter((l) => l.platform === "unknown") },
  ].filter((g) => g.links.length > 0);

  return (
    <div className="p-10 max-w-6xl mx-auto">
      {/* App identity */}
      <div className="flex items-center gap-4 mb-8">
        {product.artworkUrl ? (
          <img
            src={product.artworkUrl}
            alt=""
            className="w-16 h-16 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm object-cover"
          />
        ) : (
          <div className="w-16 h-16 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center">
            <span className="text-amber-500 text-xl">⌖</span>
          </div>
        )}
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
            {product.trackName || project.name}
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 truncate">
            {project.localPath}
          </p>
        </div>
      </div>

      {/* Detected metadata */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm mb-8">
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">识别结果</h3>
        </div>
        <div className="p-6 grid grid-cols-2 gap-x-8 gap-y-4 text-sm">
          <Field label="产品类型" value={product.platform === "ios" ? "iOS" : product.platform === "macos" ? "macOS" : "未识别"} />
          <Field label="商店名称" value={product.trackName || project.name} />
        </div>
      </div>

      {/* Supported languages */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm mb-8">
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            支持语言（{languages.length}）
          </h3>
        </div>
        <div className="p-5 flex flex-wrap gap-2">
          {languages.length === 0 ? (
            <p className="text-sm text-zinc-400 dark:text-zinc-500">未识别</p>
          ) : (
            languages.map((l) => (
              <span
                key={l.code}
                className="inline-flex items-center px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs text-zinc-700 dark:text-zinc-300"
              >
                {l.name}
              </span>
            ))
          )}
        </div>
      </div>

      {/* Store links */}
      {storeLinks.length > 0 && (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm mb-8">
          <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">商店链接</h3>
          </div>
          <div className="p-4">
            {storeGroups.map((group) => (
              <div key={group.label} className="mb-4 last:mb-0">
                <p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                  {group.label}
                </p>
                <div className="space-y-1">
                  {group.links.map((link) => (
                    <button
                      key={link.url}
                      onClick={() => (window as any).appilot?.openExternal(link.url)}
                      className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                    >
                      <span className="text-zinc-800 dark:text-zinc-200">{link.name} App Store</span>
                      <span className="text-xs text-amber-600 dark:text-amber-400">打开 ↗</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <p className="px-1 pt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
              链接按地区定向；页面语言会跟随你设备语言，在应用支持的语言内自动切换。
            </p>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 p-10 text-center text-sm text-zinc-400 dark:text-zinc-500">
        总览（副驾驶简报）将在 Phase A 后续步骤实现
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mb-1">{label}</p>
      <p className={cn("text-zinc-800 dark:text-zinc-200 truncate", mono && "font-mono")}>
        {value}
      </p>
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

function MarkdownView({ text }: { text: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

function ReferenceSection({
  title,
  meta,
  checked = false,
  defaultOpen = false,
  children,
}: {
  title: string;
  meta?: string;
  checked?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left"
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{title}</span>
          {checked ? <span className="text-xs text-emerald-500 shrink-0">✓</span> : null}
          {meta ? (
            <span className="text-xs text-zinc-400 dark:text-zinc-500 truncate">{meta}</span>
          ) : null}
        </span>
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
      </button>
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
}: {
  drafts: any[];
  selectedDraft: any;
  onSelect: (draft: any) => void;
}) {
  const merged = mergeHistoryDrafts(drafts);
  return (
    <ReferenceSection title="历史文案" meta={merged.length > 0 ? `${merged.length} 个版本` : "暂无历史文案"} defaultOpen>
      {merged.length === 0 ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-500 py-1">还没有可参考的历史版本。</p>
      ) : (
        <div className="space-y-1">
          {merged.map((item: any, index: number) => {
            const active = selectedDraft?.releaseTag === item.releaseTag;
            const languages = (item.localizations || [])
              .map((loc: any) => String(loc?.language || "").trim())
              .filter(Boolean);
            return (
              <button
                key={item.releaseTag || index}
                type="button"
                onClick={() => onSelect(item)}
                className={cn(
                  "w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left transition-colors",
                  active
                    ? "bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300"
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{draftVersionLabel(item)}</span>
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

function CurrentCopyEntry({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors",
        active ? "bg-amber-50 dark:bg-amber-500/10" : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
      )}
    >
      <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">当前文案</span>
      <span className="text-xs text-zinc-400 dark:text-zinc-500 truncate">{label}</span>
    </button>
  );
}

function HistoryViewer({ draft, onBack }: { draft: any; onBack: () => void }) {
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
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">历史文案</h3>
          <span className="text-xs text-zinc-400 dark:text-zinc-500 truncate">
            {draftVersionLabel(draft)} · 更新于 {formatHumanTime(draft.updatedAt)}
          </span>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-amber-600 dark:text-amber-400 hover:underline shrink-0"
        >
          返回当前文案
        </button>
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
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <FieldHeader label="软件名称" text={loc.name || ""} />
                <input value={loc.name || ""} readOnly className={inputLineClass} />
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500 px-1">
                  {(loc.name || "").length}/30 字符
                </p>
              </div>
              <div className="space-y-1.5">
                <FieldHeader label="副标题" text={loc.subtitle || ""} />
                <input value={loc.subtitle || ""} readOnly className={inputLineClass} />
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500 px-1">
                  {(loc.subtitle || "").length}/30 字符
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <FieldHeader label="推广文本" text={loc.promotionalText || ""} />
              <input value={loc.promotionalText || ""} readOnly className={inputLineClass} />
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 px-1">
                {(loc.promotionalText || "").length}/170 字符
              </p>
            </div>

            <div className="space-y-1.5">
              <FieldHeader label="关键词" text={loc.keywords || ""} />
              <input value={loc.keywords || ""} readOnly className={inputLineClass} />
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 px-1">
                {(loc.keywords || "").length}/100 字符
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
          </>
        )}
      </div>
    </div>
  );
}

function ReleasePage() {
  const { projects, currentProjectId, currentProductId } = useProject();
  const project = projects.find((item) => item.id === currentProjectId);
  const products = project?.storeProducts || [];
  const [productId, setProductId] = useState(currentProductId || products[0]?.id || "");
  const [releases, setReleases] = useState<any[]>([]);
  const [selectedTag, setSelectedTag] = useState("");
  const [active, setActive] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [error, setError] = useState("");
  const [activeLanguage, setActiveLanguage] = useState("");
  const [sourceLanguage, setSourceLanguage] = useState("");
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [releaseContext, setReleaseContext] = useState<any>(null);
  const [historyDraft, setHistoryDraft] = useState<any>(null);
  const [translatingLanguages, setTranslatingLanguages] = useState<Set<string>>(new Set());
  const translatingRef = useRef<Set<string>>(new Set());

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
        if (current && next.releases?.some((item: any) => item.tag === current)) {
          return current;
        }
        return draft?.tag || "";
      });
    } catch (e: any) {
      setError(e.message || "发布列表加载失败。");
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void loadReleases();
  }, [project?.id]);

  useEffect(() => {
    setSourceLanguage(UI_SOURCE_LANGUAGE);
    setTranslatingLanguages(new Set());
    setActiveLanguage("");
    setStep(1);
  }, [productId, project?.id]);

  useEffect(() => {
    if (!project?.id || !productId || !selectedTag) return;
    let cancelled = false;
    setHistoryDraft(null);
    (window as any).appilot?.release?.context(project.id, productId, selectedTag)
      .then((context: any) => {
        if (!cancelled) setReleaseContext(context);
      })
      .catch(() => {
        if (!cancelled) setReleaseContext(null);
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
  const currentReleaseLabel =
    selectedRelease?.name && selectedRelease.name !== "RELEASE_DRAFT.md"
      ? selectedRelease.name
      : formatVersionDate(selectedRelease?.publishedAt) || selectedTag;
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
    if (!draft?.masterConfirmedAt) {
      void persistConfirm({ masterConfirmedAt: new Date().toISOString() });
    }
  };

  const handleConfirmBatch = () => {
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
            读取仓库根目录的 RELEASE_DRAFT.md，由你确认后再生成 App Store 提交文案。
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
        <EmptyState title="尚未检测到预发布公告" desc="请在仓库根目录创建 RELEASE_DRAFT.md，然后点击检查发布。" />
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
                    title="预发布公告"
                    meta={`更新于 ${formatHumanTime(selectedRelease.publishedAt)}`}
                    checked={step > 1}
                    defaultOpen
                  >
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
                      {selectedRelease.name || "RELEASE_DRAFT.md"}
                    </p>
                    <MarkdownView text={selectedRelease?.body || "没有预发布公告内容"} />
                  </ReferenceSection>

                  {releaseContext && step <= 2 && (
                    <>
                      <ReferenceSection
                        title="README"
                        meta={`更新于 ${formatHumanTime(releaseContext.readmeModifiedAt)}`}
                        checked={step > 1}
                      >
                        <MarkdownView text={releaseContext.readme || "没有 README 内容"} />
                      </ReferenceSection>
                      <CurrentCopyEntry
                        label={currentReleaseLabel}
                        active={!historyDraft}
                        onClick={() => setHistoryDraft(null)}
                      />
                      <HistoryPanel
                        drafts={(releaseContext.drafts || []).filter(
                          (item: any) => item.releaseTag !== selectedTag,
                        )}
                        selectedDraft={historyDraft}
                        onSelect={(draft: any) => setHistoryDraft(draft)}
                      />
                    </>
                  )}
                </div>
              )}
            </div>
          </aside>

          <div className="min-w-0 space-y-6">
            {historyDraft ? (
              <HistoryViewer draft={historyDraft} onBack={() => setHistoryDraft(null)} />
            ) : (
              <>
            {selectedRelease && step === 1 && (
              <>
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
                  <button onClick={() => handleLoad(true)} disabled={busy} className={btnPrimary}>
                    {generating ? "生成中..." : "下一步：生成文案"}
                  </button>
                )}

                {!selectedRelease.draft && (
                  <div>
                    {selectedExistingDraft ? (
                      <button onClick={() => handleLoad(false)} disabled={busy} className="px-4 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60">
                        {loadingDraft ? "加载中..." : "查看历史文案"}
                      </button>
                    ) : (
                      <span className="text-sm text-zinc-400 dark:text-zinc-500">该正式发布没有历史文案</span>
                    )}
                  </div>
                )}
              </>
            )}

            {!draft ? (
              selectedRelease && step > 1 ? (
                <EmptyState
                  title={selectedRelease.draft ? "等待生成提交文案" : "该正式发布没有历史文案"}
                  desc={selectedRelease.draft ? "确认后由 AI 生成名称、副标题、Promotional Text、描述、What's New 和关键词。" : "正式发布只作为完成信号，不再生成新的商店文案。"}
                />
              ) : null
            ) : (
              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between gap-4">
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">商店提交工作单</h3>
                </div>

                <div className="p-6 space-y-6">
                  {activeLocalization && (
                    <>
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
                          <FieldHeader label="副标题" text={activeLocalization.subtitle || ""} />
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
                        <FieldHeader label="关键词" text={activeLocalization.keywords} />
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
                            {translating ? " ..." : generated ? " ✓" : ""}
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
                        <button onClick={() => handleLoad(true)} disabled={busy} className={btnPrimary}>
                          {generating ? "重新生成中..." : "重新生成"}
                        </button>
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
  const [data, setData] = useState<{ running: boolean; tasks: any[] } | null>(null);
  const [typeFilter, setTypeFilter] = useState<"all" | "rank">("all");

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

  const tasks = (data?.tasks || []).filter(
    (task) => typeFilter === "all" || task.kind === typeFilter,
  );
  const pending = tasks.filter((task) => task.enabled);
  const failed = tasks.filter((task) => task.lastStatus === "failed");

  const pendingGroups = groupTasks(pending);
  const failedGroups = groupTasks(failed);

  return (
    <div className="p-10 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">任务中心</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
            查看后台任务的准备、执行和完成状态。
          </p>
        </div>
        {data?.running && (
          <span className="px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs font-medium">
            调度器运行中
          </span>
        )}
      </div>

      <div className="mb-6 flex gap-2">
        {(["all", "rank"] as const).map((filter) => (
          <button
            key={filter}
            onClick={() => setTypeFilter(filter)}
            className={cn(
              "px-3 py-1.5 text-sm rounded-lg border transition-colors",
              typeFilter === filter
                ? "border-amber-500/50 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium"
                : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
            )}
          >
            {filter === "all" ? "全部任务" : "排名采集"}
          </button>
        ))}
      </div>

      <div className="space-y-6">
        <TaskSection title={`准备进行（${pendingGroups.length} 组）`} groups={pendingGroups} />
        <TaskSection title={`失败（${failedGroups.length} 组）`} groups={failedGroups} />
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

function KeywordsPage() {
  const { projects, currentProjectId, currentProductId, updateTrackedKeywords, removeTrackedKeyword, restoreTrackedKeyword, clearRemovedKeywords, collectRanks } = useProject();
  const project = projects.find((p) => p.id === currentProjectId);
  const product = project?.storeProducts?.find((item) => item.id === currentProductId) || project?.storeProducts?.[0] || null;
  const [activeLang, setActiveLang] = useState<string>("");
  const [loadingLangs, setLoadingLangs] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [rankLoading, setRankLoading] = useState(false);
  const [rankError, setRankError] = useState("");
  const [selectedStorefront, setSelectedStorefront] = useState<string>("us");
  const [selectedKeyword, setSelectedKeyword] = useState<string>("");
  const [rankProgress, setRankProgress] = useState<{ current: number; total: number; keyword: string; storefront: string } | null>(null);
  const [schedulerStatus, setSchedulerStatus] = useState<{ enabled: boolean; total: number; due: number; failed: number; nextDueAt: string | null } | null>(null);

  const initialLanguage = (product?.supportedLanguages || []).some((l) => l.code === activeLang)
    ? activeLang
    : ((product?.supportedLanguages || [])[0]?.code || "");
  const languageDefaultStorefront = defaultStorefrontForLanguage(initialLanguage);

  useEffect(() => {
    setSelectedStorefront(languageDefaultStorefront);
  }, [languageDefaultStorefront]);

  useEffect(() => {
    const off = (window as any).appilot?.projects?.onRankProgress?.((progress: any) => {
      setRankProgress(progress);
    });
    return () => {
      off?.();
    };
  }, []);

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

  if (!project || !product) {
    return <EmptyState title="还没有项目" desc="添加一个项目后，这里会展示关键词。" />;
  }

  const languages = product.supportedLanguages || [];
  const currentLang = languages.some((l) => l.code === activeLang) ? activeLang : (languages[0]?.code || "");
  const queryLanguages = currentLang === "en" ? ["en"] : [currentLang, "en"];
  const tracked = (product.trackedKeywords || []).filter((k) => queryLanguages.includes(k.language));
  const removedForCurrent = (product.removedKeywords || []).filter((item) => queryLanguages.includes(item.language));
  const currentLoading = loadingLangs.has(currentLang);
  const storefronts = storefrontsForLanguage(currentLang);
  const defaultStorefront = storefronts[0] || "us";
  const activeStorefront = storefronts.includes(selectedStorefront)
    ? selectedStorefront
    : defaultStorefront;
  const rankSnapshots = product.rankSnapshots || [];
  const ranksForCurrent = rankSnapshots.filter(
    (snapshot) => queryLanguages.includes(snapshot.language) && snapshot.storefront === activeStorefront,
  );
  const chartKeyword = tracked.some((keyword) => keyword.keyword === selectedKeyword)
    ? selectedKeyword
    : (tracked[0]?.keyword || "");
  const chartSnapshots = rankSnapshots
    .filter(
      (snapshot) =>
        queryLanguages.includes(snapshot.language) &&
        snapshot.storefront === activeStorefront &&
        snapshot.keyword === chartKeyword,
    )
    .sort((a, b) => new Date(a.checkedAt).getTime() - new Date(b.checkedAt).getTime());

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
    const latest = latestProject?.storeProducts?.find((item) => item.id === product.id) || product;
    let trackedNext = [...(latest.trackedKeywords || [])];

    for (const r of results) {
      if (!r.gen) continue;
      const existingKeys = new Set(trackedNext.map((k) => `${k.language}\u0000${k.keyword}`));
      const removedKeys = new Set(
        (latest.removedKeywords || []).map((item) => `${item.language}\u0000${item.keyword}`),
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

  const handleGenerate = async (lang: string) => {
    setError("");
    setLoadingLangs((prev) => new Set(prev).add(lang));
    const result = await generateOne(lang);
    await applyGenerations([result]);
    setLoadingLangs((prev) => {
      const next = new Set(prev);
      next.delete(lang);
      return next;
    });
  };

  const handleGenerateAll = async () => {
    setError("");
    const langs = languages.map((l) => l.code);
    setLoadingLangs(new Set(langs));
    const results = await Promise.all(langs.map((lang) => generateOne(lang)));
    await applyGenerations(results);
    setLoadingLangs(new Set());
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

  const handleCollectRanks = async () => {
    setRankError("");
    setRankLoading(true);
    setRankProgress({ current: 0, total: tracked.length, keyword: "", storefront: activeStorefront });
    try {
      await collectRanks(product.id, currentLang, activeStorefront);
    } catch (e: any) {
      setRankError(e.message || "排名采集失败。");
    } finally {
      setRankLoading(false);
      setRankProgress(null);
    }
  };

  const snapshotsByKeyword = new Map<string, RankSnapshot[]>();
  for (const snapshot of ranksForCurrent) {
    const list = snapshotsByKeyword.get(snapshot.keyword) || [];
    list.push(snapshot);
    snapshotsByKeyword.set(snapshot.keyword, list);
  }

  type RankTrend = "none" | "new" | "lost" | "up" | "down" | "same";

  const rankSummary = (keyword: string): {
    rank: number | null;
    delta: number | null;
    trend: RankTrend;
    checkedAt: string | null;
  } => {
    const list = [...(snapshotsByKeyword.get(keyword) || [])].sort(
      (a, b) => new Date(a.checkedAt).getTime() - new Date(b.checkedAt).getTime(),
    );
    const latest = list[list.length - 1] || null;
    const previous = list.length > 1 ? list[list.length - 2] : null;
    if (!latest) return { rank: null, delta: null, trend: "none", checkedAt: null };

    let delta: number | null = null;
    let trend: RankTrend = "same";

    if (previous?.rank == null && latest.rank != null) {
      trend = "new";
    } else if (previous?.rank != null && latest.rank == null) {
      trend = "lost";
    } else if (previous?.rank != null && latest.rank != null) {
      delta = previous.rank - latest.rank;
      if (delta > 0) trend = "up";
      else if (delta < 0) trend = "down";
    }

    return { rank: latest.rank, delta, trend, checkedAt: latest.checkedAt };
  };

  const trackedWithRank = tracked
    .map((keyword) => ({
      keyword,
      summary: rankSummary(keyword.keyword),
    }))
    .sort((a, b) => {
      const aRank = a.summary.rank ?? Number.MAX_SAFE_INTEGER;
      const bRank = b.summary.rank ?? Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) return aRank - bRank;
      return a.keyword.keyword.localeCompare(b.keyword.keyword);
    });

  const formatCheckedAt = (checkedAt: string | null): { date: string; time: string } => {
    if (!checkedAt) return { date: "—", time: "" };
    const date = new Date(checkedAt);
    return {
      date: date.toLocaleDateString(),
      time: date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
  };

  return (
    <div className="p-10 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">关键词</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
            跟踪关键词模拟用户搜索；商店提交关键词由发布工作台负责。
          </p>
        </div>
        <button onClick={handleGenerateAll} disabled={loadingLangs.size > 0} className={btnPrimary}>
          {loadingLangs.size > 0 ? "生成中..." : "为所有语言生成"}
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/50 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {languages.length === 0 ? (
        <EmptyState title="未识别支持语言" desc="请先在总览确认项目已识别出语言，再生成关键词。" />
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-6">
            {languages.map((l) => (
              <button
                key={l.code}
                onClick={() => setActiveLang(l.code)}
                className={cn(
                  "px-3 py-1.5 text-sm rounded-lg border transition-colors",
                  l.code === currentLang
                    ? "bg-amber-50 dark:bg-amber-500/10 border-amber-500/50 text-amber-700 dark:text-amber-400 font-medium"
                    : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
                )}
              >
                {l.name}
              </button>
            ))}
          </div>

          <div className="space-y-6">
            {/* Tracking keywords + rankings */}
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    跟踪关键词与排名（{tracked.length}）
                  </h3>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
                    同一张表完成生成、查看排名与趋势，不再重复列出关键词。
                  </p>
                  {schedulerStatus && (
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-1">
                      自动任务 {schedulerStatus.enabled ? "已启用" : "未启用"} · 待执行 {schedulerStatus.due}
                      {schedulerStatus.failed > 0 ? ` · 失败 ${schedulerStatus.failed}` : ""}
                      {schedulerStatus.nextDueAt
                        ? ` · 下次 ${new Date(schedulerStatus.nextDueAt).toLocaleString()}`
                        : ""}
                    </p>
                  )}
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
                  <select
                    value={activeStorefront}
                    onChange={(e) => setSelectedStorefront(e.target.value)}
                    className={inputClass + " w-full sm:max-w-60"}
                  >
                    {storefronts.map((country) => (
                      <option key={country} value={country}>
                        {storefrontDisplayName(country)}
                      </option>
                    ))}
                  </select>
                  <button onClick={() => handleGenerate(currentLang)} disabled={currentLoading} className={btnPrimary + " justify-self-start"}>
                    {currentLoading ? "生成中..." : "AI 生成"}
                  </button>
                  <button onClick={handleCollectRanks} disabled={rankLoading || tracked.length === 0} className={btnPrimary + " justify-self-start"}>
                    {rankLoading
                      ? `采集中 ${rankProgress?.current ?? 0}/${rankProgress?.total ?? 0}`
                      : "采集排名"}
                  </button>
                </div>
              </div>

              <div className="p-5">
                {rankLoading && rankProgress && (
                  <div className="mb-4 space-y-2">
                    <div className="flex items-center justify-between gap-3 text-xs text-amber-800 dark:text-amber-300">
                      <span className="truncate">
                        {rankProgress.keyword || "—"} · {storefrontDisplayName(rankProgress.storefront)}
                      </span>
                      <span className="font-mono shrink-0">
                        {rankProgress.current}/{rankProgress.total}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-amber-500 transition-all duration-200"
                        style={{
                          width: `${rankProgress.total > 0 ? Math.round((rankProgress.current / rankProgress.total) * 100) : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {rankError && (
                  <div className="mb-4 p-4 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/50 text-sm text-red-700 dark:text-red-400">
                    {rankError}
                  </div>
                )}

                {tracked.length === 0 ? (
                  <p className="text-sm text-zinc-400 dark:text-zinc-500 py-4 text-center">
                    暂无关键词，点击「AI 生成」。
                  </p>
                ) : (
                  <div className="rounded-xl border border-zinc-100 dark:border-zinc-800 overflow-hidden divide-y divide-zinc-100 dark:divide-zinc-800">
                    {trackedWithRank.map(({ keyword, summary }) => {
                      const checked = formatCheckedAt(summary.checkedAt);
                      return (
                        <button
                          type="button"
                          key={keyword.keyword}
                          onClick={() => setSelectedKeyword(keyword.keyword)}
                          className={cn(
                            "w-full flex items-center gap-4 px-4 py-3 text-left cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors",
                            keyword.keyword === chartKeyword && "bg-amber-50/40 dark:bg-amber-500/5",
                          )}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="font-mono text-sm text-zinc-800 dark:text-zinc-200 truncate">
                              {keyword.keyword}
                              {keyword.translation && keyword.translation !== keyword.keyword && (
                                <span className="ml-1 font-sans text-zinc-500 dark:text-zinc-400">
                                  ({keyword.translation})
                                </span>
                              )}
                            </div>
                            {keyword.rationale && (
                              <div className="text-xs text-zinc-400 dark:text-zinc-500 truncate mt-0.5">
                                {keyword.rationale}
                              </div>
                            )}
                          </div>

                          <div className="w-12 text-right shrink-0">
                            <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mb-0.5">排名</div>
                            <div className={cn("font-mono", summary.rank !== null && summary.rank <= 10 ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-zinc-600 dark:text-zinc-300")}>
                              {summary.rank ?? "—"}
                            </div>
                          </div>

                          <div className="w-16 text-right shrink-0">
                            <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mb-0.5">变化</div>
                            <div className="font-mono">
                              {summary.trend === "new" ? (
                                <span className="text-amber-600 dark:text-amber-400">进榜</span>
                              ) : summary.trend === "lost" ? (
                                <span className="text-red-600 dark:text-red-400">掉榜</span>
                              ) : summary.trend === "up" ? (
                                <span className="text-emerald-600 dark:text-emerald-400">▲ {summary.delta}</span>
                              ) : summary.trend === "down" ? (
                                <span className="text-red-600 dark:text-red-400">▼ {Math.abs(summary.delta ?? 0)}</span>
                              ) : (
                                <span className="text-zinc-400">—</span>
                              )}
                            </div>
                          </div>

                          <div className="w-20 text-right shrink-0 hidden sm:block">
                            <div className="text-xs text-zinc-400 dark:text-zinc-500 leading-tight">
                              {checked.date}
                            </div>
                            <div className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5 leading-tight">
                              {checked.time}
                            </div>
                          </div>

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
                            className="shrink-0 text-zinc-400 hover:text-red-500 text-xs"
                            title="移除"
                          >
                            ✕
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {removedForCurrent.length > 0 && (
                  <div className="mt-6 rounded-xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-900/30 p-4">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        已删除关键词（{removedForCurrent.length}）
                      </h4>
                      <button
                        onClick={clearRemoved}
                        className="text-xs text-zinc-400 hover:text-red-500 dark:text-zinc-500 dark:hover:text-red-400"
                      >
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

                {chartKeyword && chartSnapshots.length > 0 && (
                  <div className="mt-6">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        {chartKeyword} · 排名趋势
                      </h4>
                      <span className="text-xs text-zinc-400 dark:text-zinc-500">越低越好</span>
                    </div>
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={chartSnapshots
                            .filter((snapshot) => snapshot.rank !== null)
                            .map((snapshot) => ({
                              time: new Date(snapshot.checkedAt).toLocaleString(),
                              rank: snapshot.rank,
                            }))}
                          margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.18)" />
                          <XAxis dataKey="time" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                          <YAxis reversed domain={[1, "auto"]} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={34} />
                          <Tooltip />
                          <Line
                            type="monotone"
                            dataKey="rank"
                            stroke="#f59e0b"
                            strokeWidth={2}
                            dot={{ r: 3 }}
                            activeDot={{ r: 5 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </div>
            </div>

          </div>
        </>
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
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </Layout>
  );
}
