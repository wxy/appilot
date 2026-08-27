import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { storefrontDisplayName } from "../../../engine/storefronts";
import { useProject } from "../../stores/project";
import { taskGroupKey } from "../../lib/task-grouping";
import {
  formatBytes,
  formatDuration,
  formatHumanTime,
  languageLabel,
  platformLabel,
} from "../../lib/format";
import { cn } from "../../lib/utils";
import { GithubIcon } from "../ui/Icons";
import { inputLineClass } from "../ui/styles";
import { ValueFlash } from "../ui/ValueFlash";

const KIND_LABELS: Record<string, string> = {
  "github-sync": "GitHub 同步",
  "ops-sync": "数据同步",
  "reviews-sync": "评论采集",
  "build-status": "构建状态",
  rank: "排名",
};

export function TaskCenterPage() {
  const navigate = useNavigate();
  const { select, selectProduct } = useProject();
  const [data, setData] = useState<{
    running: boolean;
    nowRunning: any;
    overview: any;
    tasks: any[];
  } | null>(null);
  const [timeline, setTimeline] = useState<{
    recent: { hour: number; success: number; failed: number }[];
    upcoming: { hour: number; count: number }[];
  } | undefined>(undefined);
  const [accel, setAccel] = useState(false);
  const [accelRemainingMs, setAccelRemainingMs] = useState<number | null>(null);
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [languageFilter, setLanguageFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  // 任务行点击跳转到对应页面：排名 → 关键词矩阵；GitHub/构建状态 → 发布
  // 工作台；评论 → 评论页；数据同步 → 总览。没有合适目标的类型不加链接。
  const openTaskTarget = (group: any) => {
    const task = group?.tasks?.[0];
    if (!task) return;
    if (group.kind === "rank" && task.productId && task.projectId) {
      select(task.projectId);
      selectProduct(task.productId);
      navigate(
        `/keywords?lang=${encodeURIComponent(task.queryLanguage || "en")}`,
      );
    } else if (
      (group.kind === "github-sync" || group.kind === "build-status") &&
      task.projectId
    ) {
      select(task.projectId);
      if (task.productId) selectProduct(task.productId);
      navigate("/release");
    } else if (group.kind === "reviews-sync" && task.productId) {
      select(task.projectId);
      selectProduct(task.productId);
      navigate("/reviews");
    } else if (group.kind === "ops-sync" && task.projectId) {
      select(task.projectId);
      navigate("/overview");
    }
  };

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
    const refreshTimeline = () => {
      (window as any).appilot?.scheduler?.timeline()
        .then((next: any) => {
          if (!cancelled) setTimeline(next);
        })
        .catch(() => undefined);
    };
    refresh();
    refreshTimeline();
    // 加速模式下刷新更频繁（5 秒），正常 15 秒。
    const timer = window.setInterval(refresh, accel ? 5_000 : 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [accel]);

  // 读取当前加速模式状态。
  useEffect(() => {
    (window as any).appilot?.scheduler?.status()
      .then((status: any) => {
        setAccel(Boolean(status?.accel));
        setAccelRemainingMs(
          typeof status?.accelRemainingMs === "number" ? status.accelRemainingMs : null,
        );
      })
      .catch(() => undefined);
  }, []);

  // 主进程数据变更推送：任务状态变化时立即刷新（节流 1.5 秒，避免每任务全量重拉）。
  useEffect(() => {
    let last = 0;
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail === "tasks") {
        // 统计面板轻量、即时刷新；任务列表节流刷新。
        (window as any).appilot?.scheduler?.overview()
          .then(({ overview, nowRunning }: any) =>
            setData((prev) =>
              prev ? { ...prev, overview, nowRunning } : prev,
            ),
          )
          .catch(() => undefined);
        if (Date.now() - last > 800) {
          last = Date.now();
          (window as any).appilot?.scheduler?.list()
            .then(setData)
            .catch(() => undefined);
          (window as any).appilot?.scheduler?.timeline()
            .then(setTimeline)
            .catch(() => undefined);
        }
      }
    };
    window.addEventListener("appilot:data-changed", handler);
    return () => window.removeEventListener("appilot:data-changed", handler);
  }, []);

  // 加速倒计时本地每秒递减，按钮上的秒数即时变化。
  useEffect(() => {
    if (!accel) return;
    const timer = window.setInterval(() => {
      setAccelRemainingMs((prev) =>
        prev != null ? Math.max(0, prev - 1000) : prev,
      );
    }, 1000);
    return () => window.clearInterval(timer);
  }, [accel]);

  // 倒计时归零：立即触发主进程解除（不用等下一轮调度检测），
  // 未执行任务会被重新排回未来时段。
  useEffect(() => {
    if (!accel || accelRemainingMs == null || accelRemainingMs > 0) return;
    (window as any).appilot?.scheduler?.setAccel(false)
      .then(() => {
        setAccel(false);
        setAccelRemainingMs(null);
        (window as any).appilot?.scheduler?.list()
          .then(setData)
          .catch(() => undefined);
      })
      .catch(() => undefined);
  }, [accel, accelRemainingMs]);

  // 不同类型任务适用的筛选条件不同：排名任务才有语言维度；GitHub/数据同步
  // 是项目级任务（无平台/语言）；评论/构建状态是产品级（有平台、无语言）。
  const typeTasks =
    typeFilter === "all"
      ? data?.tasks || []
      : (data?.tasks || []).filter((task: any) => task.kind === typeFilter);
  const projectOptions = Array.from(
    new Set(
      typeTasks
        .map((task: any) => task.projectName)
        .filter((name: string) => name && name !== "已删除项目"),
    ),
  ).sort();
  const platformOptions = Array.from(
    new Set(typeTasks.map((task: any) => task.platform).filter(Boolean)),
  ).sort();
  const languageOptions = Array.from(
    new Set(
      typeTasks
        .map((task: any) => task.queryLanguage)
        .filter((lang: string) => Boolean(lang)),
    ),
  ).sort();
  const typeSupportsPlatform =
    typeFilter === "all" ||
    typeFilter === "rank" ||
    typeFilter === "reviews-sync" ||
    typeFilter === "build-status";
  const typeSupportsLanguage = typeFilter === "all" || typeFilter === "rank";
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
          <button
            type="button"
            onClick={() => {
              // 未开启 → 开启；已开启 → 延长 5 分钟。
              (window as any).appilot?.scheduler?.setAccel(true)
                .then(() => {
                  setAccel(true);
                  (window as any).appilot?.scheduler?.list()
                    .then(setData)
                    .catch(() => undefined);
                  (window as any).appilot?.scheduler?.status()
                    .then((st: any) =>
                      setAccelRemainingMs(
                        typeof st?.accelRemainingMs === "number" ? st.accelRemainingMs : null,
                      ),
                    )
                    .catch(() => undefined);
                })
                .catch(() => undefined);
            }}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors",
              accel
                ? "border-amber-500 ring-2 ring-amber-500/20 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400"
                : "border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-amber-500/50 hover:text-amber-600 dark:hover:text-amber-400",
            )}
            title={
              accel
                ? "点击延长 5 分钟加速；所有任务处理完或到时后自动解除"
                : "开启加速模式，以更快速度处理积压任务"
            }
          >
            {accel ? (
              <>
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                {accelRemainingMs != null
                  ? `加速中 · ${Math.ceil(accelRemainingMs / 1000)} 秒后自动解除`
                  : "加速模式（开）"}
              </>
            ) : (
              "加速模式"
            )}
          </button>
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
                ? `积压 ×${overview.overdue}`
                : overview.nextDueAt
                  ? formatHumanTime(overview.nextDueAt)
                  : "—"
            }
            sub="最近的计划任务"
          />
        </div>
      )}

      <TaskTimelineChart timeline={timeline} accel={accel} />

      <div className="mt-6 mb-6 flex flex-wrap gap-2">
        <select
          value={typeFilter}
          onChange={(e) => {
            const value = e.target.value;
            setTypeFilter(value);
            // 类型切换后，不适用的筛选条件复位并禁用。
            if (
              value !== "all" &&
              value !== "rank" &&
              value !== "reviews-sync" &&
              value !== "build-status"
            ) {
              setPlatformFilter("all");
            }
            if (value !== "all" && value !== "rank") {
              setLanguageFilter("all");
            }
          }}
          className={inputLineClass + " max-w-36"}
        >
          <option value="all">全部类型</option>
          {["rank", "github-sync", "ops-sync", "reviews-sync", "build-status"].map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABELS[kind] || kind}
            </option>
          ))}
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
          disabled={!typeSupportsPlatform}
          className={inputLineClass + " max-w-32 disabled:opacity-40"}
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
          disabled={!typeSupportsLanguage}
          className={inputLineClass + " max-w-36 disabled:opacity-40"}
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
        <TaskSection
          title={`准备进行（${pendingGroups.length} 组）`}
          groups={pendingGroups}
          onOpenTask={openTaskTarget}
        />
        <TaskSection
          title={`失败（${failedGroups.length} 组）`}
          groups={failedGroups}
          onOpenTask={openTaskTarget}
        />
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 shadow-sm">
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <ValueFlash
        value={value}
        mode="text"
        className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100 leading-tight"
      >
        {value}
      </ValueFlash>
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
  accel,
}: {
  timeline?: {
    recent: { hour: number; success: number; failed: number }[];
    upcoming: { hour: number; count: number }[];
  };
  accel?: boolean;
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
          {accel
            ? "加速模式：从后续时段逐批提取任务执行，处理完自动解除"
            : "每小时计划任务与实际执行叠加（悬停查看详情）"}
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
    const key = taskGroupKey(task);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        key,
        kind: task.kind === "rank" ? "rank" : task.kind,
        projectName: task.projectName,
        productName: task.productName,
        platform: task.platform,
        queryLanguage: task.queryLanguage,
        storefront: task.storefront,
        groupKey: task.groupKey,
        round: task.round || null,
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
      if (!existing.groupKey && task.groupKey) existing.groupKey = task.groupKey;
      if (!existing.round && task.round) existing.round = task.round;
    }
  }
  return [...map.values()];
}

type SortKey = "firstRunAt" | "lastRunAt" | "nextRunAt" | "roundProgress";
interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

function compareGroups(sort: SortState) {
  return (a: any, b: any) => {
    if (sort.key === "roundProgress") {
      const av = a.round && a.round.total > 0 ? a.round.done / a.round.total : null;
      const bv = b.round && b.round.total > 0 ? b.round.done / b.round.total : null;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sort.dir === "asc" ? av - bv : bv - av;
    }
    const av = a[sort.key] ?? null;
    const bv = b[sort.key] ?? null;
    // Tasks without a timestamp sort last regardless of direction.
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = new Date(av).getTime() - new Date(bv).getTime();
    return sort.dir === "asc" ? cmp : -cmp;
  };
}

function TaskSection({
  title,
  groups,
  onOpenTask,
}: {
  title: string;
  groups: any[];
  onOpenTask?: (group: any) => void;
}) {
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<SortState>({ key: "lastRunAt", dir: "desc" });
  const pageSize = 20;
  useEffect(() => {
    setPage(0);
  }, [title, groups.length, sort.key, sort.dir]);
  if (groups.length === 0) return null;
  const totalPages = Math.max(1, Math.ceil(groups.length / pageSize));
  const sorted = [...groups].sort(compareGroups(sort));
  const visible = sorted.slice(page * pageSize, page * pageSize + pageSize);

  const toggleSort = (key: SortKey) => {
    setSort((prev) => {
      if (prev.key === key) {
        return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      }
      // Timestamps read best newest-first; next runs read best soonest-first.
      return { key, dir: key === "nextRunAt" ? "asc" : "desc" };
    });
  };

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
      <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_repeat(5,minmax(0,6.5rem))] items-stretch border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50/30 dark:bg-zinc-900/40">
        <span className="px-5 py-2 text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
          任务
        </span>
        <div className="px-3 py-2 border-l border-zinc-200/70 dark:border-zinc-700/70">
          <SortHeader label="首次执行" sortKey="firstRunAt" sort={sort} onSort={toggleSort} />
        </div>
        <div className="px-3 py-2 border-l border-zinc-200/70 dark:border-zinc-700/70">
          <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            上轮完成
          </span>
        </div>
        <div className="px-3 py-2 border-l border-zinc-200/70 dark:border-zinc-700/70">
          <SortHeader label="上次执行" sortKey="lastRunAt" sort={sort} onSort={toggleSort} />
        </div>
        <div className="px-3 py-2 border-l border-zinc-200/70 dark:border-zinc-700/70">
          <SortHeader label="下次执行" sortKey="nextRunAt" sort={sort} onSort={toggleSort} />
        </div>
        <div className="px-3 py-2 border-l border-zinc-200/70 dark:border-zinc-700/70">
          <SortHeader label="本轮进度" sortKey="roundProgress" sort={sort} onSort={toggleSort} />
        </div>
      </div>
      {visible.map((group, rowIndex) => (
        <div
          key={group.key}
          className={cn(
            "grid grid-cols-[minmax(0,1fr)_repeat(5,minmax(0,6.5rem))] items-stretch border-b border-zinc-100 dark:border-zinc-800 last:border-b-0",
            rowIndex % 2 === 1 && "bg-zinc-50/60 dark:bg-zinc-800/20",
          )}
        >
          <div
            role="button"
            tabIndex={0}
            onClick={() => onOpenTask?.(group)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpenTask?.(group);
              }
            }}
            title="点击跳转到对应页面"
            className="flex items-start gap-2 min-w-0 px-5 py-3 cursor-pointer hover:bg-amber-50/40 dark:hover:bg-amber-500/5 transition-colors"
          >
            <span
              className={cn(
                "mt-0.5 px-2 py-0.5 rounded text-[10px] font-medium shrink-0",
                group.kind === "rank"
                  ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400",
              )}
            >
              {KIND_LABELS[group.kind] || group.kind}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1 min-w-0">
                {group.kind === "rank" ? (
                  <>
                    <div className="text-sm text-zinc-800 dark:text-zinc-200 truncate">
                      {group.projectName} ·{" "}
                      {group.platform === "ios"
                        ? "iOS"
                        : group.platform === "macos"
                          ? "macOS"
                          : "未识别"}
                    </div>
                    <div className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate">
                      {storefrontDisplayName(group.storefront || "")} ·{" "}
                      {languageLabel(group.queryLanguage || "")} ·{" "}
                      {group.tasks.length} 个关键词
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-zinc-800 dark:text-zinc-200 truncate">
                    {group.projectName} · {KIND_LABELS[group.kind] || group.kind}
                  </div>
                )}
                {group.kind === "github-sync" && (
                  <span title="依赖 GitHub 凭证" className="shrink-0">
                    <GithubIcon className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" />
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="min-w-0 px-3 py-3 text-right border-l border-zinc-100 dark:border-zinc-800">
            <div className="text-xs text-zinc-600 dark:text-zinc-300 truncate">
              {group.firstRunAt ? formatHumanTime(group.firstRunAt) : "—"}
            </div>
          </div>
          <div className="min-w-0 px-3 py-3 text-right border-l border-zinc-100 dark:border-zinc-800">
            <div className="text-xs text-zinc-600 dark:text-zinc-300 truncate">
              {group.round?.lastCompletedAt
                ? formatHumanTime(group.round.lastCompletedAt)
                : "—"}
            </div>
          </div>
          <div className="min-w-0 px-3 py-3 text-right border-l border-zinc-100 dark:border-zinc-800">
            <div className="text-xs text-zinc-600 dark:text-zinc-300 truncate">
              <ValueFlash value={group.lastRunAt} mode="text">
                {group.lastRunAt ? formatHumanTime(group.lastRunAt) : "尚未执行"}
              </ValueFlash>
            </div>
          </div>
          <div className="min-w-0 px-3 py-3 text-right border-l border-zinc-100 dark:border-zinc-800">
            <div className="text-xs text-zinc-600 dark:text-zinc-300 truncate">
              <ValueFlash value={group.nextRunAt} mode="text">
                {formatHumanTime(group.nextRunAt)}
              </ValueFlash>
            </div>
          </div>
          <div className="min-w-0 px-3 py-3 text-right border-l border-zinc-100 dark:border-zinc-800">
            {group.kind !== "rank" || !group.round || group.round.total === 0 ? (
              <div className="text-xs text-zinc-400 dark:text-zinc-500 truncate">—</div>
            ) : (
              <div className="flex flex-col items-end gap-1">
                <ValueFlash
                  value={`${group.round.done}/${group.round.total}`}
                  mode="text"
                  className="text-xs text-zinc-600 dark:text-zinc-300 truncate"
                >
                  {group.round.done}/{group.round.total}
                </ValueFlash>
                <div
                  className="w-20 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden"
                  title={`${Math.round((group.round.done / group.round.total) * 100)}%`}
                >
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round((group.round.done / group.round.total) * 100),
                      )}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      ))}
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

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
}) {
  const active = sort.key === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={cn(
        "text-right text-[10px] font-medium uppercase tracking-wide transition-colors",
        active
          ? "text-zinc-700 dark:text-zinc-200"
          : "text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300",
      )}
      title={`按${label}排序`}
    >
      {label} <span className="text-[9px]">{active ? (sort.dir === "desc" ? "▼" : "▲") : "⇅"}</span>
    </button>
  );
}
