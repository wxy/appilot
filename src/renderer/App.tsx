import { useState, useEffect, useRef } from "react";
import { Routes, Route, Link, useLocation, Navigate } from "react-router-dom";
import { useTheme } from "./stores/theme";
import { useProject } from "./stores/project";
import { cn } from "./lib/utils";

/* ── Layout ── */

const NAV_ITEMS = [
  { to: "/overview", label: "总览" },
  { to: "/keywords", label: "关键词" },
  { to: "/assets", label: "素材中心" },
  { to: "/repo", label: "仓库动态" },
  { to: "/reviews", label: "评论" },
  { to: "/trend", label: "长期效果" },
];

function Layout({ children }: { children: React.ReactNode }) {
  const { resolved, toggle } = useTheme();
  const { projects, currentProjectId, load, select, addByFolder } = useProject();
  const location = useLocation();
  const [cost, setCost] = useState<number | null>(null);
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
    (window as any).appilot?.stats?.aiUsage()
      .then((u: any) => setCost(u?.estimatedCost ?? 0))
      .catch(() => setCost(0));
  }, []);

  // Close the project switcher when clicking outside.
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

  return (
    <div className="flex h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Sidebar */}
      <aside className="w-60 flex flex-col bg-white dark:bg-zinc-900 border-r border-zinc-200/60 dark:border-zinc-800/60">
        {/* Brand */}
        <div className="px-5 py-4 border-b border-zinc-100 dark:border-zinc-800/60">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-amber-500 flex items-center justify-center">
              <span className="text-white text-xs font-bold">A</span>
            </div>
            <div>
              <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Appilot</h1>
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium">你的副驾驶</p>
            </div>
          </div>
        </div>

        {/* Project switcher */}
        <div ref={menuRef} className="relative px-3 py-3 border-b border-zinc-100 dark:border-zinc-800/60">
          <button
            onClick={() => setProjectMenuOpen((v) => !v)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 hover:border-amber-500/50 transition-colors"
          >
            <span className="truncate">
              {currentProject ? currentProject.name : "选择项目"}
            </span>
            <span className={cn("text-zinc-400 transition-transform", projectMenuOpen && "rotate-180")}>▾</span>
          </button>

          {projectMenuOpen && (
            <div className="absolute left-3 right-3 top-full mt-1 z-20 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg py-1 overflow-hidden">
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { select(p.id); setProjectMenuOpen(false); }}
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
              ))}
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

        {/* Nav (within current project) */}
        <nav className="flex-1 px-3 py-2 overflow-auto">
          {currentProject && (
            <p className="px-3 pb-1 text-[10px] text-zinc-400 dark:text-zinc-500 truncate">
              在 {currentProject.name} 内
            </p>
          )}
          <div className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center px-3 py-2.5 text-sm rounded-lg transition-colors",
                  active
                    ? "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium"
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
                )}
              >
                {item.label}
              </Link>
            );
          })}
          </div>
        </nav>

        {/* Footer: cost + theme */}
        <div className="p-3 border-t border-zinc-100 dark:border-zinc-800/60 space-y-2">
          <div className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 text-[11px] text-zinc-500 dark:text-zinc-400">
            <span>本月 AI 成本</span>
            <span className="font-mono font-medium text-zinc-800 dark:text-zinc-200">
              {cost === null ? "—" : `$${cost.toFixed(2)}`}
            </span>
          </div>
          <button
            onClick={toggle}
            className="w-full flex items-center justify-between px-2 py-1.5 text-sm rounded-lg text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors"
          >
            {resolved === "dark" ? "浅色模式" : "深色模式"}
            <span className="text-xs">{resolved === "dark" ? "☀" : "☾"}</span>
          </button>
          <Link
            to="/settings"
            className="flex items-center justify-between px-2 py-1.5 text-sm rounded-lg text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors"
          >
            设置
            <span className="text-xs">⚙</span>
          </Link>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-auto">
        <div className="min-h-full">{children}</div>
      </main>
    </div>
  );
}

/* ── Pages ── */

function OverviewPage() {
  const { projects, currentProjectId } = useProject();
  const project = projects.find((p) => p.id === currentProjectId);

  if (!project) {
    return (
      <EmptyState
        title="还没有项目"
        desc="添加一个项目，副驾驶帮你看路。"
      />
    );
  }

  return (
    <div className="p-10 max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-1">{project.name}</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-8">
        {project.localPath}
      </p>
      <div className="rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 p-10 text-center text-sm text-zinc-400 dark:text-zinc-500">
        总览（副驾驶简报）将在 Phase A 后续步骤实现
      </div>
    </div>
  );
}

function PlaceholderPage({ title, desc }: { title: string; desc: string }) {
  const { projects, currentProjectId } = useProject();
  if (!projects.some((p) => p.id === currentProjectId)) {
    return <EmptyState title="还没有项目" desc="添加一个项目后，这里会展示数据。" />;
  }
  return (
    <div className="p-10 max-w-2xl mx-auto">
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

/* ── Settings Page (沿用，Phase A 暂不动) ── */

const AI_PRESETS = [
  { label: "OpenAI", url: "https://api.openai.com/v1", model: "gpt-4o" },
  { label: "OpenAI (Mini)", url: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { label: "DeepSeek", url: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { label: "Groq", url: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  { label: "Ollama (Local)", url: "http://localhost:11434/v1", model: "llama3" },
  { label: "Custom", url: "", model: "" },
];

const inputClass = "w-full px-3.5 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 dark:focus:border-amber-400 transition-shadow";
const btnPrimary = "inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-amber-500 hover:bg-amber-600 text-white shadow-sm transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed";
const btnSecondary = "inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-all duration-150";

function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [preset, setPreset] = useState("OpenAI");
  const [providerUrl, setProviderUrl] = useState("https://api.openai.com/v1");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-4o");
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [statusMsg, setStatusMsg] = useState("");

  useEffect(() => {
    (window as any).appilot?.ai?.getConfig().then((c: any) => {
      if (c?.providerUrl) setProviderUrl(c.providerUrl);
      if (c?.apiKey) setApiKey(c.apiKey);
      if (c?.model) setModel(c.model);
      const match = AI_PRESETS.find((p) => p.url === c?.providerUrl && p.model === c?.model);
      if (match) setPreset(match.label);
    }).catch(() => {});
  }, []);

  const handlePresetChange = (label: string) => {
    setPreset(label);
    const p = AI_PRESETS.find((p) => p.label === label);
    if (p && p.label !== "Custom") { setProviderUrl(p.url); setModel(p.model); }
  };

  const handleSave = async () => {
    try {
      await (window as any).appilot?.ai?.saveConfig({ providerUrl, apiKey, model });
      setStatus("success"); setStatusMsg("已保存");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (e: any) { setStatus("error"); setStatusMsg(e.message || "保存失败"); }
  };

  const handleTest = async () => {
    setTesting(true); setStatus("idle");
    try {
      const ok = await (window as any).appilot?.ai?.testConnection({ providerUrl, apiKey, model });
      setStatus(ok ? "success" : "error");
      setStatusMsg(ok ? "连接成功" : "连接失败");
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
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className={inputClass} placeholder="sk-..." />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">模型</label>
            <input type="text" value={model} onChange={(e) => setModel(e.target.value)} className={inputClass} />
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

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/keywords" element={<PlaceholderPage title="关键词排名" desc="跟踪每个关键词在各商店的排名。" />} />
        <Route path="/assets" element={<PlaceholderPage title="素材中心" desc="文案、海报方向、视频脚本。" />} />
        <Route path="/repo" element={<PlaceholderPage title="仓库动态" desc="新 Release 检测与 AI 重审。" />} />
        <Route path="/reviews" element={<PlaceholderPage title="评论洞察" desc="用户评论聚类与洞察。" />} />
        <Route path="/trend" element={<PlaceholderPage title="长期效果" desc="增长时间线与你采纳的动作。" />} />
        <Route path="/projects" element={<ManageProjectsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </Layout>
  );
}
