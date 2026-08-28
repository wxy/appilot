import { cn } from "../../lib/utils";
import { formatHumanTime } from "../../lib/format";
import { draftVersionLabel, mergeHistoryDrafts } from "./releaseFormat";
import { ReferenceSection } from "./ReferenceSection";
import { AppleIcon } from "../ui/Icons";

export function HistoryPanel({
  drafts,
  selectedDraft,
  onSelect,
  currentTag,
  onDelete,
}: {
  drafts: any[];
  selectedDraft: any;
  onSelect: (draft: any) => void;
  currentTag?: string;
  onDelete?: (draft: any) => void;
}) {
  const merged = mergeHistoryDrafts(drafts);
  return (
    <ReferenceSection title="文案历史列表" meta={merged.length > 0 ? `${merged.length} 个版本` : "暂无文案"} defaultOpen>
      {merged.length === 0 ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-500 py-1">还没有文案。</p>
      ) : (
        <div className="space-y-1">
          {merged.map((item: any, index: number) => {
            const isCurrent = item.releaseTag === currentTag;
            const active =
              selectedDraft?.releaseTag === item.releaseTag ||
              (!selectedDraft && isCurrent);
            const languages = (item.localizations || [])
              .map((loc: any) => String(loc?.language || "").trim())
              .filter(Boolean);
            return (
              <button
                key={item.releaseTag || index}
                type="button"
                onClick={() => onSelect(isCurrent ? null : item)}
                className={cn(
                  "w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left transition-colors",
                  active
                    ? "bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300"
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 text-sm font-medium truncate">
                    {draftVersionLabel(item)}
                    {item.ascSyncedAt && <AppleIcon className="w-3 h-3 text-emerald-500" />}
                  </span>
                  {!item.batchConfirmedAt && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 shrink-0">
                      未完成
                    </span>
                  )}
                  {isCurrent && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 shrink-0">
                      当前
                    </span>
                  )}
                  <span className="text-xs text-zinc-400 dark:text-zinc-500 shrink-0">
                    {formatHumanTime(item.updatedAt)}
                  </span>
                </span>
                {languages.length > 0 && (
                  <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 shrink-0">
                    {languages.length} 语言
                  </span>
                )}
                {onDelete && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(item);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        onDelete(item);
                      }
                    }}
                    title="删除该文案"
                    className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-md text-zinc-400 dark:text-zinc-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                  >
                    ×
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </ReferenceSection>
  );
}
