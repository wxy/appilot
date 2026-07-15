import { useState } from "react";
import { Link } from "react-router-dom";

// Type for the AI analysis result from IPC
interface AnalysisResult {
  name: string;
  tagline: string;
  description: string;
  techStack: string[];
  keyFeatures: string[];
  audience: string | null;
}

export function SetupPage() {
  const [repoUrl, setRepoUrl] = useState("");
  const [projectName, setProjectName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);

  const ai = (window as any).appilot?.ai;

  const handleAnalyze = async () => {
    if (!repoUrl.trim()) return;
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const data = await ai.analyzeProduct(repoUrl.trim());
      setResult(data);
      if (!projectName) setProjectName(data.name || "");
    } catch (e: any) {
      setError(e.message || "Analysis failed. Check the repo URL and try again.");
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    "w-full px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600";

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold mb-2">Project Setup</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
        Connect a GitHub repository and let AI analyze it to generate promotion content.
      </p>

      {/* Input form */}
      <div className="space-y-4 mb-8">
        <div>
          <label className="block text-sm font-medium mb-1">GitHub Repository URL</label>
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
          <label className="block text-sm font-medium mb-1">Project Name (auto-filled)</label>
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="My Project"
            className={inputClass}
          />
        </div>
        <button
          onClick={handleAnalyze}
          disabled={loading || !repoUrl.trim()}
          className="px-4 py-2 text-sm rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {loading ? "Analyzing..." : "Connect & Analyze"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-8 p-4 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="mb-8 p-8 border-2 border-dashed rounded-lg text-center text-sm text-zinc-500 dark:text-zinc-400 animate-pulse">
          Analyzing repository...
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-6">
          {/* Product card */}
          <div className="p-6 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
            <h3 className="text-lg font-semibold mb-1">{result.name}</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3">{result.tagline}</p>
            {result.description && (
              <p className="text-sm mb-3">{result.description}</p>
            )}

            {result.techStack.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {result.techStack.map((tech) => (
                  <span
                    key={tech}
                    className="px-2 py-0.5 text-[11px] rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                  >
                    {tech}
                  </span>
                ))}
              </div>
            )}

            {result.audience && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Target audience: {result.audience}
              </p>
            )}
          </div>

          {/* Key features */}
          {result.keyFeatures.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-2">Key Features</h4>
              <ul className="space-y-1">
                {result.keyFeatures.map((f, i) => (
                  <li key={i} className="text-sm flex items-start gap-2">
                    <span className="text-green-500 mt-0.5">✅</span>
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* CTA */}
          <div className="flex gap-3 pt-2">
            <Link
              to="/composer"
              className="px-4 py-2 text-sm rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 transition-opacity"
            >
              Generate Promotion Tweet →
            </Link>
            <button
              onClick={handleAnalyze}
              className="px-4 py-2 text-sm rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
            >
              Re-analyze
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!result && !loading && !error && (
        <div className="p-8 border-2 border-dashed rounded-lg text-center text-sm text-zinc-500 dark:text-zinc-400">
          <p>Enter a GitHub public repository URL above and click "Connect & Analyze".</p>
          <p className="mt-1 text-xs">
            Make sure your AI API is configured in{" "}
            <Link to="/settings" className="underline hover:text-zinc-600 dark:hover:text-zinc-400">
              Settings
            </Link>{" "}
            first.
          </p>
        </div>
      )}
    </div>
  );
}
