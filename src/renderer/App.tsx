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
  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold mb-6">Settings</h2>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Theme</label>
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as "light" | "dark" | "system")}
            className="px-3 py-2 rounded-md border bg-white dark:bg-zinc-900 text-sm"
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </select>
        </div>
        <div className="pt-4 border-t">
          <p className="text-xs text-muted-foreground">
            Appilot v0.1.0 · Phase 0 MVP · Electron + React + TypeScript + Tailwind CSS
          </p>
        </div>
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
