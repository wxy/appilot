import { useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

interface StatEntry {
  date: string;
  views: number;
  likes: number;
  comments: number;
  note: string;
  permalink: string;
}

const inputClass = "w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-shadow";
const btnPrimary = "inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white shadow-sm shadow-indigo-500/25 transition-all duration-150";

export function TrackingPage() {
  const [permalink, setPermalink] = useState("");
  const [views, setViews] = useState<number | "">("");
  const [likes, setLikes] = useState<number | "">("");
  const [comments, setComments] = useState<number | "">("");
  const [note, setNote] = useState("");
  const [entries, setEntries] = useState<StatEntry[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState("");

  const stats = (window as any).appilot?.stats;

  useEffect(() => {
    stats?.list().then((list: StatEntry[]) => setEntries(list || [])).catch(() => {});
  }, []);

  const handleSubmit = async () => {
    setSaveError("");
    if (views === "" && likes === "" && comments === "") return;
    if (!stats) { setSaveError("Stats API not available. Please restart the app."); return; }
    try {
      const list = await stats.save({
        views: Number(views) || 0,
        likes: Number(likes) || 0,
        comments: Number(comments) || 0,
        note,
        permalink,
      });
      setEntries(list?.length ? list : entries);
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 2000);
      setPermalink(""); setViews(""); setLikes(""); setComments(""); setNote("");
    } catch (e: any) {
      setSaveError(e.message || "Failed to save stats");
    }
  };

  // Chart data: last 14 entries
  const chartData = entries.slice(-14).map((e) => ({
    ...e,
    date: new Date(e.date).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
  }));

  const hasData = entries.length > 0;

  return (
    <div className="p-10 max-w-3xl mx-auto">
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Post Tracking</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-8">Log engagement stats and see how your posts perform over time.</p>

      {/* Stats form */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm mb-8">
        <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
          <h3 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300">Add Stats</h3>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Tweet URL</label>
            <input type="text" value={permalink} onChange={(e) => setPermalink(e.target.value)}
              className={inputClass} placeholder="https://twitter.com/user/status/123456" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Views</label>
              <input type="number" value={views} onChange={(e) => setViews(e.target.value === "" ? "" : Number(e.target.value))}
                className={inputClass} placeholder="0" />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Likes</label>
              <input type="number" value={likes} onChange={(e) => setLikes(e.target.value === "" ? "" : Number(e.target.value))}
                className={inputClass} placeholder="0" />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Comments</label>
              <input type="number" value={comments} onChange={(e) => setComments(e.target.value === "" ? "" : Number(e.target.value))}
                className={inputClass} placeholder="0" />
            </div>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Note (optional)</label>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)}
              className={inputClass} placeholder="e.g. 'Someone asked about Windows support'" />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleSubmit} className={btnPrimary}>
              {submitted ? "Saved ✓" : "Submit Stats"}
            </button>
            {views === "" && likes === "" && comments === "" && (
              <span className="text-xs text-amber-600 dark:text-amber-400">← Fill at least one metric above</span>
            )}
          </div>
          {saveError && (
            <p className="text-sm text-red-600 dark:text-red-400 mt-2">{saveError}</p>
          )}
        </div>
      </div>

      {/* Trend Chart */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm mb-8">
        <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
          <h3 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300">Trend</h3>
        </div>
        <div className="p-5">
          {hasData ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-zinc-200 dark:text-zinc-800" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="currentColor" className="text-zinc-400" />
                <YAxis tick={{ fontSize: 11 }} stroke="currentColor" className="text-zinc-400" />
                <Tooltip
                  contentStyle={{
                    borderRadius: "0.75rem",
                    border: "1px solid rgba(0,0,0,0.1)",
                    fontSize: "13px",
                    background: "var(--tooltip-bg, #fff)",
                  }}
                />
                <Legend />
                <Line type="monotone" dataKey="views" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} name="Views" />
                <Line type="monotone" dataKey="likes" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} name="Likes" />
                <Line type="monotone" dataKey="comments" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} name="Comments" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-sm text-zinc-400 dark:text-zinc-500">
              <svg className="w-10 h-10 mb-3 text-zinc-300 dark:text-zinc-700" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
              Submit stats to see your engagement trend chart.
            </div>
          )}
        </div>
      </div>

      {/* History table */}
      {hasData && (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
            <h3 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300">History ({entries.length})</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <th className="text-left px-5 py-2.5 text-[11px] font-medium text-zinc-400 uppercase tracking-wider">Date</th>
                  <th className="text-right px-3 py-2.5 text-[11px] font-medium text-zinc-400 uppercase tracking-wider">Views</th>
                  <th className="text-right px-3 py-2.5 text-[11px] font-medium text-zinc-400 uppercase tracking-wider">Likes</th>
                  <th className="text-right px-3 py-2.5 text-[11px] font-medium text-zinc-400 uppercase tracking-wider">Comments</th>
                  <th className="text-left px-5 py-2.5 text-[11px] font-medium text-zinc-400 uppercase tracking-wider">Note</th>
                </tr>
              </thead>
              <tbody>
                {[...entries].reverse().map((e, i) => (
                  <tr key={i} className="border-b border-zinc-50 dark:border-zinc-800/50 last:border-0">
                    <td className="px-5 py-2.5 text-zinc-500 text-xs whitespace-nowrap">
                      {new Date(e.date).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium text-zinc-700 dark:text-zinc-300">{e.views.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{e.likes.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{e.comments.toLocaleString()}</td>
                    <td className="px-5 py-2.5 text-zinc-400 text-xs max-w-[200px] truncate">{e.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
