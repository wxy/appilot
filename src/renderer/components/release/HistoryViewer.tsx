import { useState } from "react";
import { cn } from "../../lib/utils";
import { formatHumanTime, languageLabel, UI_SOURCE_LANGUAGE } from "../../lib/format";
import { localizationList } from "../../lib/release-localization";
import { draftVersionLabel } from "./releaseFormat";
import { SubmissionCopyFields } from "./SubmissionCopyFields";

export function HistoryViewer({
  draft,
  productTrackName,
  onBack,
}: {
  draft: any;
  productTrackName?: string | null;
  onBack?: () => void;
}) {
  const [language, setLanguage] = useState("");
  const localizations = localizationList(draft);
  const activeLanguage = localizations.some((item: any) => item.language === language)
    ? language
    : localizations[0]?.language || "";
  const loc = localizations.find((item: any) => item.language === activeLanguage) || localizations[0] || null;
  // 与发布工作台一致：按汉语拼音排序。
  const tabLanguages = [...localizations].sort((a, b) =>
    languageLabel(a.language).localeCompare(languageLabel(b.language), "zh-CN"),
  );

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
      <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">文案</h3>
          <span className="text-xs text-zinc-400 dark:text-zinc-500 truncate">
            {draftVersionLabel(draft)} · 更新于 {formatHumanTime(draft.updatedAt)}
          </span>
        </div>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="shrink-0 px-3 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors"
          >
            ← 返回当前文案
          </button>
        )}
      </div>
      <div className="p-6 space-y-6">
        {localizations.length > 0 && (
          <>
            {/* 与发布工作台一致：顶部缩进矩形盖住内容页顶边线，标签在矩形内滚动 */}
            <div>
            <div className="tab-scrollbar relative mx-5 -mb-0.5 z-10 dark:bg-zinc-900 overflow-x-auto">
              <div className="flex w-fit gap-0.5 px-0 pt-2 pb-1.5 -mb-1 bg-white">
                {tabLanguages.map((item: any) => {
                const active = item.language === activeLanguage;
                return (
                  <button
                    key={item.language}
                    type="button"
                    onClick={() => setLanguage(item.language)}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-t-md shrink-0 whitespace-nowrap transition-colors",
                      active
                        ? "border-zinc-300 dark:border-zinc-700 border-b-0 bg-white dark:bg-zinc-900 text-amber-700 dark:text-amber-400 font-medium"
                        : "border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700",
                    )}
                  >
                    {item.language === UI_SOURCE_LANGUAGE ? (
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"
                        title="界面语言（简体中文）"
                      />
                    ) : item.language === "en" ? (
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-sky-500 shrink-0"
                        title="英文"
                      />
                    ) : null}
                    {languageLabel(item.language)}
                  </button>
                );
                })}
              </div>
            </div>
            <div className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="p-4 space-y-4">
                {loc && (
                  <SubmissionCopyFields
                    localization={loc}
                    readOnly
                    productTrackName={productTrackName}
                  />
              )}
              </div>
            </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
