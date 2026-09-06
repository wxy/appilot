import { useState, useEffect } from "react";
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

/* ── 项目页面导航（放左侧边栏，属于“项目”维度） ── */

const PROJECT_NAV_ITEMS = [
  { to: "/overview", label: "总览", title: "项目总览" },
  { to: "/release", label: "发布", title: "发布工作台" },
  { to: "/keywords", label: "排名", title: "关键词排名" },
  { to: "/reviews", label: "评论", title: "评论" },
  { to: "/trend", label: "趋势", title: "长期效果" },
];

/* ── 左侧边栏：项目切换 + 项目页面导航 ── */

function ProjectSidebar() {
  const { projects, currentProjectId, currentProductId, select, selectProduct, addByFolder } =
    useProject();
  const location = useLocation();
  const navigate = useNavigate();

  const handleAdd = async () => {
    const folder = await (window as any).appilot?.dialog?.selectFolder();
    if (folder) await addByFolder(folder);
  };

  // 选中项目/平台；若正停留在首页，选中后进入项目总览。
  const choose = (projectId: string, productId?: string) => {
    select(projectId);
    if (productId) selectProduct(productId);
    if (location.pathname === "/") navigate("/overview");
  };

  return (
    <aside className="shrink-0 w-60 border-r border-zinc-200/70 dark:border-zinc-800/70 bg-white/60 dark:bg-zinc-900/40 flex flex-col">
      <div className="flex-1 overflow-y-auto px-2 py-3">
        {/* 项目切换 */}
        <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          项目
        </div>
        {projects.length === 0 ? (
          <div className="px-2 py-2 text-xs text-zinc-400 dark:text-zinc-500">
            还没有项目，点击下方「＋ 添加项目」接入一个应用仓库。
          </div>
        ) : (
          <div className="space-y-1">
            {projects.map((p) => {
              const products = p.storeProducts || [];
              if (products.length > 1) {
                return (
                  <div key={p.id} className="py-0.5">
                    <div className="flex items-center gap-2 px-2.5 py-1 text-[13px] text-zinc-700 dark:text-zinc-300">
                      <span className="text-xs text-transparent">✓</span>
                      <span className="truncate">{p.name}</span>
                    </div>
                    <div className="mt-0.5 space-y-0.5">
                      {products.map((product) => (
                        <button
                          key={product.id}
                          onClick={() => choose(p.id, product.id)}
                          className={cn(
                            "w-full flex items-center gap-2 pl-7 pr-2.5 py-1.5 text-xs text-left rounded-lg",
                            product.id === currentProductId
                              ? "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium"
                              : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
                          )}
                        >
                          <span
                            className={cn(
                              "text-xs",
                              product.id === currentProductId ? "text-amber-500" : "text-transparent",
                            )}
                          >
                            ✓
                          </span>
                          <span className="truncate">{platformLabel(product.platform)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              }

              const product = products[0];
              return (
                <button
                  key={p.id}
                  onClick={() => choose(p.id, product?.id)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2.5 py-1.5 text-[13px] text-left rounded-lg",
                    p.id === currentProjectId
                      ? "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium"
                      : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
                  )}
                >
                  <span
                    className={cn(
                      "text-xs",
                      p.id === currentProjectId ? "text-amber-500" : "text-transparent",
                    )}
                  >
                    ✓
                  </span>
                  <span className="truncate">{p.name}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* 项目页面导航 */}
        <div className="mt-5 pt-3 border-t border-zinc-100 dark:border-zinc-800 px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          页面
        </div>
        <nav className="space-y-0.5">
          {PROJECT_NAV_ITEMS.map((item) => {
            const active = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                title={item.title}
                className={cn(
                  "flex items-center gap-2 px-2.5 py-1.5 text-[13px] rounded-lg transition-colors",
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
      </div>

      {/* 底部：添加 / 管理项目 */}
      <div className="shrink-0 border-t border-zinc-100 dark:border-zinc-800 px-2 py-2 space-y-0.5">
        <button
          onClick={handleAdd}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[13px] text-left rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
        >
          <span className="text-amber-500">＋</span> 添加项目
        </button>
        <Link
          to="/projects"
          className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[13px] text-left rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
        >
          <span className="text-zinc-400">⚙</span> 管理项目
        </Link>
      </div>
    </aside>
  );
}

/* ── 顶部全局栏 + 内容区 ── */

function Layout({ children }: { children: React.ReactNode }) {
  const { projects, currentProjectId, currentProductId, loading, load } = useProject();
  const location = useLocation();
  const [aiUsage, setAiUsage] = useState<{ totalTokens: number; cachedTokens: number } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => useTheme.getState().syncFromSystem();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    load();
  }, []);

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
    // AI 请求记账后主进程推送 ai-usage 事件，用量即时刷新（轮询兜底）。
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail === "ai-usage") refresh();
    };
    window.addEventListener("appilot:data-changed", handler);
    const timer = setInterval(refresh, 30_000);
    return () => {
      window.removeEventListener("appilot:data-changed", handler);
      clearInterval(timer);
    };
  }, []);

  const currentProject = projects.find((p) => p.id === currentProjectId) || null;
  const currentProduct =
    currentProject?.storeProducts?.find((product) => product.id === currentProductId) ||
    currentProject?.storeProducts?.[0] ||
    null;
  const currentProjectLabel = currentProject
    ? currentProject.storeProducts.length > 1 && currentProduct
      ? `${currentProject.name} · ${platformLabel(currentProduct.platform)}`
      : currentProject.name
    : null;

  return (
    <div className="flex flex-col h-screen bg-zinc-50 dark:bg-zinc-950">
      <DataSyncLayer />

      {/* 顶部横栏：全局菜单（不再混入项目导航） */}
      <header className="shrink-0 z-30 flex items-center gap-2.5 px-3 h-14 border-b border-zinc-200/60 dark:border-zinc-800/60 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl">
        <button
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? "收起左侧栏" : "展开左侧栏"}
          className="flex items-center justify-center w-8 h-8 rounded-lg text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors"
        >
          <span className="text-sm leading-none">{sidebarOpen ? "«" : "»"}</span>
        </button>

        <Link to="/" className="flex items-center gap-2 shrink-0 pr-2" title="返回首页">
          <img src="./icon.png" alt="Appilot" className="w-7 h-7 rounded-lg object-cover" />
          <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Appilot</span>
        </Link>

        {/* 全局信息（当前处于的项目也可在此展示；其余空闲留给全局状态） */}
        {currentProjectLabel && (
          <span
            className="hidden md:inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[11px] text-zinc-500 dark:text-zinc-400 truncate max-w-56"
            title="当前项目（项目切换在左侧栏）"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
            <span className="truncate">{currentProjectLabel}</span>
          </span>
        )}

        {/* 右侧：全局操作与全局入口 */}
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

      {/* 左侧栏 + 内容 */}
      <div className="flex flex-1 min-h-0">
        {sidebarOpen && <ProjectSidebar />}
        <main className="flex-1 overflow-auto min-w-0">
          {loading && projects.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-sm text-zinc-400 dark:text-zinc-500">
              <span className="w-5 h-5 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-transparent animate-spin" />
              正在载入…
            </div>
          ) : (
            children
          )}
        </main>
      </div>
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
