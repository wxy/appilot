import { useState, useEffect } from "react";
import { Routes, Route, Link, useLocation } from "react-router-dom";
import { useTheme } from "./stores/theme";
import { cn } from "./lib/utils";
import { SetupPage } from "./features/setup/SetupPage";
import { ComposerPage } from "./features/composer/ComposerPage";

/* ── Layout ── */

function Layout({ children }: { children: React.ReactNode }) {
  const { resolved, toggle } = useTheme();
  const location = useLocation();

  const navItems = [
    { to: "/", label: "Setup", icon: SetupIcon },
    { to: "/composer", label: "Composer", icon: ComposeIcon },
    { to: "/tracking", label: "Tracking", icon: ChartIcon },
    { to: "/settings", label: "Settings", icon: GearIcon },
  ];

  return (
    <div className="flex h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Sidebar */}
      <aside className="w-60 flex flex-col bg-white dark:bg-zinc-900 border-r border-zinc-200/60 dark:border-zinc-800/60">
        {/* Brand */}
        <div className="px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-indigo-500 flex items-center justify-center">
              <span className="text-white text-xs font-bold">A</span>
            </div>
            <div>
              <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Appilot</h1>
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium">Phase 0 MVP</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-2 space-y-0.5">
          {navItems.map((item) => {
            const active = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg transition-all duration-150",
                  active
                    ? "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-medium"
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
                )}
              >
                <item.icon active={active} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-zinc-100 dark:border-zinc-800/60">
          <button
            onClick={toggle}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors"
          >
            {resolved === "dark" ? <SunIcon /> : <MoonIcon />}
            {resolved === "dark" ? "Light Mode" : "Dark Mode"}
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-auto">
        <div className="min-h-full">{children}</div>
      </main>
    </div>
  );
}

/* ── SVG Icons ── */

function SetupIcon({ active }: { active: boolean }) {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8}
      stroke={active ? "currentColor" : "currentColor"}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  );
}
function ComposeIcon({ active }: { active: boolean }) {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8}
      stroke={active ? "currentColor" : "currentColor"}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
    </svg>
  );
}
function ChartIcon({ active }: { active: boolean }) {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8}
      stroke={active ? "currentColor" : "currentColor"}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  );
}
function GearIcon({ active }: { active: boolean }) {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8}
      stroke={active ? "currentColor" : "currentColor"}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}
function SunIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
    </svg>
  );
}

/* ── Shared input style ── */

const inputClass = "w-full px-3.5 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 dark:focus:border-indigo-400 transition-shadow";
const btnPrimary = "inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white shadow-sm shadow-indigo-500/25 hover:shadow-indigo-500/30 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed";
const btnSecondary = "inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-all duration-150";

/* ── Placeholder pages ── */

function TrackingPage() {
  return <PlaceholderPage title="Post Tracking" desc="Paste tweet URLs, enter stats, and see trend charts." comingIn="Task 0.13" />;
}

function PlaceholderPage({ title, desc, comingIn }: { title: string; desc: string; comingIn: string }) {
  return (
    <div className="p-10 max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">{title}</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-8">{desc}</p>
      <div className="flex flex-col items-center justify-center py-16 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl bg-white dark:bg-zinc-900/50">
        <div className="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-3">
          <svg className="w-6 h-6 text-zinc-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-sm text-zinc-400 dark:text-zinc-500 font-medium">{comingIn}</p>
      </div>
    </div>
  );
}

/* ── Settings Page ── */

const AI_PRESETS = [
  { label: "OpenAI", url: "https://api.openai.com/v1", model: "gpt-4o" },
  { label: "OpenAI (Mini)", url: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { label: "DeepSeek", url: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { label: "Groq", url: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  { label: "Ollama (Local)", url: "http://localhost:11434/v1", model: "llama3" },
  { label: "Custom", url: "", model: "" },
];

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
      setStatus("success"); setStatusMsg("Saved successfully");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (e: any) { setStatus("error"); setStatusMsg(e.message || "Save failed"); }
  };

  const handleTest = async () => {
    setTesting(true); setStatus("idle");
    try {
      const ok = await (window as any).appilot?.ai?.testConnection({ providerUrl, apiKey, model });
      setStatus(ok ? "success" : "error");
      setStatusMsg(ok ? "Connection successful" : "Connection failed");
    } catch (e: any) { setStatus("error"); setStatusMsg(e.message || "Error"); }
    finally { setTesting(false); }
  };

  return (
    <div className="p-10 max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Settings</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-8">Configure your AI provider to enable content generation.</p>

      {/* AI Card */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden mb-8 shadow-sm">
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">AI Provider</h3>
        </div>
        <div className="p-6 space-y-5">
          <div>
            <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Provider</label>
            <select value={preset} onChange={(e) => handlePresetChange(e.target.value)} className={inputClass}>
              {AI_PRESETS.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Provider URL</label>
            <input type="text" value={providerUrl} onChange={(e) => setProviderUrl(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">API Key</label>
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className={inputClass} placeholder="sk-..." />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Model</label>
            <input type="text" value={model} onChange={(e) => setModel(e.target.value)} className={inputClass} />
          </div>
          <div className="flex gap-3 items-center pt-1">
            <button onClick={handleSave} className={btnPrimary}>Save</button>
            <button onClick={handleTest} disabled={testing} className={btnSecondary}>{testing ? "Testing..." : "Test Connection"}</button>
            {status !== "idle" && (
              <span className={`text-[13px] font-medium flex items-center gap-1.5 ${status === "success" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
                {statusMsg}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Appearance Card */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm mb-8">
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Appearance</h3>
        </div>
        <div className="p-6">
          <select value={theme} onChange={(e) => setTheme(e.target.value as any)} className={inputClass + " max-w-xs"}>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </select>
        </div>
      </div>

      <p className="text-[11px] text-zinc-400 dark:text-zinc-500">Appilot v0.1.0 · Phase 0 MVP</p>
    </div>
  );
}

/* ── App Root ── */

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<SetupPage />} />
        <Route path="/composer" element={<ComposerPage />} />
        <Route path="/tracking" element={<TrackingPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </Layout>
  );
}
