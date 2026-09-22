import { formatHumanTime } from "../../lib/format";
import { draftVersionLabel, groupHistoryDrafts } from "./releaseFormat";
import { AppleIcon } from "../ui/Icons";

function revisionNumber(draft: any): number {
  return Math.max(1, Number(draft?.revisionNumber) || 1);
}

export function HistoryPanel({
  drafts,
  currentDraftId,
  onSelect,
  onDelete,
  onCreateRevision,
  onContinueRevision,
}: {
  drafts: any[];
  currentDraftId?: string | null;
  onSelect: (draft: any) => void;
  onDelete?: (draft: any) => void;
  onCreateRevision?: (draft: any) => void;
  onContinueRevision?: (draft: any) => void;
}) {
  const groups = groupHistoryDrafts(drafts);

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900/70">
      <header className="flex items-center justify-between gap-4 border-b border-zinc-200/80 px-5 py-4 dark:border-zinc-800">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">文案列表</h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            每个 App 版本只展示当前定稿；旧定稿保留在修订历史中。
          </p>
        </div>
        <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
          {groups.length > 0 ? `${groups.length} 个版本` : "暂无文案"}
        </span>
      </header>

      {groups.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">还没有已定稿文案。</p>
        </div>
      ) : (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {groups.map(({ key, current, working, history }) => {
            const isCurrent = current.id === currentDraftId;
            const languages = (current.localizations || [])
              .map((localization: any) => String(localization?.language || "").trim())
              .filter(Boolean);
            return (
              <div key={key} className="px-5 py-3.5">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => onSelect(current)}
                    className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 text-left sm:grid-cols-[minmax(0,1fr)_auto_auto]"
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
                          {draftVersionLabel(current)}
                        </span>
                        {current.ascSyncedAt && <AppleIcon className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
                        <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                          {isCurrent ? "当前 · 已定稿" : "已定稿"} · 修订 {revisionNumber(current)}
                        </span>
                        {working && (
                          <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                            修订 {revisionNumber(working)} 编辑中
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      {languages.length} 语言
                    </span>
                    <span className="hidden text-xs text-zinc-400 dark:text-zinc-500 sm:block">
                      {formatHumanTime(current.updatedAt)}
                    </span>
                  </button>
                  {working ? (
                    <button type="button" onClick={() => onContinueRevision?.(working)} className="shrink-0 rounded-lg border border-amber-200 px-2.5 py-1.5 text-[11px] font-medium text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950/30">
                      继续修订
                    </button>
                  ) : onCreateRevision && isCurrent ? (
                    <button type="button" onClick={() => onCreateRevision(current)} className="shrink-0 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[11px] text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                      创建修订稿
                    </button>
                  ) : null}
                </div>

                {history.length > 0 && (
                  <details className="ml-1 mt-2">
                    <summary className="cursor-pointer text-[11px] text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300">
                      历史修订 {history.length} 份
                    </summary>
                    <div className="mt-2 space-y-1 border-l border-zinc-200 pl-3 dark:border-zinc-700">
                      {history.map((item: any) => (
                        <div key={item.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                          <button type="button" onClick={() => onSelect(item)} className="min-w-0 flex-1 text-left text-xs text-zinc-600 dark:text-zinc-300">
                            修订 {revisionNumber(item)} · 定稿于 {formatHumanTime(item.batchConfirmedAt || item.updatedAt)}
                          </button>
                          {onDelete && (
                            <button type="button" onClick={() => onDelete(item)} title="删除这份历史修订" className="h-6 w-6 rounded text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10">×</button>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
