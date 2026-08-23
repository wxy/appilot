import { cn } from "../../lib/utils";
import { languageLabel } from "../../lib/format";
import { btnPrimary, btnSecondary } from "../ui/styles";

export interface CurationEntry {
  removals: { keyword: string; reason: string; choice: "accept" | "ignore" | null }[];
  adds: {
    keyword: string;
    translation: string;
    rationale: string;
    choice: "accept" | "ignore" | null;
  }[];
}

export function CurationDialog({
  curation,
  curationOpen,
  acceptedAdds,
  acceptedRemovals,
  ignoredCount,
  curationConfirm,
  onItemChoice,
  onApply,
  onDiscard,
  onSelectAll,
  onSetConfirm,
}: {
  curation: Record<string, CurationEntry>;
  curationOpen: boolean;
  acceptedAdds: number;
  acceptedRemovals: number;
  ignoredCount: number;
  curationConfirm: null | "apply" | "discard";
  onItemChoice: (
    lang: string,
    kind: "removals" | "adds",
    keyword: string,
    choice: "accept" | "ignore",
  ) => void;
  onApply: () => void;
  onDiscard: () => void;
  onSelectAll: (choice: "accept" | "ignore") => void;
  onSetConfirm: (value: null | "apply" | "discard") => void;
}) {
  if (!curationOpen || Object.keys(curation).length === 0) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between gap-4">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">关键词整理建议</h3>
          <span className="text-xs text-zinc-400 dark:text-zinc-500">
            新增 {acceptedAdds} · 移除 {acceptedRemovals} · 忽略/保留 {ignoredCount}
          </span>
        </div>

        <div className="flex-1 min-h-0 overflow-auto p-5 space-y-4">
          {Object.entries(curation).map(([lang, data]) => (
            <div key={lang} className="space-y-2">
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{languageLabel(lang)}</p>
              {data.removals.map((item) => (
                <div
                  key={`rm:${item.keyword}`}
                  className={cn(
                    "flex items-start justify-between gap-3 rounded-lg border px-3 py-2 transition-colors",
                    item.choice === "accept"
                      ? "border-red-200/70 dark:border-red-500/40 bg-red-50/40 dark:bg-red-500/5"
                      : "opacity-60 border-zinc-200 dark:border-zinc-700",
                  )}
                >
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-800 dark:text-zinc-200">
                      {item.keyword}
                      <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-500/15 text-[10px] font-medium text-red-600 dark:text-red-400 align-middle">
                        移除
                      </span>
                    </p>
                    <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">{item.reason}</p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      onClick={() => onItemChoice(lang, "removals", item.keyword, "accept")}
                      className={cn(
                        "px-2.5 py-1 text-xs rounded-lg border transition-colors",
                        item.choice === "accept"
                          ? "border-red-300 dark:border-red-500/50 bg-red-500 text-white"
                          : "border-red-200 dark:border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10",
                      )}
                    >
                      采纳移除
                    </button>
                    <button
                      onClick={() => onItemChoice(lang, "removals", item.keyword, "ignore")}
                      className={cn(
                        "px-2.5 py-1 text-xs rounded-lg border transition-colors",
                        item.choice === "ignore"
                          ? "border-zinc-400 dark:border-zinc-500 bg-zinc-500 text-white"
                          : "border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
                      )}
                    >
                      保留
                    </button>
                  </div>
                </div>
              ))}
              {data.adds.map((item) => (
                <div
                  key={`add:${item.keyword}`}
                  className={cn(
                    "flex items-start justify-between gap-3 rounded-lg border px-3 py-2 transition-colors",
                    item.choice === "accept"
                      ? "border-emerald-200/70 dark:border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-500/5"
                      : "opacity-60 border-zinc-200 dark:border-zinc-700",
                  )}
                >
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-800 dark:text-zinc-200">
                      {item.keyword}
                      {item.translation && item.translation !== item.keyword ? `（${item.translation}）` : ""}
                      <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 align-middle">
                        新增
                      </span>
                    </p>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">{item.rationale}</p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      onClick={() => onItemChoice(lang, "adds", item.keyword, "accept")}
                      className={cn(
                        "px-2.5 py-1 text-xs rounded-lg border transition-colors",
                        item.choice === "accept"
                          ? "border-emerald-300 dark:border-emerald-500/50 bg-emerald-500 text-white"
                          : "border-emerald-200 dark:border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10",
                      )}
                    >
                      采纳新增
                    </button>
                    <button
                      onClick={() => onItemChoice(lang, "adds", item.keyword, "ignore")}
                      className={cn(
                        "px-2.5 py-1 text-xs rounded-lg border transition-colors",
                        item.choice === "ignore"
                          ? "border-zinc-400 dark:border-zinc-500 bg-zinc-500 text-white"
                          : "border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
                      )}
                    >
                      忽略
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="px-5 py-4 border-t border-zinc-100 dark:border-zinc-800 space-y-3">
          {curationConfirm === "apply" && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200/70 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/10 px-3 py-2">
              <p className="text-xs text-zinc-700 dark:text-zinc-300">
                将新增 {acceptedAdds} 个、移除 {acceptedRemovals} 个关键词，确认执行？
              </p>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => onApply()}
                  className="text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline"
                >
                  确认
                </button>
                <button
                  onClick={() => onSetConfirm(null)}
                  className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                >
                  取消
                </button>
              </div>
            </div>
          )}
          {curationConfirm === "discard" && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2">
              <p className="text-xs text-zinc-600 dark:text-zinc-300">关闭后将丢弃本次建议，确认？</p>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => onDiscard()}
                  className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
                >
                  确认丢弃
                </button>
                <button
                  onClick={() => onSetConfirm(null)}
                  className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                >
                  取消
                </button>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex gap-2">
              <button
                onClick={() => onSelectAll("accept")}
                className="px-3 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
              >
                全部采纳/移除
              </button>
              <button
                onClick={() => onSelectAll("ignore")}
                className="px-3 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
              >
                全部忽略/保留
              </button>
            </div>
            <div className="flex gap-2">
              <button onClick={() => onSetConfirm("apply")} className={btnPrimary}>
                确定
              </button>
              <button onClick={() => onSetConfirm("discard")} className={btnSecondary}>
                关闭
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
