import { useState, useEffect, useRef } from "react";
import { Routes, Route, Link, useLocation, useNavigate } from "react-router-dom";
import { useTheme } from "./stores/theme";
import { useProject } from "./stores/project";
import { cn } from "./lib/utils";
import { formatTokens, platformLabel } from "./lib/format";
import { CredentialIndicator } from "./components/ui/CredentialIndicator";
import { HomePage } from "./components/home/HomePage";
import { TaskCenterPage } from "./components/tasks/TaskCenterPage";
import { ManageProjectsPage } from "./components/projects/ManageProjectsPage";
import { OverviewPage } from "./components/overview/OverviewPage";
import { CopilotPage } from "./components/copilot/CopilotPage";
import { ReleasePage } from "./components/release/ReleasePage";
import { PromotionPage } from "./components/promotion/PromotionPage";
import { KeywordsPage } from "./components/keywords/KeywordsPage";
import { SettingsPage } from "./components/settings/SettingsPage";
import { ProjectSettingsPage } from "./components/settings/ProjectSettingsPage";
import { DataSyncLayer } from "./components/ui/DataSyncLayer";

/* ── 项目页面导航（放左侧边栏，属于“项目”维度） ── */

const PROJECT_NAV_ITEMS = [
  { to: "/overview", label: "总览", title: "项目总览" },
  { to: "/copilot", label: "副驾", title: "AI 副驾工作台" },
  { to: "/release", label: "发布", title: "发布工作台" },
  { to: "/promotion", label: "推广", title: "上架后推广" },
  { to: "/keywords", label: "排名", title: "关键词排名" },
];

/* ── 左侧浮动面板：项目切换 + 项目页面导航 ── */

function ProjectSidebar({ open }: { open: boolean }) {
  const { projects, currentProjectId, currentProductId, select, selectProduct, addByFolder } =
    useProject();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const handleAdd = async () => {
    setMenuOpen(false);
    const folder = await (window as any).appilot?.dialog?.selectFolder();
    if (folder) await addByFolder(folder);
  };

  const choose = (projectId: string, productId?: string) => {
    setMenuOpen(false);
    select(projectId);
    if (productId) selectProduct(productId);
    if (location.pathname === "/") navigate("/overview");
  };

  const currentProject = projects.find((p) => p.id === currentProjectId) || null;
  const currentProduct =
    currentProject?.storeProducts?.find((product) => product.id === currentProductId) ||
    currentProject?.storeProducts?.[0] ||
    null;
  const label = currentProject
    ? currentProject.storeProducts.length > 1 && currentProduct
      ? `${currentProject.name} · ${platformLabel(currentProduct.platform)}`
      : currentProject.name
    : "选择项目";

  return (
    <aside
      className={cn(
        // 浮动面板：位于底栏上方区域内，上/左/下各留 16px 外边距、圆角 20、低透明度柔和投影。
        // 常驻挂载，开合用 transform + opacity 过渡（reduced-motion 时全局规则将其压成瞬切）。
        "absolute left-4 top-4 bottom-[72px] z-40 w-32 rounded-[20px]",
        "border border-zinc-200/80 dark:border-zinc-800/80",
        "bg-white/75 dark:bg-zinc-900/70 backdrop-blur-xl backdrop-saturate-150",
        "shadow-[0_2px_6px_rgba(0,0,0,0.04),0_16px_40px_-8px_rgba(0,0,0,0.08)]",
        "dark:shadow-[0_2px_6px_rgba(0,0,0,0.4),0_16px_40px_-8px_rgba(0,0,0,0.5)]",
        "flex flex-col p-2 transition-all duration-300 ease-out",
        open
          ? "translate-x-0 opacity-100 visible"
          : "pointer-events-none invisible -translate-x-[150%] opacity-0",
      )}
    >
      {/* 单一区块：先选项目（下拉），其下即是该项目的页面 */}
      <div className="shrink-0">
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            title={currentProject ? `当前项目：${label}（点击切换项目）` : "还没有项目，点击添加"}
            className="w-full flex items-center justify-between gap-1 pl-2 pr-1.5 h-9 text-[12.5px] text-zinc-700 dark:text-zinc-200"
          >
            <span className="truncate">{label}</span>
            <span
              className={cn(
                "text-[10px] text-zinc-400 transition-transform shrink-0",
                menuOpen && "rotate-180",
              )}
            >
              ▾
            </span>
          </button>

          {menuOpen && (
            <div className="absolute left-0 top-full mt-1 z-40 w-60 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl shadow-[0_12px_32px_rgba(0,0,0,0.12)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.5)] py-1 max-h-[70vh] overflow-auto">
              {projects.length === 0 && (
                <div className="px-3 py-2 text-xs text-zinc-400 dark:text-zinc-500">
                  还没有项目，先添加一个。
                </div>
              )}
              {projects.map((p) => {
                const products = p.storeProducts || [];
                if (products.length > 1) {
                  return (
                    <div key={p.id} className="py-1">
                      <div className="w-full flex items-center gap-2 px-3 py-1 text-sm text-zinc-600 dark:text-zinc-400">
                        <span className="text-xs text-transparent">✓</span>
                        <span className="truncate">{p.name}</span>
                      </div>
                      {products.map((product) => (
                        <button
                          key={product.id}
                          onClick={() => choose(p.id, product.id)}
                          className={cn(
                            "w-full flex items-center gap-2 pl-8 pr-3 py-1.5 text-xs text-left",
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
                  );
                }
                const product = products[0];
                return (
                  <button
                    key={p.id}
                    onClick={() => choose(p.id, product?.id)}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 text-sm text-left",
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
              <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
              <button
                onClick={handleAdd}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
              >
                <span className="text-amber-500">＋</span> 添加项目
              </button>
              <Link
                to="/projects"
                onClick={() => setMenuOpen(false)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
              >
                <span className="text-zinc-400">⚙</span> 管理项目
              </Link>
            </div>
          )}
        </div>

        {/* 项目页面：与项目下拉在同一面板内 */}
        <nav className="mt-1 border-t border-zinc-200/70 dark:border-zinc-800/70 p-1 space-y-0.5">
          {PROJECT_NAV_ITEMS.map((item) => {
            const active = location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
            return (
              <Link
                key={item.to}
                to={item.to}
                title={item.title}
                className={cn(
                  "flex items-center px-2 py-1.5 text-[12.5px] rounded-lg transition-colors",
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
    </aside>
  );
}

/* ── 底部全局栏 + 内容区 ── */

function Layout({ children }: { children: React.ReactNode }) {
  const { projects, currentProjectId, currentProductId, loading, load } = useProject();
  const location = useLocation();
  const [aiUsage, setAiUsage] = useState<{ totalTokens: number; cachedTokens: number; calls?: number } | null>(null);
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
            calls: u?.calls ?? 0,
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
    // 主进程记账后的直连推送：跳过 data-changed → CustomEvent → 再 IPC 三跳，
    // 每次请求完成都确定性更新胶囊（此前这条中转链上更新不可见）。
    const offUsage = (window as any).appilot?.stats?.onAiUsage?.((usage: any) => {
      setAiUsage({
        totalTokens: usage?.totalTokens ?? 0,
        cachedTokens: usage?.cachedTokens ?? 0,
        calls: usage?.calls ?? 0,
      });
    });
    const timer = setInterval(refresh, 30_000);
    return () => {
      window.removeEventListener("appilot:data-changed", handler);
      offUsage?.();
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
  const copilotReturn = (location.state as any)?.copilotReturn as
    | { to?: string; label?: string }
    | undefined;

  return (
    <div className="relative h-screen overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      <DataSyncLayer />

      {/* 主内容区：占据底栏（状态栏）以上的空间，为浮动侧栏让位（16+128+16=160px）；
          底部再留 16px，避免内容贴死状态栏上缘 */}
      <main
        className={cn(
          "absolute inset-x-0 top-0 bottom-14 overflow-auto pb-4 transition-[padding] duration-300 ease-out",
          sidebarOpen ? "pl-[160px]" : "pl-4",
        )}
      >
        {copilotReturn && location.pathname !== "/copilot" && (
          <div className="sticky top-0 z-20 flex h-10 items-center gap-3 border-b border-amber-200/70 dark:border-amber-500/20 bg-amber-50/95 dark:bg-zinc-900/95 px-4 backdrop-blur">
            <Link
              to={copilotReturn.to || "/copilot"}
              className="text-xs font-medium text-amber-700 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-300"
            >
              ← {copilotReturn.label || "返回副驾"}
            </Link>
            <span className="text-[11px] text-zinc-400">你正在查看该建议对应的完整功能页</span>
          </div>
        )}
        {loading && projects.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-sm text-zinc-400 dark:text-zinc-500">
            <span className="w-5 h-5 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-transparent animate-spin" />
            正在载入…
          </div>
        ) : (
          children
        )}
      </main>

      {/* 左侧浮动面板：项目切换 + 项目页面导航（常驻挂载，开合走过渡） */}
      <ProjectSidebar open={sidebarOpen} />

      {/* 底部状态栏：固定占据窗口底部整行（侧栏与内容区都在其上方），
          承载全局状态 + 全局功能入口 */}
      <footer className="absolute inset-x-0 bottom-0 z-30 flex h-14 items-center gap-2.5 px-3 border-t border-zinc-200/60 dark:border-zinc-800/60 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl">
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

        {/* 右侧：全局状态与全局入口 */}
        <div className="ml-auto flex items-center gap-2">
          {/* 凭据状态标志：项目级覆盖 → 绿色；全局 → 中性；未设置 → 虚线。
              点击前往对应管理页；替代原先散在各功能页的“凭据已设置”标志 */}
          {currentProject && (
            <div className="flex items-center gap-1.5">
              <CredentialIndicator
                kind="github"
                source={currentProject.githubSource ?? null}
                projectId={currentProject.id}
              />
              <CredentialIndicator
                kind="asc"
                source={currentProject.ascSource ?? null}
                projectId={currentProject.id}
              />
            </div>
          )}

          <div
            className="flex items-center gap-1.5 px-2.5 h-7 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[11px] text-zinc-500 dark:text-zinc-400"
            title={
              aiUsage
                ? `AI 消耗：累计 ${aiUsage.calls ?? "—"} 次请求 · ${aiUsage.totalTokens.toLocaleString()} token（其中缓存命中 ${aiUsage.cachedTokens.toLocaleString()}）`
                : "AI 消耗 Token（其中缓存命中多少）"
            }
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
      </footer>
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
        <Route path="/copilot" element={<CopilotPage />} />
        <Route path="/keywords" element={<KeywordsPage />} />
        <Route path="/tasks" element={<TaskCenterPage />} />
        <Route path="/release" element={<ReleasePage />} />
        <Route path="/promotion" element={<PromotionPage />} />
        <Route path="/promotion/:campaignId" element={<PromotionPage />} />
        <Route path="/projects" element={<ManageProjectsPage />} />
        <Route path="/projects/:projectId/settings" element={<ProjectSettingsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </Layout>
  );
}
