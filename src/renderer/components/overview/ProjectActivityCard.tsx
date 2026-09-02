import { useEffect, useMemo, useState } from "react";
import { cn } from "../../lib/utils";
import { GithubIcon } from "../ui/Icons";

const DAY_MS = 24 * 60 * 60 * 1000;
/** ~4 months of history. */
const RANGE_DAYS = 120;
const CELL_PX = 12;
const CELL_GAP = 3;

interface DayCell {
  date: string;
  commits: number;
  releaseTag: string | null;
  /** Before the actual range start (alignment padding) — rendered invisible. */
  preRange: boolean;
}

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function tierClass(commits: number): string {
  if (commits === 0) return "bg-zinc-100 dark:bg-zinc-800";
  if (commits <= 5) return "bg-emerald-200 dark:bg-emerald-900";
  if (commits <= 20) return "bg-emerald-400 dark:bg-emerald-700";
  if (commits <= 50) return "bg-emerald-600 dark:bg-emerald-500";
  return "bg-emerald-800 dark:bg-emerald-300";
}

function formatLastCommit(date: string): string {
  const diff = Date.now() - new Date(`${date}T23:59:59`).getTime();
  const hours = Math.floor(diff / (60 * 60 * 1000));
  if (hours <= 0) return "今天";
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "昨天";
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  return `${months} 个月前`;
}

export function ProjectActivityCard({
  project,
  activity: activityProp,
  releases: releasesProp,
  loaded: loadedProp,
}: {
  project: any;
  /** 可选注入：每日提交数（DSH 客户端等无 window.appilot 的宿主传入）。缺省时内部经 IPC 取数。 */
  activity?: Record<string, number>;
  /** 可选注入：发布列表（tag + publishedAt，用于热力图标注）。 */
  releases?: { tag: string; publishedAt: string | null }[];
  /** 可选注入：数据是否已就绪（缺省跟随内部取数状态）。 */
  loaded?: boolean;
}) {
  const [activity, setActivity] = useState<Record<string, number>>({});
  const [releases, setReleases] = useState<{ tag: string; publishedAt: string | null }[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // 外部已注入数据（DSH 等）：任一注入即采用（缺项补空），不再内部取数。
    if (activityProp !== undefined || releasesProp !== undefined) {
      setActivity(activityProp ?? {});
      setReleases(releasesProp ?? []);
      setLoaded(loadedProp ?? true);
      return;
    }
    let cancelled = false;
    // 无 window.appilot 的宿主（DSH）：整条链为 undefined，安全跳过。
    const commitsP: any = (window as any).appilot?.activity?.commits(project.id);
    if (commitsP && typeof commitsP.then === "function") {
      commitsP
        .then((data: Record<string, number>) => {
          if (cancelled) return;
          setActivity(data || {});
          setLoaded(true);
        })
        .catch(() => { if (!cancelled) setLoaded(true); });
    } else {
      setLoaded(true);
    }
    const releasesP: any = (window as any).appilot?.release?.list(project.id);
    if (releasesP && typeof releasesP.then === "function") {
      releasesP
        .then((result: any) => {
          if (cancelled) return;
          setReleases(
            (result?.releases || [])
              .map((r: any) => ({ tag: r.tag || "", publishedAt: r.publishedAt || null }))
              .filter((r: any) => r.tag && r.publishedAt),
          );
        })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [project.id, activityProp, releasesProp, loadedProp]);

  const effectiveActivity = activityProp !== undefined ? activityProp : activity;
  const effectiveReleases = releasesProp !== undefined ? releasesProp : releases;
  const effectiveLoaded = loadedProp !== undefined ? loadedProp : loaded;

  const cells: DayCell[] = useMemo(() => {
    const now = new Date();
    // Align start to the Monday on or before the range start.
    const rangeStart = new Date(now.getTime() - (RANGE_DAYS - 1) * DAY_MS);
    const dow = rangeStart.getDay(); // 0=Sun … 6=Sat
    const daysToMonday = dow === 0 ? 6 : dow - 1;
    const gridStart = new Date(rangeStart.getTime() - daysToMonday * DAY_MS);
    const totalDays = Math.ceil((now.getTime() - gridStart.getTime()) / DAY_MS) + 1;

    const releaseByDay = new Map<string, string>();
    for (const r of effectiveReleases) {
      if (!r.publishedAt) continue;
      releaseByDay.set(r.publishedAt.slice(0, 10), r.tag);
    }

    const rangeStartKey = localDateKey(rangeStart);
    return Array.from({ length: totalDays }, (_, i) => {
      const d = new Date(gridStart.getTime() + i * DAY_MS);
      const date = localDateKey(d);
      return {
        date,
        commits: effectiveActivity[date] || 0,
        releaseTag: releaseByDay.get(date) || null,
        preRange: date < rangeStartKey,
      };
    });
  }, [effectiveActivity, effectiveReleases]);

  const monthLabels = useMemo(() => {
    const labels: { left: number; text: string }[] = [];
    let lastMonth = -1;
    cells.forEach((cell, i) => {
      const col = Math.floor(i / 7);
      const month = new Date(`${cell.date}T00:00:00`).getMonth();
      if (month !== lastMonth && !cell.preRange) {
        labels.push({ left: col * (CELL_PX + CELL_GAP), text: `${month + 1}月` });
        lastMonth = month;
      }
    });
    return labels;
  }, [cells]);

  const totalCommits = cells.filter((c) => !c.preRange).reduce((sum, c) => sum + c.commits, 0);
  const lastCommitDay = [...cells].reverse().find((c) => c.commits > 0) || null;

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 inline-flex items-center gap-1.5">
          <GithubIcon className="w-3.5 h-3.5" />
          项目活跃
        </h3>
        {lastCommitDay && (
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
            最近提交 {formatLastCommit(lastCommitDay.date)}
          </span>
        )}
      </div>
      {!effectiveLoaded ? (
        <div className="px-4 py-6 text-center text-xs text-zinc-400 dark:text-zinc-500">加载中…</div>
      ) : !project.localPath ? (
        <div className="px-4 py-6 text-center text-xs text-zinc-400 dark:text-zinc-500">
          未配置本地仓库路径
        </div>
      ) : (
        <>
          <div className="px-4 pt-3 pb-1 flex justify-center">
            <div>
              {/* Month labels positioned above the grid columns. */}
              <div className="relative" style={{ height: 14, marginBottom: 2 }}>
                {monthLabels.map((l) => (
                  <span
                    key={`${l.text}-${l.left}`}
                    className="absolute text-[9px] leading-none text-zinc-400 dark:text-zinc-500"
                    style={{ left: l.left }}
                  >
                    {l.text}
                  </span>
                ))}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateRows: `repeat(7, ${CELL_PX}px)`,
                  gridAutoFlow: "column",
                  gridAutoColumns: `${CELL_PX}px`,
                  gap: `${CELL_GAP}px`,
                }}
              >
                {cells.map((cell) => (
                  <div
                    key={cell.date}
                    className={cn(
                      "rounded-[2px] transition-colors",
                      cell.preRange ? "invisible" : tierClass(cell.commits),
                      cell.releaseTag && !cell.preRange &&
                        "ring-1 ring-amber-400 ring-offset-1 ring-offset-white dark:ring-offset-zinc-900",
                    )}
                    title={
                      cell.preRange ? undefined :
                      `${cell.date} · ${cell.commits} 次提交` +
                      (cell.releaseTag ? ` · released ${cell.releaseTag}` : "")
                    }
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="px-4 pb-3 pt-2 flex items-center justify-center gap-2">
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-zinc-400 dark:text-zinc-500">少</span>
              {[0, 3, 12, 35, 60].map((n) => (
                <span
                  key={n}
                  className={cn("w-2 h-2 rounded-[2px]", tierClass(n))}
                />
              ))}
              <span className="text-[10px] text-zinc-400 dark:text-zinc-500">多</span>
              <span className="ml-2 inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-[2px] ring-1 ring-amber-400 ring-offset-1 ring-offset-white dark:ring-offset-zinc-900 bg-zinc-100 dark:bg-zinc-800" />
                <span className="text-[10px] text-zinc-400 dark:text-zinc-500">发布</span>
              </span>
            </div>
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 whitespace-nowrap">
              4 个月 {totalCommits} 次提交
            </span>
          </div>
        </>
      )}
    </div>
  );
}
