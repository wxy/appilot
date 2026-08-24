import { useCallback, useEffect, useState } from "react";
import { storefrontDisplayName, storefrontsForLanguage } from "../../../engine/storefronts";
import { formatHumanTime } from "../../lib/format";
import { cn } from "../../lib/utils";
import { btnPrimary, btnSmPrimary, btnSmSecondary } from "../ui/styles";

export function CompetitorPanel({
  projectId,
  product,
  defaultTerm,
  viewLang,
}: {
  projectId: string;
  product: { platform?: string; supportedLanguages?: { code: string }[] };
  defaultTerm: string;
  viewLang: string;
}) {
  const [competitors, setCompetitors] = useState<any[]>([]);
  const [term, setTerm] = useState(defaultTerm);
  const [country, setCountry] = useState("");
  const [candidates, setCandidates] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [searchError, setSearchError] = useState("");

  const load = useCallback(() => {
    (window as any).appilot?.competitors?.list(projectId).then(setCompetitors).catch(() => setCompetitors([]));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  // Follow the current view language: search in that language's storefronts.
  const countryOptions = viewLang ? storefrontsForLanguage(viewLang) : ["us"];
  useEffect(() => {
    const options = viewLang ? storefrontsForLanguage(viewLang) : ["us"];
    setCountry((current) => (options.includes(current) ? current : options[0] || "us"));
  }, [viewLang]);

  // Keep the search box in sync with the keyword selected in the matrix.
  useEffect(() => {
    setTerm(defaultTerm);
  }, [defaultTerm]);

  // A changed search context (language / storefront / keyword) invalidates
  // the previous results.
  useEffect(() => {
    setCandidates([]);
    setSearchError("");
  }, [viewLang, country, defaultTerm]);

  const handleSearch = async () => {
    if (!term.trim()) return;
    setSearching(true);
    setSearchError("");
    setCandidates([]);
    try {
      const results = await (window as any).appilot?.competitors?.search({
        term: term.trim(),
        country,
        platform: product?.platform,
      });
      setCandidates(results || []);
    } catch (err: any) {
      setSearchError(err?.message || "搜索失败，请稍后重试。");
    } finally {
      setSearching(false);
    }
  };

  const handleAdd = async (candidate: any) => {
    setAdding(candidate.trackId);
    try {
      await (window as any).appilot?.competitors?.save(projectId, {
        name: candidate.trackName,
        trackId: candidate.trackId,
        platform: product?.platform || "unknown",
        githubUrl: null,
        notes: "",
      });
      load();
    } finally {
      setAdding(null);
    }
  };

  const handleRemove = async (competitorId: string) => {
    await (window as any).appilot?.competitors?.remove(projectId, competitorId);
    load();
  };

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">竞品雷达</h3>
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">手动添加 + 从关键词搜索候选一键加入，每日自动快照</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="搜索竞品（默认当前关键词）"
          className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm px-2.5 py-1.5 w-56"
        />
        <select value={country} onChange={(e) => setCountry(e.target.value)} className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm px-2.5 py-1.5">
          {countryOptions.map((c) => <option key={c} value={c}>{storefrontDisplayName(c) || c}</option>)}
        </select>
        <button type="button" onClick={() => void handleSearch()} disabled={searching} className={btnPrimary}>
          {searching ? "搜索中…" : "搜索候选"}
        </button>
      </div>

      {searchError && (
        <p className="mb-4 text-xs text-red-600 dark:text-red-400">{searchError}</p>
      )}

      {candidates.length > 0 && (
        <div className="mb-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {candidates.slice(0, 10).map((candidate) => (
              <div key={candidate.trackId} className="flex items-center justify-between gap-2 px-4 py-2.5">
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      if (candidate.trackViewUrl) (window as any).appilot?.openExternal(candidate.trackViewUrl);
                    }}
                    disabled={!candidate.trackViewUrl}
                    className={cn(
                      "text-sm truncate text-left max-w-full",
                      candidate.trackViewUrl
                        ? "text-zinc-800 dark:text-zinc-200 hover:text-amber-600 dark:hover:text-amber-400 hover:underline"
                        : "text-zinc-800 dark:text-zinc-200 cursor-default",
                    )}
                    title={candidate.trackViewUrl ? "打开 App Store 页面" : "无商店链接"}
                  >
                    {candidate.trackName}
                  </button>
                  <div className="text-[11px] text-zinc-400 dark:text-zinc-500">
                    {candidate.genre || "未知分类"}{candidate.averageUserRating ? ` · ★${candidate.averageUserRating}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleAdd(candidate)}
                  disabled={adding === candidate.trackId}
                  className={btnSmPrimary}
                >
                  {adding === candidate.trackId ? "添加中…" : "添加"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {competitors.length === 0 ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">尚未添加竞品。</p>
      ) : (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {competitors.map((competitor) => (
              <div key={competitor.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      if (competitor.trackId) {
                        (window as any).appilot?.openExternal(`https://apps.apple.com/app/id${competitor.trackId}`);
                      }
                    }}
                    disabled={!competitor.trackId}
                    className={cn(
                      "text-sm truncate text-left max-w-full",
                      competitor.trackId
                        ? "text-zinc-800 dark:text-zinc-200 hover:text-amber-600 dark:hover:text-amber-400 hover:underline"
                        : "text-zinc-800 dark:text-zinc-200 cursor-default",
                    )}
                    title={competitor.trackId ? "打开 App Store 页面" : "无商店链接"}
                  >
                    {competitor.name}
                  </button>
                  <div className="text-[11px] text-zinc-400 dark:text-zinc-500">
                    {competitor.trackId ? `trackId ${competitor.trackId}` : "无商店链接"}
                    {competitor.githubUrl ? ` · ${competitor.githubUrl}` : ""}
                    {competitor.addedAt ? ` · 加入于 ${formatHumanTime(competitor.addedAt)}` : ""}
                  </div>
                </div>
                <button type="button" onClick={() => void handleRemove(competitor.id)} className={btnSmSecondary}>
                  移除
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
