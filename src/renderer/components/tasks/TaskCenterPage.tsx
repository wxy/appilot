import { useEffect, useState } from "react";
import { storefrontDisplayName } from "../../../engine/storefronts";
import {
  formatBytes,
  formatDuration,
  formatDurationMs,
  formatHumanTime,
  languageLabel,
  platformLabel,
} from "../../lib/format";
import { cn } from "../../lib/utils";
import { inputLineClass } from "../ui/styles";

export function TaskCenterPage() {
  const [data, setData] = useState<{
    running: boolean;
    nowRunning: any;
    overview: any;
    timeline: {
      recent: { hour: number; success: number; failed: number }[];
      upcoming: { hour: number; count: number }[];
    };
    tasks: any[];
  } | null>(null);
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [languageFilter, setLanguageFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      (window as any).appilot?.scheduler?.list()
        .then((next: any) => {
          if (!cancelled) setData(next);
        })
        .catch(() => {
          if (!cancelled) setData(null);
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const projectOptions = Array.from(
    new Set(
      (data?.tasks || [])
        .map((task: any) => task.projectName)
        .filter((name: string) => name && name !== "已删除项目"),
    ),
  ).sort();
  const platformOptions = Array.from(
    new Set((data?.tasks || []).map((task: any) => task.platform).filter(Boolean)),
  ).sort();
  const languageOptions = Array.from(
    new Set(
      (data?.tasks || [])
        .map((task: any) => task.queryLanguage)
        .filter((lang: string) => Boolean(lang)),
    ),
  ).sort();
  const tasks = (data?.tasks || [])
    .filter((task) => projectFilter === "all" || task.projectName === projectFilter)
    .filter((task) => platformFilter === "all" || task.platform === platformFilter)
    .filter((task) => languageFilter === "all" || task.queryLanguage === languageFilter)
    .filter((task) => typeFilter === "all" || task.kind === typeFilter);
  const pending = tasks.filter((task) => task.enabled);
  const failed = tasks.filter((task) => task.lastStatus === "failed");

  const pendingGroups = groupTasks(pending);
  const failedGroups = groupTasks(failed);
  const overview = data?.overview;
  const nowRunning = data?.nowRunning;
  const timeline = data?.timeline;

  return (
    <div className="p-10 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">任务中心</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
            后台采集与 GitHub 同步的调度健康度、执行负载与时间线。
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {nowRunning && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              正在执行{" "}
              {nowRunning.kind === "github-sync" ? "GitHub 同步" : nowRunning.keyword}
            </span>
          )}
          <span
            className={cn(
              "px-2.5 py-1 rounded-full text-xs font-medium",
              data?.running
                ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400",
            )}
          >
            {data?.running ? "调度器运行中" : "调度器未运行"}
          </span>
        </div>
      </div>

      {data === null && (
        <div className="mb-6 flex items-center gap-2 text-sm text-zinc-400 dark:text-zinc-500">
          <span className="w-4 h-4 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-transparent animate-spin" />
          正在载入任务中心…
        </div>
      )}

      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard
            label="任务总数"
            value={String(overview.total)}
            sub={`待执行 ${overview.pending} · 积压 ${overview.overdue}`}
          />
          <StatCard
            label="已执行"
            value={String(overview.executedToday)}
            sub={`今日 · 累计 ${overview.totalExecuted}`}
          />
          <StatCard
            label="执行密度"
            value={String(overview.densityPerHour)}
            sub="次/小时（近24h，含未运行时段）"
          />
          <StatCard
            label="平均耗时"
            value={formatDuration(overview.avgDurationMs)}
            sub="近24h"
          />
          <StatCard
            label="成功率"
            value={overview.successRate == null ? "—" : `${overview.successRate}%`}
            sub="近24h"
          />
          <StatCard
            label="入榜率"
            value={overview.hitRate == null ? "—" : `${overview.hitRate}%`}
            sub="成功采集中找到排名"
          />
          <StatCard
            label="流量"
            value={`${formatBytes(overview.requestBytes)} / ${formatBytes(overview.responseBytes)}`}
            sub="请求 / 响应（近24h）"
          />
          <StatCard
            label="下次执行"
            value={
              overview.overdue > 0
                ? `待执行 ×${overview.overdue}`
                : overview.nextDueAt
                  ? formatHumanTime(overview.nextDueAt)
                  : "—"
            }
            sub="最近的计划任务"
          />
        </div>
      )}

      <TaskTimelineChart timeline={timeline} />

      <div className="mt-6 mb-6 flex flex-wrap gap-2">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className={inputLineClass + " max-w-36"}
        >
          <option value="all">全部类型</option>
          <option value="rank">排名</option>
          <option value="github-sync">GitHub 同步</option>
        </select>
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className={inputLineClass + " max-w-44"}
        >
          <option value="all">全部项目</option>
          {projectOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value)}
          className={inputLineClass + " max-w-32"}
        >
          <option value="all">全部平台</option>
          {platformOptions.map((platform) => (
            <option key={platform} value={platform}>
              {platformLabel(platform)}
            </option>
          ))}
        </select>
        <select
          value={languageFilter}
          onChange={(e) => setLanguageFilter(e.target.value)}
          className={inputLineClass + " max-w-36"}
        >
          <option value="all">全部语言</option>
          {languageOptions.map((lang) => (
            <option key={lang} value={lang}>
              {languageLabel(lang) || lang}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-6">
        <TaskSection title={`准备进行（${pendingGroups.length} 组）`} groups={pendingGroups} />
        <TaskSection title={`失败（${failedGroups.length} 组）`} groups={failedGroups} />
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 shadow-sm">
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100 leading-tight">
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">{sub}</div>}
    </div>
  );
}

function niceStep(target: number): number {
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  for (const step of steps) {
    if (target <= step) return step;
  }
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  const base = target / pow;
  const multiplier = base <= 1 ? 1 : base <= 2 ? 2 : base <= 5 ? 5 : 10;
  return multiplier * pow;
}

function TaskTimelineChart({
  timeline,
}: {
  timeline?: {
    recent: { hour: number; success: number; failed: number }[];
    upcoming: { hour: number; count: number }[];
  };
}) {
  const [hovered, setHovered] = useState<{
    index: number;
    title: string;
    lines: [string, string][];
  } | null>(null);
  const recent = timeline?.recent ?? [];
  const upcoming = timeline?.upcoming ?? [];
  // One continuous timeline. The current hour appears in BOTH the recent
  // (executed) and upcoming (planned) arrays, so merge it into a single
  // stacked bucket: 23 past + 1 current + 23 future = 47 bars.
  const buckets: { hour: number; planned: number; success: number; failed: number }[] = [];
  for (let index = 0; index < 23; index++) {
    const r = recent[index] || { hour: 0, success: 0, failed: 0 };
    buckets.push({ hour: r.hour, planned: 0, success: r.success, failed: r.failed });
  }
  const currentR = recent[23] || { hour: 0, success: 0, failed: 0 };
  const currentU = upcoming[0] || { hour: 0, count: 0 };
  buckets.push({
    hour: currentR.hour || currentU.hour,
    planned: currentU.count,
    success: currentR.success,
    failed: currentR.failed,
  });
  for (let index = 1; index < 24; index++) {
    const u = upcoming[index] || { hour: 0, count: 0 };
    buckets.push({ hour: u.hour, planned: u.count, success: 0, failed: 0 });
  }
  const W = 780;
  const H = 200;
  const padL = 36;
  const padR = 10;
  const padT = 26;
  const padB = 30;
  const chartW = W - padL - padR;
  const currentIndex = 23;
  const barW = chartW / buckets.length;
  const plotH = H - padT - padB;
  const maxV = Math.max(
    1,
    ...buckets.map((b) => b.planned + b.success + b.failed),
  );
  const step = niceStep(Math.max(1, Math.ceil(maxV / 4)));
  // Top tick is the next multiple of step (never smaller than maxV), so the
  // axis stays evenly spaced and the last label cannot collide with the
  // previous one (e.g. maxV=5, step=2 → ticks 0,2,4,6 instead of 0,2,4,5).
  const topTick = Math.max(step, Math.ceil(maxV / step) * step);
  const yTicks: number[] = [];
  for (let value = 0; value <= topTick; value += step) yTicks.push(value);
  const nowX = padL + (currentIndex + 0.5) * barW;
  const y = (v: number) => padT + plotH - (v / topTick) * plotH;
  const hourLabel = (ts: number) =>
    `${String(new Date(ts).getHours()).padStart(2, "0")}:00`;
  // The far-right +23h tick crowds the +24h end label; -23h already marks the
  // symmetric left edge, so the last future tick is dropped.
  const xTickIndexes = [0, 6, 12, 18, 23, 29, 35, 41];
  const relLabel = (i: number) =>
    i === 23 ? "现在" : `${i < 23 ? "-" : "+"}${Math.abs(i - 23)}h`;

  const hoverInfo = (index: number): { title: string; lines: [string, string][] } => {
    const b = buckets[index] || { hour: 0, planned: 0, success: 0, failed: 0 };
    const lines: [string, string][] = [];
    if (b.planned > 0) lines.push(["计划任务", `${b.planned} 个`]);
    if (b.success > 0) lines.push(["成功", `${b.success} 次`]);
    if (b.failed > 0) lines.push(["失败", `${b.failed} 次`]);
    if (lines.length === 0) lines.push(["本时段", "无活动"]);
    return {
      title: hourLabel(b.hour),
      lines,
    };
  };

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
      <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">执行时间线</h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
          每小时计划任务与实际执行叠加（悬停查看详情）
        </p>
      </div>
      <div className="px-6 py-4 relative">
        {hovered && (
          <div
            className="absolute z-10 -translate-x-1/2 pointer-events-none rounded-lg bg-zinc-900/95 dark:bg-zinc-800/95 text-white px-2.5 py-1.5 shadow-lg"
            style={{
              left: `${((padL + (hovered.index + 0.5) * barW) / W) * 100}%`,
              top: 8,
            }}
          >
            <div className="text-[11px] font-semibold">{hovered.title}</div>
            {hovered.lines.map(([label, value]) => (
              <div key={label} className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-300">
                <span>{label}</span>
                <span className="font-mono text-white">{value}</span>
              </div>
            ))}
          </div>
        )}
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={padL}
                y1={y(tick)}
                x2={W - padR}
                y2={y(tick)}
                stroke="currentColor"
                className="text-zinc-100 dark:text-zinc-800"
                strokeWidth="1"
              />
              <text x={padL - 6} y={y(tick) + 3} textAnchor="end" fontSize="10" className="fill-zinc-400">
                {tick}
              </text>
            </g>
          ))}
          <line
            x1={padL}
            y1={padT + plotH}
            x2={W - padR}
            y2={padT + plotH}
            stroke="currentColor"
            className="text-zinc-300 dark:text-zinc-700"
            strokeWidth="1"
          />
          {buckets.map((b, i) => {
            const x = padL + i * barW;
            const plannedH = (b.planned / maxV) * plotH;
            const successH = (b.success / maxV) * plotH;
            const failedH = (b.failed / maxV) * plotH;
            return (
              <g key={`b-${i}`}>
                {b.planned > 0 && (
                  <rect
                    x={x}
                    y={padT + plotH - plannedH}
                    width={barW - 1}
                    height={plannedH}
                    fill="#f59e0b"
                    opacity="0.55"
                    rx="1"
                  />
                )}
                {b.success > 0 && (
                  <rect
                    x={x}
                    y={padT + plotH - plannedH - successH}
                    width={barW - 1}
                    height={successH}
                    fill="#10b981"
                    rx="1"
                  />
                )}
                {b.failed > 0 && (
                  <rect
                    x={x}
                    y={padT + plotH - plannedH - successH - failedH}
                    width={barW - 1}
                    height={failedH}
                    fill="#ef4444"
                    rx="1"
                  />
                )}
              </g>
            );
          })}
          {hovered && (
            <line
              x1={padL + (hovered.index + 0.5) * barW}
              y1={padT}
              x2={padL + (hovered.index + 0.5) * barW}
              y2={padT + plotH}
              stroke="#a1a1aa"
              strokeWidth="1"
              strokeDasharray="2 2"
            />
          )}
          <line
            x1={nowX}
            y1={padT - 4}
            x2={nowX}
            y2={padT + plotH}
            stroke="#f59e0b"
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />
          {xTickIndexes.map((i) => (
            <text
              key={i}
              x={padL + (i + 0.5) * barW}
              y={H - 10}
              textAnchor="middle"
              fontSize="10"
              className={i === 24 ? "fill-amber-500 font-medium" : "fill-zinc-400"}
            >
              {relLabel(i)}
            </text>
          ))}
          <text x={W - padR} y={H - 10} textAnchor="end" fontSize="10" className="fill-zinc-400">
            +24h
          </text>
          {Array.from({ length: buckets.length }, (_, i) => (
            <rect
              key={`o-${i}`}
              x={padL + i * barW}
              y={padT}
              width={barW}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHovered({ index: i, ...hoverInfo(i) })}
              onMouseLeave={() => setHovered(null)}
            />
          ))}
        </svg>
        <div className="mt-3 flex items-center gap-4 text-[11px] text-zinc-500 dark:text-zinc-400">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />成功
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-red-500" />失败
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 opacity-55" />计划任务
          </span>
        </div>
      </div>
    </div>
  );
}

function groupTasks(tasks: any[]): any[] {
  const map = new Map<string, any>();
  for (const task of tasks) {
    const isSync = task.kind === "github-sync";
    const key = isSync
      ? `sync\u0000${task.projectName}`
      : `${task.projectName}\u0000${task.platform}\u0000${task.queryLanguage || ""}\u0000${task.storefront || ""}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        key,
        kind: isSync ? "github-sync" : "rank",
        projectName: task.projectName,
        productName: task.productName,
        platform: task.platform,
        queryLanguage: task.queryLanguage,
        storefront: task.storefront,
        tasks: [task],
        lastRunAt: task.lastRunAt,
        nextRunAt: task.nextRunAt,
        firstRunAt: task.firstRunAt,
        executionCount: task.executionCount || 0,
        lastDurationMs: task.lastDurationMs,
      });
    } else {
      existing.tasks.push(task);
      if (task.lastRunAt && (!existing.lastRunAt || new Date(task.lastRunAt) > new Date(existing.lastRunAt))) {
        existing.lastRunAt = task.lastRunAt;
        existing.lastDurationMs = task.lastDurationMs;
      }
      if (new Date(task.nextRunAt) < new Date(existing.nextRunAt)) {
        existing.nextRunAt = task.nextRunAt;
      }
      existing.executionCount += task.executionCount || 0;
      if (task.firstRunAt && (!existing.firstRunAt || new Date(task.firstRunAt) < new Date(existing.firstRunAt))) {
        existing.firstRunAt = task.firstRunAt;
      }
    }
  }
  return [...map.values()];
}

function TaskSection({ title, groups }: { title: string; groups: any[] }) {
  const [page, setPage] = useState(0);
  const pageSize = 20;
  useEffect(() => {
    setPage(0);
  }, [title, groups.length]);
  if (groups.length === 0) return null;
  const totalPages = Math.max(1, Math.ceil(groups.length / pageSize));
  const visible = groups.slice(page * pageSize, page * pageSize + pageSize);

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
      <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
      </div>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {visible.map((group) => (
          <div
            key={group.key}
            className="grid grid-cols-[minmax(0,1fr)_repeat(4,minmax(0,8.5rem))] items-center gap-4 px-5 py-3"
          >
            <div className="flex items-start gap-2 min-w-0">
              <span
                className={cn(
                  "mt-0.5 px-2 py-0.5 rounded text-[10px] font-medium shrink-0",
                  group.kind === "github-sync"
                    ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
                    : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
                )}
              >
                {group.kind === "github-sync" ? "GitHub 同步" : "排名"}
              </span>
              <div className="min-w-0">
                <div className="text-sm text-zinc-800 dark:text-zinc-200 truncate">
                  {group.kind === "github-sync"
                    ? `${group.projectName} · GitHub 同步`
                    : `${group.projectName} · ${
                        group.platform === "ios"
                          ? "iOS"
                          : group.platform === "macos"
                            ? "macOS"
                            : "未识别"
                      } · ${languageLabel(group.queryLanguage || "")} · ${
                        storefrontDisplayName(group.storefront || "")
                      } · ${group.tasks.length} 个关键词`}
                </div>
              </div>
            </div>
            <TaskMeta
              label="首次执行"
              value={group.firstRunAt ? formatHumanTime(group.firstRunAt) : "—"}
            />
            <TaskMeta
              label="执行时间"
              value={formatDurationMs(group.lastDurationMs)}
            />
            <TaskMeta
              label="上次执行"
              value={group.lastRunAt ? formatHumanTime(group.lastRunAt) : "尚未执行"}
            />
            <TaskMeta label="下次执行" value={formatHumanTime(group.nextRunAt)} />
          </div>
        ))}
      </div>
      {totalPages > 1 && (
        <div className="px-6 py-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between text-xs text-zinc-400 dark:text-zinc-500">
          <span>
            {page + 1} / {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(0)}
              disabled={page === 0}
              className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 disabled:opacity-40"
            >
              第一页
            </button>
            <button
              onClick={() => setPage((value) => Math.max(0, value - 1))}
              disabled={page === 0}
              className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 disabled:opacity-40"
            >
              上一页
            </button>
            <button
              onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}
              disabled={page >= totalPages - 1}
              className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 disabled:opacity-40"
            >
              下一页
            </button>
            <button
              onClick={() => setPage(totalPages - 1)}
              disabled={page >= totalPages - 1}
              className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 disabled:opacity-40"
            >
              最后一页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TaskMeta({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 text-right", className)}>
      <div className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate">{label}</div>
      <div className="text-xs text-zinc-600 dark:text-zinc-300 truncate">{value}</div>
    </div>
  );
}
