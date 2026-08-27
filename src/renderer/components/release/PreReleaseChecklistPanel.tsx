import { cn } from "../../lib/utils";

/**
 * 发布前检查单：只做自动检查，并由用户逐项核对（标记“已核对”），
 * 提供核对进度。发布前素材（截图等）已从检查单中移出。
 */
export function PreReleaseChecklistPanel({
  checklist,
  running,
  onRun,
  onToggleReview,
}: {
  checklist: any;
  running: boolean;
  onRun: () => void;
  onToggleReview: (checkId: string, reviewed: boolean) => void;
}) {
  const checks = checklist?.checks || [];
  const reviewedCount = checks.filter((check: any) => check.reviewed).length;

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            发布前检查单
          </h4>
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
            自动检查 · 逐项人工核对
          </span>
        </div>
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {running ? "检查中…" : checklist ? "重新检查" : "运行检查"}
        </button>
      </div>
      <div className="p-4">
        {!checklist ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400 py-2">
            尚未运行发布前检查。
          </p>
        ) : (
          <>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mb-3">
              自动检查发现缺漏并提醒；请逐项核对，确认处理后标记“已核对”。
            </p>
            <div className="space-y-2">
              {checks.map((check: any) => {
                const tone =
                  check.status === "pass"
                    ? "bg-emerald-500"
                    : check.status === "fail"
                      ? "bg-red-500"
                      : check.status === "warn"
                        ? "bg-amber-500"
                        : "bg-zinc-400";
                const statusLabel =
                  check.status === "pass"
                    ? "通过"
                    : check.status === "fail"
                      ? "不通过"
                      : check.status === "warn"
                        ? "提醒"
                        : "未知";
                return (
                  <div
                    key={check.id}
                    className={cn(
                      "rounded-xl border p-3 transition-colors",
                      check.reviewed
                        ? "border-emerald-300 dark:border-emerald-700/60 bg-emerald-50/30 dark:bg-emerald-500/[0.04]"
                        : "border-zinc-200 dark:border-zinc-700",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className={cn("mt-1.5 w-2 h-2 rounded-full shrink-0", tone)}
                      />
                      <div className="min-w-0 flex-1">
                        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                          {check.label}
                        </span>
                        <span className="ml-1.5 text-[10px] text-zinc-400">
                          [{statusLabel}]
                        </span>
                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                          {check.detail}
                        </p>
                        {(check.items || []).length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {(check.items || []).map(
                              (
                                item: { label: string; kind?: string },
                                index: number,
                              ) => (
                                <span
                                  key={`${item.kind}:${item.label}:${index}`}
                                  className={cn(
                                    "px-1.5 py-0.5 rounded-md text-[10px]",
                                    item.kind === "capability"
                                      ? "bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-400"
                                      : "bg-sky-100 dark:bg-sky-500/15 text-sky-700 dark:text-sky-400",
                                  )}
                                >
                                  {item.label}
                                </span>
                              ),
                            )}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => onToggleReview(check.id, !check.reviewed)}
                        className={cn(
                          "shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium transition-colors",
                          check.reviewed
                            ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                            : "border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-emerald-400/60 hover:text-emerald-600",
                        )}
                      >
                        {check.reviewed ? "✓ 已核对" : "○ 核对"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {checks.length > 0 && (
              <p className="mt-3 text-[11px] text-zinc-400 dark:text-zinc-500">
                已核对 {reviewedCount} / {checks.length}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
