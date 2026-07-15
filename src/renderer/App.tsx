import { useState, useEffect } from "react";
import { Routes, Route, Link, useLocation } from "react-router-dom";
import { useTheme } from "./stores/theme";
import { cn } from "./lib/utils";

function Layout({ children }: { children: React.ReactNode }) {
  const { resolved, toggle } = useTheme();
  const location = useLocation();

  const navItems = [
    { to: "/", label: "Setup", icon: "⚡" },
    { to: "/composer", label: "Composer", icon: "✍️" },
    { to: "/tracking", label: "Tracking", icon: "📈" },
    { to: "/settings", label: "Settings", icon: "⚙️" },
  ];

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-56 border-r flex flex-col bg-zinc-50 dark:bg-zinc-900">
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
          <h1 className="text-sm font-semibold tracking-tight">Appilot</h1>
          <p className="text-xs text-muted-foreground">Phase 0 MVP</p>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors",
                location.pathname === item.to
                  ? "bg-zinc-200 dark:bg-zinc-800 font-medium"
                  : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
              )}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t border-zinc-200 dark:border-zinc-800">
          <button
            onClick={toggle}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors"
          >
            <span>{resolved === "dark" ? "☀️" : "🌙"}</span>
            {resolved === "dark" ? "Light Mode" : "Dark Mode"}
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-auto">{children}</main>

      {/* Status bar */}
      <div className="fixed bottom-0 left-0 right-0 h-6 bg-zinc-100 dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 flex items-center px-3 text-[11px] text-muted-foreground">
        <span>Appilot v0.1.0</span>
        <span className="mx-2">·</span>
        <span>Electron {typeof navigator !== "undefined" ? navigator.userAgent.match(/Electron\/([\d.]+)/)?.[1] || "dev" : "dev"}</span>
      </div>
    </div>
  );
}

function SetupPage() {
  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold mb-2">Project Setup</h2>
      <p className="text-muted-foreground mb-6">Configure AI API and connect your GitHub repository to get started.</p>
      <div className="p-8 border-2 border-dashed rounded-lg text-center text-muted-foreground text-sm">
        Setup wizard coming in Task 0.9
      </div>
    </div>
  );
}

function ComposerPage() {
  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold mb-2">Tweet Composer</h2>
      <p className="text-muted-foreground mb-6">AI-generated tweet drafts, ready for you to edit and publish.</p>
      <div className="p-8 border-2 border-dashed rounded-lg text-center text-muted-foreground text-sm">
        Composer coming in Task 0.10
      </div>
    </div>
  );
}

function TrackingPage() {
  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold mb-2">Post Tracking</h2>
      <p className="text-muted-foreground mb-6">Paste tweet URLs, enter stats, and see trend charts.</p>
      <div className="p-8 border-2 border-dashed rounded-lg text-center text-muted-foreground text-sm">
        Tracking coming in Task 0.13
      </div>
    </div>
  );
}

function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [providerUrl, setProviderUrl] = useState("https://api.openai.com/v1");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-4o");
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [statusMsg, setStatusMsg] = useState("");

  // Load saved config on mount
  useEffect(() => {
    (window as any).appilot?.ai?.getConfig().then((c: any) => {
      if (c) {
        setProviderUrl(c.providerUrl || "");
        setApiKey(c.apiKey || "");
        setModel(c.model || "");
      }
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    try {
      await (window as any).appilot?.ai?.saveConfig({ providerUrl, apiKey, model });
      setStatus("success");
      setStatusMsg("Saved");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (e: any) {
      setStatus("error");
      setStatusMsg(e.message || "Save failed");
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setStatus("idle");
    try {
      const ok = await (window as any).appilot?.ai?.testConnection({ providerUrl, apiKey, model });
      setStatus(ok ? "success" : "error");
      setStatusMsg(ok ? "Connection successful" : "Connection failed — check URL and API key");
    } catch (e: any) {
      setStatus("error");
      setStatusMsg(e.message || "Connection error");
    } finally {
      setTesting(false);
    }
  };

  const inputClass = "w-full px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600";

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold mb-6">Settings</h2>

      {/* AI Configuration */}
      <section className="mb-8">
        <h3 className="text-sm font-semibold mb-4 text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">AI API</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Provider URL</label>
            <input type="text" value={providerUrl} onChange={(e) => setProviderUrl(e.target.value)}
              className={inputClass} placeholder="https://api.openai.com/v1" />
            <p className="text-[11px] text-muted-foreground mt-1">
              Also supports DeepSeek, Groq, Ollama (http://localhost:11434/v1)
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">API Key</label>
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
              className={inputClass} placeholder="sk-..." />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Model</label>
            <input type="text" value={model} onChange={(e) => setModel(e.target.value)}
              className={inputClass} placeholder="gpt-4o" />
          </div>
          <div className="flex gap-3 items-center">
            <button onClick={handleSave}
              className="px-4 py-2 text-sm rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 transition-opacity">
              Save
            </button>
            <button onClick={handleTest} disabled={testing}
              className="px-4 py-2 text-sm rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors disabled:opacity-50">
              {testing ? "Testing..." : "Test Connection"}
            </button>
            {status !== "idle" && (
              <span className={`text-sm ${status === "success" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                {statusMsg}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Theme */}
      <section className="mb-8">
        <h3 className="text-sm font-semibold mb-4 text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Appearance</h3>
        <select value={theme} onChange={(e) => setTheme(e.target.value as "light" | "dark" | "system")}
          className="px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm">
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="system">System</option>
        </select>
      </section>

      <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800">
        <p className="text-xs text-muted-foreground">
          Appilot v0.1.0 · Phase 0 MVP · Electron + React + TypeScript + Tailwind CSS
        </p>
      </div>
    </div>
  );
}

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
