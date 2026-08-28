import { useState } from "react";
import { cn } from "../../lib/utils";
import { formatHumanTime, languageLabel, UI_SOURCE_LANGUAGE } from "../../lib/format";
import { localizationList } from "../../lib/release-localization";
import { FieldHeader } from "../ui/Fields";
import { inputClass, inputLineClass } from "../ui/styles";
import { draftVersionLabel } from "./releaseFormat";

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
            {/* 与发布工作台一致：标签栏在上，内容页圆角上边缘压住滚动栏 */}
            <div>
            <div className="tab-scrollbar relative z-10 mx-auto flex w-fit max-w-full gap-0.5 overflow-x-auto px-1.5 pt-1 -mb-1.5">
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
            <div className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="p-4 space-y-4">
                {loc && (
                  <>
                    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-4">
              <p className="text-[11px] font-semibold tracking-wider text-zinc-400 dark:text-zinc-500">
                应用信息
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <FieldHeader label="软件名称" text={loc.name || productTrackName || ""} />
                  <input
                    value={loc.name || productTrackName || ""}
                    readOnly
                    className={inputLineClass}
                  />
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500 px-1">
                    {(loc.name || "").length}/30 字符
                  </p>
                </div>
                <div className="space-y-1.5">
                  <FieldHeader label="软件副标题" text={loc.subtitle || ""} />
                  <input value={loc.subtitle || ""} readOnly className={inputLineClass} />
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500 px-1">
                    {(loc.subtitle || "").length}/30 字符
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-4">
              <p className="text-[11px] font-semibold tracking-wider text-zinc-400 dark:text-zinc-500">
                软件版本信息
              </p>
              <div className="space-y-1.5">
                <FieldHeader label="推广文本" text={loc.promotionalText || ""} />
                <input value={loc.promotionalText || ""} readOnly className={inputLineClass} />
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500 px-1">
                  {(loc.promotionalText || "").length}/170 字符
                </p>
              </div>
              <div className="space-y-1.5">
                <FieldHeader label="软件描述" text={loc.description || ""} />
                <textarea
                  value={(loc.description || "").replace(/^──── 介绍 ────\n?/, "")}
                  readOnly
                  className={inputClass + " min-h-40 resize-y"}
                />
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500 px-1">
                  {(loc.description || "").replace(/^──── 介绍 ────\n?/, "").length}/4000 字符
                </p>
              </div>
              <div className="space-y-1.5">
                <FieldHeader label="新增内容" text={loc.whatsNew || ""} />
                <textarea value={loc.whatsNew || ""} readOnly className={inputClass + " min-h-28 resize-y"} />
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500 px-1">
                  {(loc.whatsNew || "").length}/4000 字符
                </p>
              </div>
              <div className="space-y-1.5">
                <FieldHeader label="关键词（提交字段）" text={loc.keywords || ""} />
                <input value={loc.keywords || ""} readOnly className={inputLineClass} />
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500 px-1">
                  {(loc.keywords || "").length}/100 字符
                </p>
              </div>
            </div>
            </>
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
