import { formatHumanTime } from "../../lib/format";
import { draftVersionLabel, mergeHistoryDrafts } from "./releaseFormat";
import { AppleIcon } from "../ui/Icons";

export function HistoryPanel({
  drafts,
  onSelect,
  onDelete,
}: {
  drafts: any[];
  onSelect: (draft: any) => void;
  onDelete?: (draft: any) => void;
}) {
  const merged = mergeHistoryDrafts(drafts);

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900/70">
      <header className="flex items-center justify-between gap-4 border-b border-zinc-200/80 px-5 py-4 dark:border-zinc-800">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">历史文案</h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            查看过去的发布文案，并在需要时作为新版本的参考。
          </p>
        </div>
        <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
          {merged.length > 0 ? `${merged.length} 个版本` : "暂无文案"}
        </span>
      </header>

      {merged.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">还没有历史文案。</p>
        </div>
      ) : (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {merged.map((item: any, index: number) => {
            const languages = (item.localizations || [])
              .map((localization: any) => String(localization?.language || "").trim())
              .filter(Boolean);

            return (
              <div
                key={item.releaseTag || index}
                className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
              >
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 text-left sm:grid-cols-[minmax(0,1fr)_auto_auto]"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
                        {draftVersionLabel(item)}
                      </span>
                      {item.ascSyncedAt && (
                        <AppleIcon className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      )}
                      <span
                        className={
                          item.batchConfirmedAt
                            ? "shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                            : "shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                        }
                      >
                        {item.batchConfirmedAt ? "已定稿" : "未完成"}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs text-zinc-400 dark:text-zinc-500 sm:hidden">
                      {formatHumanTime(item.updatedAt)}
                    </span>
                  </span>

                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    {languages.length} 语言
                  </span>
                  <span className="hidden text-xs text-zinc-400 dark:text-zinc-500 sm:block">
                    {formatHumanTime(item.updatedAt)}
                  </span>
                </button>

                {onDelete && (
                  <button
                    type="button"
                    onClick={() => onDelete(item)}
                    title="删除该文案"
                    aria-label={`删除 ${draftVersionLabel(item)}`}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-zinc-500 dark:hover:bg-red-500/10"
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
