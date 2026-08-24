import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useProject } from "../../stores/project";
import { buildTrendSeries } from "../../lib/trend-series";
import { formatHumanTime } from "../../lib/format";
import { cn } from "../../lib/utils";
import { CredentialBadge } from "../ui/CredentialBadge";
import { EmptyState } from "../ui/EmptyState";
import { btnSmSecondary } from "../ui/styles";

const RANGES = [7, 14, 30, 90];

export function TrendPage() {
  const { projects, currentProjectId, currentProductId } = useProject();
  const project = projects.find((p) => p.id === currentProjectId);
  const product = project?.storeProducts?.find((item) => item.id === currentProductId) || project?.storeProducts?.[0] || null;
  const [traffic, setTraffic] = useState<any[]>([]);
  const [releases, setReleases] = useState<{ tag: string; publishedAt: string | null }[]>([]);
  const [rangeDays, setRangeDays] = useState(30);

  const load = useCallback(() => {
    if (!project || !product) return;
    (window as any).appilot?.traffic?.snapshots(project.id).then(setTraffic).catch(() => setTraffic([]));
    (window as any).appilot?.release?.list(project.id)
      .then((result: any) => {
        const tags = (result?.releases || [])
          .map((release: any) => ({ tag: release.tag || "", publishedAt: release.publishedAt || null }))
          .filter((release: any) => release.tag);
        setReleases(tags);
      })
      .catch(() => setReleases([]));
  }, [project?.id, product?.id]);

  useEffect(() => { load(); }, [load]);

  if (!project || !product) {
    return <EmptyState title="还没有项目" desc="添加一个项目后，这里会展示长期效果。" />;
  }

  const series = buildTrendSeries({
    trafficSnapshots: traffic,
    rankSnapshots: product.rankSnapshots || [],
    releases,
    rangeDays,
  });
  const hasTraffic = series.some((point) => point.views > 0);
  const hasRank = series.some((point) => point.bestRank != null);
  const releaseDays = series.filter((point) => point.releaseTags.length > 0);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">长期效果</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
            GitHub 仓库流量、release 资产下载与商店排名的组合时间线。
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <CredentialBadge kind="github" enabled={Boolean(project.hasGithubToken)} projectId={project.id} />
          <CredentialBadge kind="asc" enabled={Boolean(project.hasAscKey)} projectId={project.id} />
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
        <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">增长时间线</h3>
          <div className="flex items-center rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
            {RANGES.map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setRangeDays(days)}
                className={cn(
                  "px-2 py-0.5 text-[11px] font-medium transition-colors",
                  rangeDays === days
                    ? "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400"
                    : "bg-white dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800",
                )}
              >
                {days}天
              </button>
            ))}
          </div>
        </div>
        {!hasTraffic && !hasRank ? (
          <div className="h-64 flex flex-col items-center justify-center gap-3">
            <p className="text-sm text-zinc-400 dark:text-zinc-500">
              暂无数据。GitHub 流量需要配置 Token 并等待每日同步；排名数据来自关键词采集。
            </p>
            <Link to={`/projects/${project.id}/settings`} className={btnSmSecondary}>
              去配置凭据
            </Link>
          </div>
        ) : (
          <div className="p-3">
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={series} margin={{ top: 8, right: 16, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#a1a1aa" }} tickLine={false} axisLine={false} minTickGap={28} />
                <YAxis yAxisId="count" tick={{ fontSize: 10, fill: "#a1a1aa" }} tickLine={false} axisLine={false} />
                {hasRank && (
                  <YAxis yAxisId="rank" orientation="right" reversed tick={{ fontSize: 10, fill: "#a1a1aa" }} tickLine={false} axisLine={false} />
                )}
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 12 }} />
                <Line yAxisId="count" type="monotone" dataKey="views" name="访问量" stroke="#0ea5e9" strokeWidth={1.5} dot={false} />
                <Line yAxisId="count" type="monotone" dataKey="clones" name="克隆量" stroke="#71717a" strokeWidth={1.5} dot={false} />
                <Line yAxisId="count" type="monotone" dataKey="assetDownloads" name="资产下载" stroke="#10b981" strokeWidth={1.5} dot={false} />
                {hasRank && (
                  <Line yAxisId="rank" type="monotone" dataKey="bestRank" name="最佳排名" stroke="#f59e0b" strokeWidth={1.5} dot={false} />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {releaseDays.length > 0 && (
          <div className="px-5 py-3 border-t border-zinc-100 dark:border-zinc-800">
            <div className="text-[11px] text-zinc-400 dark:text-zinc-500 mb-2">发布事件</div>
            <div className="flex flex-wrap gap-1.5">
              {releaseDays.map((day) => (
                <span key={day.date} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[11px] text-zinc-600 dark:text-zinc-300">
                  {day.date} · {day.releaseTags.join(", ")}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      {traffic.length > 0 && (
        <p className="mt-3 text-[11px] text-zinc-400 dark:text-zinc-500">
          数据截至 {formatHumanTime(traffic[traffic.length - 1]?.date)}。GitHub Traffic 仅保留 14 天窗口，从接入日起每日快照。
        </p>
      )}
    </div>
  );
}
