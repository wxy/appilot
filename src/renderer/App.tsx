import { useState, useEffect, useRef } from "react";
import { Routes, Route, Link, useLocation, useNavigate } from "react-router-dom";
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
          <Link to="/" className="flex items-center gap-2.5" title="返回首页">
            <div className="w-7 h-7 rounded-lg bg-amber-500 flex items-center justify-center">
              <span className="text-white text-xs font-bold">A</span>
            </div>
            <div>
              <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Appilot</h1>
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium">你的副驾驶</p>
            </div>
          </Link>
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
                    {p.productType === "ios" ? "iOS" : p.productType === "macos" ? "macOS" : "未识别"}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-10 rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 p-10 text-center">
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
          接入一个本地应用仓库，让副驾驶识别产品并建议关键词。
        </p>
        <button onClick={handleAdd} disabled={adding} className={btnPrimary}>
          {adding ? "正在分析..." : "＋ 添加项目"}
        </button>
      </div>
    </div>
  );
}

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

  const languages = project.supportedLanguages || [];
  const storeLinks = project.storeLinks || [];
  const storeGroups = [
    { label: "macOS", links: storeLinks.filter((l) => l.platform === "macos") },
    { label: "iOS", links: storeLinks.filter((l) => l.platform === "ios") },
    { label: "其他", links: storeLinks.filter((l) => l.platform === "unknown") },
  ].filter((g) => g.links.length > 0);

  return (
    <div className="p-10 max-w-2xl mx-auto">
      {/* App identity */}
      <div className="flex items-center gap-4 mb-8">
        {project.artworkUrl ? (
          <img
            src={project.artworkUrl}
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
            {project.trackName || project.name}
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
          <Field label="产品类型" value={project.productType === "ios" ? "iOS" : project.productType === "macos" ? "macOS" : "未识别"} />
          <Field label="商店名称" value={project.trackName || project.name} />
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

/* ── Keywords (tracking vs submission, one AI request per language) ── */

interface KeywordSuggestion {
  keyword: string;
  rationale: string;
}

interface KeywordGeneration {
  tracking: KeywordSuggestion[];
  submission: string[];
}

function KeywordsPage() {
  const { projects, currentProjectId, updateTrackedKeywords, updateSubmissionKeywords } = useProject();
  const project = projects.find((p) => p.id === currentProjectId);
  const [activeLang, setActiveLang] = useState<string>("");
  const [submissionDrafts, setSubmissionDrafts] = useState<Record<string, string>>({});
  const [loadingLangs, setLoadingLangs] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  if (!project) {
    return <EmptyState title="还没有项目" desc="添加一个项目后，这里会展示关键词。" />;
  }

  const languages = project.supportedLanguages || [];
  const currentLang = languages.some((l) => l.code === activeLang) ? activeLang : (languages[0]?.code || "");
  const tracked = (project.trackedKeywords || []).filter((k) => k.language === currentLang);
  const savedSubmission = (project.submissionKeywords || []).find((s) => s.language === currentLang);
  const submissionText = submissionDrafts[currentLang] ?? savedSubmission?.text ?? "";
  const charCount = submissionText.length;
  const currentLoading = loadingLangs.has(currentLang);

  const generateOne = async (lang: string): Promise<{ lang: string; gen: KeywordGeneration | null }> => {
    try {
      const gen: KeywordGeneration = await (window as any).appilot.projects.generateKeywords(project.id, lang);
      return { lang, gen };
    } catch (e: any) {
      setError(e.message || "关键词生成失败。请先在设置里配置 AI。");
      return { lang, gen: null };
    }
  };

  const applyGenerations = async (results: { lang: string; gen: KeywordGeneration | null }[]) => {
    const latest = useProject.getState().projects.find((p) => p.id === currentProjectId);
    let trackedNext = [...(latest?.trackedKeywords || [])];
    let submissionNext = [...(latest?.submissionKeywords || [])];
    const drafts: Record<string, string> = {};

    for (const r of results) {
      if (!r.gen) continue;
      const existingKeys = new Set(trackedNext.filter((k) => k.language === r.lang).map((k) => k.keyword));
      const additions = r.gen.tracking
        .filter((s) => !existingKeys.has(s.keyword))
        .map((s) => ({ language: r.lang, keyword: s.keyword, rationale: s.rationale }));
      trackedNext = [...trackedNext, ...additions];

      const submissionText = r.gen.submission.join(",").trim();
      drafts[r.lang] = submissionText;
      if (submissionText) {
        submissionNext = submissionNext.filter((s) => s.language !== r.lang);
        submissionNext.push({ language: r.lang, text: submissionText });
      }
    }

    if (results.some((r) => r.gen)) {
      const savedTracked = await (window as any).appilot.projects.saveTrackedKeywords(project.id, trackedNext);
      const savedSubmission = await (window as any).appilot.projects.saveSubmissionKeywords(project.id, submissionNext);
      updateTrackedKeywords(project.id, savedTracked.trackedKeywords);
      updateSubmissionKeywords(project.id, savedSubmission.submissionKeywords);
    }
    setSubmissionDrafts((prev) => ({ ...prev, ...drafts }));
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

  const removeTracked = async (kw: string) => {
    const next = (project.trackedKeywords || []).filter((k) => !(k.language === currentLang && k.keyword === kw));
    const saved = await (window as any).appilot.projects.saveTrackedKeywords(project.id, next);
    updateTrackedKeywords(project.id, saved.trackedKeywords);
  };

  const saveSubmission = async () => {
    const next = [
      ...(project.submissionKeywords || []).filter((s) => s.language !== currentLang),
      { language: currentLang, text: submissionText },
    ];
    const saved = await (window as any).appilot.projects.saveSubmissionKeywords(project.id, next);
    updateSubmissionKeywords(project.id, saved.submissionKeywords);
    setSubmissionDrafts((prev) => {
      const copy = { ...prev };
      delete copy[currentLang];
      return copy;
    });
  };

  return (
    <div className="p-10 max-w-3xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">关键词</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
            跟踪关键词模拟用户搜索；商店关键词用于提交，每语言 ≤100 字符。
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
            {/* Tracking keywords */}
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">跟踪关键词（{tracked.length}）</h3>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">模拟用户会搜索的词，用于跟踪排名，不限制数量。</p>
                </div>
                <button onClick={() => handleGenerate(currentLang)} disabled={currentLoading} className={btnPrimary}>
                  {currentLoading ? "生成中..." : "AI 生成"}
                </button>
              </div>
              <div className="p-4">
                {tracked.length === 0 ? (
                  <p className="text-sm text-zinc-400 dark:text-zinc-500 py-4 text-center">暂无关键词，点击「AI 生成」。</p>
                ) : (
                  <div className="space-y-1">
                    {tracked.map((k) => (
                      <div key={k.keyword} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                        <div className="min-w-0">
                          <span className="text-sm font-mono text-zinc-800 dark:text-zinc-200">{k.keyword}</span>
                          {k.rationale && <span className="text-xs text-zinc-400 dark:text-zinc-500 ml-2">{k.rationale}</span>}
                        </div>
                        <button
                          onClick={() => removeTracked(k.keyword)}
                          className="shrink-0 text-zinc-400 hover:text-red-500 text-xs"
                          title="移除"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Submission keywords */}
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
                <div className="flex items-center justify-between gap-4">
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">商店关键词（提交字段）</h3>
                  <span className={cn("text-xs font-mono", charCount > 100 ? "text-red-500 dark:text-red-400" : "text-zinc-400 dark:text-zinc-500")}>
                    {charCount}/100
                  </span>
                </div>
              </div>
              <div className="p-5 space-y-3">
                <div className="flex gap-2">
                  <input
                    value={submissionText}
                    onChange={(e) => setSubmissionDrafts((prev) => ({ ...prev, [currentLang]: e.target.value }))}
                    placeholder="kw1,kw2,kw3"
                    className={inputClass}
                  />
                  <button onClick={saveSubmission} className={btnPrimary}>保存</button>
                </div>
                <p className="text-xs text-zinc-400 dark:text-zinc-500">
                  逗号分隔、无空格；这是提交到 App Store 的字段，总长需 ≤100 字符。
                </p>
                {charCount > 100 && (
                  <p className="text-xs text-red-600 dark:text-red-400">已超过 100 字符，请精简后再保存。</p>
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
        <Route path="/" element={<HomePage />} />
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/keywords" element={<KeywordsPage />} />
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
