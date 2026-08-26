import { useState, useEffect, useRef } from "react";
import { Routes, Route, Link, useLocation, useNavigate } from "react-router-dom";
import { useTheme } from "./stores/theme";
import { useProject } from "./stores/project";
import { cn } from "./lib/utils";
import { platformLabel, formatTokens } from "./lib/format";
import { HomePage } from "./components/home/HomePage";
import { TaskCenterPage } from "./components/tasks/TaskCenterPage";
import { ManageProjectsPage } from "./components/projects/ManageProjectsPage";
import { OverviewPage } from "./components/overview/OverviewPage";
import { ReleasePage } from "./components/release/ReleasePage";
import { ReviewsPage } from "./components/reviews/ReviewsPage";
import { KeywordsPage } from "./components/keywords/KeywordsPage";
import { TrendPage } from "./components/trend/TrendPage";
import { SettingsPage } from "./components/settings/SettingsPage";
import { ProjectSettingsPage } from "./components/settings/ProjectSettingsPage";
import { DataSyncLayer } from "./components/ui/DataSyncLayer";

/* ── Layout ── */

const NAV_ITEMS = [
  { to: "/overview", label: "总览", title: "总览" },
  { to: "/release", label: "发布", title: "发布工作台" },
  { to: "/keywords", label: "排名", title: "关键词排名" },
  { to: "/reviews", label: "评论", title: "评论" },
  { to: "/trend", label: "趋势", title: "长期效果" },
];

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
      <DataSyncLayer />
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
        <Route path="/reviews" element={<ReviewsPage />} />
        <Route path="/trend" element={<TrendPage />} />
        <Route path="/projects" element={<ManageProjectsPage />} />
        <Route path="/projects/:projectId/settings" element={<ProjectSettingsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </Layout>
  );
}
