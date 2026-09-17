import { useEffect, useState } from "react";
import { cn } from "../../lib/utils";
import { languageLabel } from "../../lib/format";
import { btnPrimary, btnSecondary } from "../ui/styles";

export interface CurationEntry {
  removals: { keyword: string; reason: string; translation?: string }[];
  adds: {
    keyword: string;
    translation: string;
    rationale: string;
  }[];
}

export type CurationChoice = "accept" | "ignore";

/** 弹窗确认后回传给页面的最终数据（带每条选择）。 */
export interface CurationResolved {
  removals: { keyword: string; reason: string; translation?: string; choice: CurationChoice }[];
  adds: { keyword: string; translation: string; rationale: string; choice: CurationChoice }[];
}

type Choices = Record<string, { removals: Record<string, CurationChoice>; adds: Record<string, CurationChoice> }>;

/**
 * 关键词建议弹窗：
 * - 语言 tab 按汉语拼音音序排列（与全应用语言标签一致）；
 * - 每条的「采纳/忽略」选择保存在弹窗内部——点击只重渲染弹窗本身，
 *   不触发页面级（关键词矩阵/图表）重渲染，消除点击延迟；
 * - 确定时把带选择的完整数据回传给页面落库。
 */
export function CurationDialog({
  curation,
  curationOpen,
  curationConfirm,
  budgetHint,
  onApply,
  onDiscard,
  onSetConfirm,
}: {
  curation: Record<string, CurationEntry>;
  curationOpen: boolean;
  curationConfirm: null | "apply" | "discard";
  /** 采集预算提示（如「每日 320/360 实例 · 剩余可采纳 40」）；超限建议会被自动裁剪。 */
  budgetHint?: string | null;
  onApply: (data: Record<string, CurationResolved>) => void;
  onDiscard: () => void;
  onSetConfirm: (value: null | "apply" | "discard") => void;
}) {
  const [activeLang, setActiveLang] = useState<string>("");
  const [choices, setChoices] = useState<Choices>({});

  // 新一批建议到达：重置选择（默认全部采纳）并回到第一个 tab。
  useEffect(() => {
    const next: Choices = {};
    for (const [lang, data] of Object.entries(curation)) {
      next[lang] = {
        removals: Object.fromEntries(data.removals.map((item) => [item.keyword, "accept" as const])),
        adds: Object.fromEntries(data.adds.map((item) => [item.keyword, "accept" as const])),
      };
    }
    setChoices(next);
    setActiveLang("");
  }, [curation]);

  if (!curationOpen || Object.keys(curation).length === 0) return null;

  // 语言 tab 按音序展示。
  const langs = Object.keys(curation).sort((a, b) =>
    languageLabel(a).localeCompare(languageLabel(b), "zh-CN"),
  );
  const currentLang = langs.includes(activeLang) ? activeLang : langs[0];
  const data = curation[currentLang];
  const langChoices = choices[currentLang] || { removals: {}, adds: {} };
  const choiceOf = (kind: "removals" | "adds", keyword: string): CurationChoice =>
    langChoices[kind]?.[keyword] ?? "accept";
  const setChoice = (kind: "removals" | "adds", keyword: string, choice: CurationChoice) =>
    setChoices((prev) => ({
      ...prev,
      [currentLang]: {
        removals: { ...(prev[currentLang]?.removals || {}) },
        adds: { ...(prev[currentLang]?.adds || {}) },
        [kind]: { ...(prev[currentLang]?.[kind] || {}), [keyword]: choice },
      },
    }));
  const setAllChoices = (choice: CurationChoice) =>
    setChoices(() => {
      const next: Choices = {};
      for (const lang of langs) {
        next[lang] = {
          removals: Object.fromEntries(curation[lang].removals.map((item) => [item.keyword, choice])),
          adds: Object.fromEntries(curation[lang].adds.map((item) => [item.keyword, choice])),
        };
      }
      return next;
    });

  const resolve = (): Record<string, CurationResolved> => {
    const out: Record<string, CurationResolved> = {};
    for (const lang of langs) {
      const c = choices[lang] || { removals: {}, adds: {} };
      out[lang] = {
        removals: curation[lang].removals.map((item) => ({
          ...item,
          choice: c.removals[item.keyword] ?? "accept",
        })),
        adds: curation[lang].adds.map((item) => ({
          ...item,
          choice: c.adds[item.keyword] ?? "accept",
        })),
      };
    }
    return out;
  };

  const acceptedAdds = langs.reduce(
    (sum, lang) => sum + curation[lang].adds.filter((item) => choiceOf("adds", item.keyword) === "accept").length,
    0,
  );
  const acceptedRemovals = langs.reduce(
    (sum, lang) =>
      sum + curation[lang].removals.filter((item) => choiceOf("removals", item.keyword) === "accept").length,
    0,
  );
  const ignoredCount = langs.reduce((sum, lang) => {
    const c = choices[lang] || { removals: {}, adds: {} };
    return (
      sum +
      curation[lang].adds.filter((item) => (c.adds[item.keyword] ?? "accept") === "ignore").length +
      curation[lang].removals.filter((item) => (c.removals[item.keyword] ?? "accept") === "ignore").length
    );
  }, 0);
  const langCount = (lang: string) => curation[lang].removals.length + curation[lang].adds.length;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              关键词建议（{langs.length} 种语言）
            </h3>
            {budgetHint && (
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">{budgetHint}</p>
            )}
          </div>
          <span className="text-xs text-zinc-400 dark:text-zinc-500 shrink-0">
            新增 {acceptedAdds} · 移除 {acceptedRemovals} · 忽略/保留 {ignoredCount}
          </span>
        </div>

        {/* 语言 tab：按音序，带条数徽标 */}
        <div className="px-5 pt-3 pb-0 border-b border-zinc-100 dark:border-zinc-800 flex flex-wrap gap-1.5">
          {langs.map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => setActiveLang(lang)}
              className={cn(
                "px-2.5 py-1.5 rounded-t-lg text-xs font-medium transition-colors border border-b-0",
                lang === currentLang
                  ? "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 text-amber-700 dark:text-amber-400"
                  : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200",
              )}
            >
              {languageLabel(lang)}
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[10px] font-mono text-zinc-500 dark:text-zinc-400">
                {langCount(lang)}
              </span>
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-auto p-5 space-y-2">
          {data.removals.length === 0 && data.adds.length === 0 && (
            <p className="text-xs text-zinc-400 dark:text-zinc-500 py-4 text-center">
              该语言本次没有建议。
            </p>
          )}
          {data.removals.map((item) => {
            const choice = choiceOf("removals", item.keyword);
            return (
              <div
                key={`rm:${item.keyword}`}
                className={cn(
                  "flex items-start justify-between gap-3 rounded-lg border px-3 py-2 transition-colors",
                  choice === "accept"
                    ? "border-red-200/70 dark:border-red-500/40 bg-red-50/40 dark:bg-red-500/5"
                    : "opacity-60 border-zinc-200 dark:border-zinc-700",
                )}
              >
                <div className="min-w-0">
                  <p className="text-sm text-zinc-800 dark:text-zinc-200">
                    {item.keyword}
                    {item.translation && item.translation !== item.keyword ? `（${item.translation}）` : ""}
                    <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-500/15 text-[10px] font-medium text-red-600 dark:text-red-400 align-middle">
                      移除
                    </span>
                  </p>
                  <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">{item.reason}</p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    onClick={() => setChoice("removals", item.keyword, "accept")}
                    className={cn(
                      "px-2.5 py-1 text-xs rounded-lg border transition-colors",
                      choice === "accept"
                        ? "border-red-300 dark:border-red-500/50 bg-red-500 text-white"
                        : "border-red-200 dark:border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10",
                    )}
                  >
                    采纳移除
                  </button>
                  <button
                    onClick={() => setChoice("removals", item.keyword, "ignore")}
                    className={cn(
                      "px-2.5 py-1 text-xs rounded-lg border transition-colors",
                      choice === "ignore"
                        ? "border-zinc-400 dark:border-zinc-500 bg-zinc-500 text-white"
                        : "border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
                    )}
                  >
                    保留
                  </button>
                </div>
              </div>
            );
          })}
          {data.adds.map((item) => {
            const choice = choiceOf("adds", item.keyword);
            return (
              <div
                key={`add:${item.keyword}`}
                className={cn(
                  "flex items-start justify-between gap-3 rounded-lg border px-3 py-2 transition-colors",
                  choice === "accept"
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
                    onClick={() => setChoice("adds", item.keyword, "accept")}
                    className={cn(
                      "px-2.5 py-1 text-xs rounded-lg border transition-colors",
                      choice === "accept"
                        ? "border-emerald-300 dark:border-emerald-500/50 bg-emerald-500 text-white"
                        : "border-emerald-200 dark:border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10",
                    )}
                  >
                    采纳新增
                  </button>
                  <button
                    onClick={() => setChoice("adds", item.keyword, "ignore")}
                    className={cn(
                      "px-2.5 py-1 text-xs rounded-lg border transition-colors",
                      choice === "ignore"
                        ? "border-zinc-400 dark:border-zinc-500 bg-zinc-500 text-white"
                        : "border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
                    )}
                  >
                    忽略
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-5 py-4 border-t border-zinc-100 dark:border-zinc-800 space-y-3">
          {curationConfirm === "apply" && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200/70 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/10 px-3 py-2">
              <p className="text-xs text-zinc-700 dark:text-zinc-300">
                将新增 {acceptedAdds} 个、移除 {acceptedRemovals} 个关键词（覆盖全部语言），确认执行？
              </p>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => onApply(resolve())}
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
                onClick={() => setAllChoices("accept")}
                className="px-3 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
              >
                全部采纳/移除
              </button>
              <button
                onClick={() => setAllChoices("ignore")}
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
