import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { formatHumanTime } from "../../lib/format";
import { CredentialBadge } from "../ui/CredentialBadge";

export function TrafficCard({ project }: { project: any }) {
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);
  const load = () => {
    (window as any).appilot?.traffic?.snapshots(project.id)
      .then(setSnapshots)
      .catch(() => setSnapshots([]));
  };
  useEffect(() => {
    load();
  }, [project.id]);

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await (window as any).appilot?.traffic?.sync(project.id);
      load();
    } finally {
      setSyncing(false);
    }
  };

  const recent14 = useMemo(() => snapshots.slice(-14), [snapshots]);
  const totalViews = recent14.reduce((sum, item) => sum + (item.views || 0), 0);
  const totalClones = recent14.reduce((sum, item) => sum + (item.clones || 0), 0);
  const totalDownloads = recent14.reduce(
    (sum, item) => sum + (item.assetDownloads || []).reduce((s: number, a: any) => s + (a.downloadCount || 0), 0),
    0,
  );
  const chart = recent14.map((item) => ({ date: item.date, views: item.views || 0 }));

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">GitHub 流量</h3>
        <CredentialBadge kind="github" enabled={Boolean(project.hasGithubToken)} projectId={project.id} />
      </div>
      {snapshots.length === 0 ? (
        project.hasGithubToken ? (
          <div className="px-4 py-6 text-center text-xs text-zinc-400 dark:text-zinc-500">
            {project.trafficError || "暂无流量数据，等待每日同步"}
            <button
              type="button"
              onClick={() => void handleSync()}
              disabled={syncing}
              className="block mx-auto mt-1 text-amber-600 dark:text-amber-400 hover:underline"
            >
              {syncing ? "同步中…" : "立即同步"}
            </button>
            {project.trafficError?.includes("Metrics") && (
              <span className="block mt-2 text-[10px] text-zinc-500 dark:text-zinc-400">
                需要在 GitHub Token 权限中勾选「Metrics」只读权限。
              </span>
            )}
          </div>
        ) : (
          <div className="px-4 py-6 text-center text-xs text-zinc-400 dark:text-zinc-500">
            暂无流量数据
            <Link to={`/projects/${project.id}/settings`} className="block mt-1 text-amber-600 dark:text-amber-400">配置 GitHub Token</Link>
          </div>
        )
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 px-4 pt-3">
            <div><div className="text-[10px] text-zinc-400 dark:text-zinc-500">14 天访问</div><div className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{totalViews}</div></div>
            <div><div className="text-[10px] text-zinc-400 dark:text-zinc-500">14 天克隆</div><div className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{totalClones}</div></div>
            <div><div className="text-[10px] text-zinc-400 dark:text-zinc-500">资产下载</div><div className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{totalDownloads}</div></div>
          </div>
          <div className="px-2 pb-2">
            <ResponsiveContainer width="100%" height={72}>
              <AreaChart data={chart} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="trafficViews" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" hide />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 12 }} />
                <Area type="monotone" dataKey="views" stroke="#0ea5e9" strokeWidth={1.5} fill="url(#trafficViews)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="px-4 pb-3 text-[10px] text-zinc-400 dark:text-zinc-500">
            数据截至 {formatHumanTime(recent14[recent14.length - 1]?.date)}
          </p>
        </>
      )}
    </div>
  );
}
