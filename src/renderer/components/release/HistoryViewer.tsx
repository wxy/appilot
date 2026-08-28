import { useState } from "react";
import { formatHumanTime, languageLabel } from "../../lib/format";
import { localizationList } from "../../lib/release-localization";
import { draftVersionLabel } from "./releaseFormat";
import { CopyTabPage } from "./CopyTabPage";

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
  // 与发布工作台一致：按汉语拼音排序（传语言代码字符串，而不是本地化对象）。
  const tabLanguages = localizations
    .map((item: any) => item.language)
    .sort((a, b) =>
      languageLabel(a).localeCompare(languageLabel(b), "zh-CN"),
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
            {/* 与发布工作台一致的语言选项卡页面（标签栏 + 文案字段一体） */}
            <CopyTabPage
              languages={tabLanguages}
              activeLanguage={activeLanguage}
              onSelect={setLanguage}
              localization={loc}
              readOnly
              productTrackName={productTrackName}
            />
          </>
        )}
      </div>
    </div>
  );
}
