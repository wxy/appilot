import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatHumanTime } from "../../lib/format";

export function CompetitorRadarCard({ project }: { project: any }) {
  const [competitors, setCompetitors] = useState<any[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, any[]>>({});

  useEffect(() => {
    let cancelled = false;
    (window as any).appilot?.competitors?.list(project.id)
      .then((list: any[]) => {
        if (cancelled) return;
        setCompetitors(list);
        return Promise.all(
          list.map(async (competitor) => {
            const items = await (window as any).appilot?.competitors?.snapshots(project.id, competitor.id);
            return [competitor.id, items || []] as const;
          }),
        );
      })
      .then((entries: any) => {
        if (cancelled || !entries) return;
        setSnapshots(Object.fromEntries(entries));
      })
      .catch(() => { if (!cancelled) { setCompetitors([]); setSnapshots({}); } });
    return () => { cancelled = true; };
  }, [project.id]);

  const top3 = competitors.slice(0, 3);
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">竞品雷达</h3>
        <Link to="/keywords?competitors=1" className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline">
          管理
        </Link>
      </div>
      {top3.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-zinc-400 dark:text-zinc-500">
          尚未添加竞品
          <Link to="/keywords?competitors=1" className="block mt-1 text-amber-600 dark:text-amber-400">去排名页添加</Link>
        </div>
      ) : (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {top3.map((competitor) => {
            const items = snapshots[competitor.id] || [];
            const latest = items[items.length - 1] || null;
            const previous = items[items.length - 2] || null;
            const versionChanged = latest?.version && previous?.version && latest.version !== previous.version;
            const starsDelta = latest?.stars != null && previous?.stars != null ? latest.stars - previous.stars : null;
            return (
              <div key={competitor.id} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">{competitor.name}</span>
                  {latest?.releaseDate && (
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-500 shrink-0">{formatHumanTime(latest.releaseDate)} 发版</span>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                  {latest?.version ? `v${latest.version}` : "版本未知"}
                  {versionChanged ? " · 本周有新版" : ""}
                  {starsDelta != null && starsDelta !== 0 ? ` · ★${starsDelta > 0 ? "+" : ""}${starsDelta}` : ""}
                  {latest?.stars != null ? ` · ★${latest.stars}` : ""}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
