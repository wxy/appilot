import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { storefrontDisplayName } from "../../../engine/storefronts";
import { formatHumanTime, platformLabel } from "../../lib/format";

export function CompetitorRadarCard({ project }: { project: any }) {
  const [competitors, setCompetitors] = useState<any[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, any[]>>({});
  const [rankSnapshots, setRankSnapshots] = useState<Record<string, any[]>>({});

  useEffect(() => {
    let cancelled = false;
    (window as any).appilot?.competitors?.list(project.id)
      .then((list: any[]) => {
        if (cancelled) return;
        setCompetitors(list);
        return Promise.all(
          list.map(async (competitor) => {
            const items = await (window as any).appilot?.competitors?.snapshots(project.id, competitor.id);
            const ranks = await (window as any).appilot?.competitors?.rankSnapshots(project.id, competitor.id);
            return [competitor.id, items || [], ranks || []] as const;
          }),
        );
      })
      .then((entries: any) => {
        if (cancelled || !entries) return;
        setSnapshots(Object.fromEntries(entries.map((e: any) => [e[0], e[1]])));
        setRankSnapshots(Object.fromEntries(entries.map((e: any) => [e[0], e[2]])));
      })
      .catch(() => {
        if (!cancelled) {
          setCompetitors([]);
          setSnapshots({});
          setRankSnapshots({});
        }
      });
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
            // 快照按平台分别采集：取最近更新的平台做版本/星级对比，
            // 避免把 iOS 与 macOS 两个列表的版本变化混在一起。
            const byPlatform: Record<string, any[]> = {};
            for (const item of items) {
              const key = item.platform || "unknown";
              (byPlatform[key] = byPlatform[key] || []).push(item);
            }
            const latestPlatformKey = Object.keys(byPlatform).sort(
              (a, b) =>
                new Date(byPlatform[b][0].date).getTime() -
                new Date(byPlatform[a][0].date).getTime(),
            )[0];
            const platformItems = latestPlatformKey
              ? byPlatform[latestPlatformKey]
              : [];
            const latest = platformItems[0] || null;
            const previous =
              platformItems.find((item: any) => item.date !== latest?.date) ||
              platformItems[1] ||
              null;
            const versionChanged = latest?.version && previous?.version && latest.version !== previous.version;
            const starsDelta = latest?.stars != null && previous?.stars != null ? latest.stars - previous.stars : null;
            const ranks = rankSnapshots[competitor.id] || [];
            const latestRanks = Array.from(
              new Map(
                ranks.map(
                  (r: any) =>
                    [`${r.keyword}\u0000${r.storefront}\u0000${r.platform || "?"}`, r] as const,
                ),
              ).values(),
            )
              .sort((a: any, b: any) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime())
              .slice(0, 2);
            return (
              <div key={competitor.id} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">{competitor.name}</span>
                  {latest?.releaseDate && (
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-500 shrink-0">
                      {latest.platform ? `${platformLabel(latest.platform)} · ` : ""}
                      {latest.country ? `${storefrontDisplayName(latest.country)} · ` : ""}
                      {formatHumanTime(latest.releaseDate)} 发版
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                  {latest?.version ? `v${latest.version}` : "版本未知"}
                  {versionChanged ? " · 本周有新版" : ""}
                  {starsDelta != null && starsDelta !== 0 ? ` · ★${starsDelta > 0 ? "+" : ""}${starsDelta}` : ""}
                  {latest?.stars != null ? ` · ★${latest.stars}` : ""}
                </div>
                {latestRanks.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5">
                    {latestRanks.map((rank: any, index: number) => (
                      <span
                        key={`${rank.keyword}:${rank.storefront}:${index}`}
                        className="text-[10px] text-zinc-400 dark:text-zinc-500"
                      >
                        {rank.keyword} · {rank.platform ? `${platformLabel(rank.platform)} · ` : ""}
                        {storefrontDisplayName(rank.storefront)} #
                        {rank.rank ?? "未上榜"}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
