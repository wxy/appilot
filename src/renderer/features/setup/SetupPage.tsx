import { useState } from "react";
import { Link } from "react-router-dom";
import { useProject } from "../../stores/project";

interface AnalysisResult {
  name: string;
  tagline: string;
  description: string;
  techStack: string[];
  keyFeatures: string[];
  audience: string | null;
}

const inputClass = "w-full px-3.5 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 dark:focus:border-indigo-400 transition-shadow";
const btnPrimary = "inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white shadow-sm shadow-indigo-500/25 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed";
const btnSecondary = "inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-all duration-150";

export function SetupPage() {
  const [repoUrl, setRepoUrl] = useState("");
  const [projectName, setProjectName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);

  const { setRepoUrl: saveRepoUrl, setProjectName: saveProjectName, setAnalysisResult } = useProject();
  const ai = (window as any).appilot?.ai;

  const handleAnalyze = async () => {
    if (!repoUrl.trim()) return;
    setLoading(true); setError(""); setResult(null);
    try {
      const data = await ai.analyzeProduct(repoUrl.trim());
      setResult(data);
      if (!projectName) setProjectName(data.name || "");
      saveRepoUrl(repoUrl.trim());
      saveProjectName(projectName || data.name || "");
      setAnalysisResult(data);
    } catch (e: any) {
      setError(e.message || "Analysis failed. Check the repo URL and try again.");
    } finally { setLoading(false); }
  };

  return (
    <div className="p-10 max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Project Setup</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-8">
        Connect a GitHub repository and let AI analyze it to generate promotion content.
      </p>

      {/* Input Card */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm mb-8">
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              GitHub Repository URL
            </label>
            <input
              type="text"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
              placeholder="github.com/facebook/react"
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              Project Name <span className="text-zinc-400 font-normal">(auto-filled)</span>
            </label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="My Project"
              className={inputClass}
            />
          </div>
          <button onClick={handleAnalyze} disabled={loading || !repoUrl.trim()} className={btnPrimary}>
            {loading ? (
              <>
                <Spinner />
                Analyzing...
              </>
            ) : (
              <>Connect &amp; Analyze</>
            )}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-8 p-4 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/50 text-sm text-red-700 dark:text-red-400 flex items-start gap-3">
          <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="mb-8 flex flex-col items-center justify-center py-16 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl bg-white dark:bg-zinc-900/50">
          <Spinner large />
          <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400 font-medium">Analyzing repository...</p>
          <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">Fetching README, tech stack, and recent activity</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-6 animate-in fade-in duration-300">
          {/* Product Card */}
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{result.name}</h3>
              {result.audience && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-medium">
                  {result.audience}
                </span>
              )}
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">{result.tagline}</p>
              {result.description && (
                <p className="text-sm text-zinc-500 dark:text-zinc-500">{result.description}</p>
              )}

              {result.techStack.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {result.techStack.map((tech) => (
                    <span key={tech} className="px-2.5 py-1 text-[11px] font-medium rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                      {tech}
                    </span>
                  ))}
                </div>
              )}

              {result.keyFeatures.length > 0 && (
                <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4">
                  <h4 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300 mb-3">Key Features</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {result.keyFeatures.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                        <svg className="w-4 h-4 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {f}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-900/30 flex gap-3">
              <Link to="/composer" className={btnPrimary}>
                Generate Tweet <ArrowRight />
              </Link>
              <button onClick={handleAnalyze} className={btnSecondary}>Re-analyze</button>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!result && !loading && !error && (
        <div className="flex flex-col items-center justify-center py-16 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl bg-white dark:bg-zinc-900/50">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center mb-4">
            <svg className="w-7 h-7 text-indigo-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Connect a repository</h3>
          <p className="text-sm text-zinc-400 dark:text-zinc-500 text-center max-w-xs">
            Enter a GitHub public repo URL above to get started.
          </p>
          <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
            Configure your AI API in{" "}
            <Link to="/settings" className="text-indigo-500 hover:text-indigo-600 dark:text-indigo-400 font-medium underline underline-offset-2">
              Settings
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Utility components ── */

function Spinner({ large }: { large?: boolean }) {
  return (
    <svg className={`animate-spin ${large ? "w-8 h-8" : "w-4 h-4"}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function ArrowRight() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
    </svg>
  );
}
