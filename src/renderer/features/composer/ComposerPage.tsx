import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useProject } from "../../stores/project";

const stages = [
  { value: "launch", label: "Launch Announcement" },
  { value: "feature_update", label: "Feature Update" },
  { value: "tech_share", label: "Tech Share" },
  { value: "tutorial", label: "Tutorial / Guide" },
  { value: "milestone", label: "Milestone" },
];

const inputClass = "w-full px-3.5 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-shadow";
const btnPrimary = "inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white shadow-sm shadow-indigo-500/25 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed";
const btnSecondary = "inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-all duration-150";

export function ComposerPage() {
  const { repoUrl, projectName } = useProject();
  const navigate = useNavigate();
  const [stage, setStage] = useState("launch");
  const [tweet, setTweet] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const ai = (window as any).appilot?.ai;
  const draft = (window as any).appilot?.draft;

  // Load saved draft on mount
  useEffect(() => {
    draft?.load().then((d: any) => {
      if (d?.content) setTweet(d.content);
    }).catch(() => {});
  }, []);

  const handleGenerate = async () => {
    if (!repoUrl) { setGenError("No repository configured. Go to Setup first."); return; }
    setGenerating(true); setGenError(""); setSaved(false);
    try {
      const result = await ai.generateTweet(repoUrl, stage);
      setTweet(result.body || "");
    } catch (e: any) {
      setGenError(e.message || "Generation failed");
    } finally { setGenerating(false); }
  };

  const handleSave = async () => {
    await draft?.save(tweet);
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  const handleTweet = () => {
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}`;
    (window as any).appilot?.openExternal(url);
    // Navigate to Tracking so user can paste the tweet URL and log stats
    setTimeout(() => navigate("/tracking"), 500);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(tweet);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const charCount = tweet.length;
  const overLimit = charCount > 280;

  return (
    <div className="p-10 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Tweet Composer</h2>
          {projectName && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">{projectName}</p>
          )}
        </div>
        {!repoUrl && (
          <span className="text-xs px-3 py-1 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium border border-amber-200 dark:border-amber-500/20">
            No repo configured
          </span>
        )}
      </div>

      {/* Stage selector + Generate */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm mb-6">
        <div className="p-5 space-y-4">
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Promotion Stage</label>
              <select value={stage} onChange={(e) => setStage(e.target.value)} className={inputClass}>
                {stages.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <button onClick={handleGenerate} disabled={generating || !repoUrl} className={btnPrimary}>
              {generating ? <><Spinner /> Generating...</> : "Generate Tweet"}
            </button>
          </div>
        </div>
      </div>

      {/* Generation error */}
      {genError && (
        <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/50 text-sm text-red-700 dark:text-red-400 flex items-start gap-3">
          <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          {genError}
        </div>
      )}

      {/* Tweet editor */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm mb-6 overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between">
          <span className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300">Tweet</span>
          <span className={`text-[13px] font-mono font-medium ${overLimit ? "text-red-500" : charCount > 250 ? "text-amber-500" : "text-zinc-400 dark:text-zinc-500"}`}>
            {charCount}/280
          </span>
        </div>
        <div className="p-5">
          <textarea
            value={tweet}
            onChange={(e) => { setTweet(e.target.value); setSaved(false); }}
            placeholder="Click 'Generate Tweet' to create an AI draft, or type your own..."
            rows={6}
            className="w-full rounded-lg border-0 bg-transparent text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 resize-none focus:outline-none focus:ring-0"
          />
        </div>
        <div className="px-5 py-3 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-900/30 flex flex-wrap gap-2">
          <button onClick={handleGenerate} disabled={generating || !repoUrl} className={btnSecondary}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
            </svg>
            Regenerate
          </button>
          <button onClick={handleSave} disabled={!tweet} className={btnSecondary}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
            </svg>
            {saved ? "Saved" : "Save Draft"}
          </button>
          <button onClick={handleCopy} disabled={!tweet} className={btnSecondary}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
            </svg>
            {copied ? "Copied" : "Copy"}
          </button>
          <div className="flex-1" />
          <button onClick={handleTweet} disabled={!tweet || overLimit} className={btnPrimary}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
            Tweet
          </button>
        </div>
      </div>

      {/* Info tip */}
      {!repoUrl && (
        <div className="p-4 rounded-xl bg-indigo-50 dark:bg-indigo-500/5 border border-indigo-100 dark:border-indigo-500/10 text-sm text-indigo-700 dark:text-indigo-400 text-center">
          Go to <a href="#/" className="underline font-medium">Setup</a> first — connect a repository to enable AI tweet generation.
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
