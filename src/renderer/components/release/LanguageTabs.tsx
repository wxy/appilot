import { cn } from "../../lib/utils";
import { languageLabel, UI_SOURCE_LANGUAGE } from "../../lib/format";

/**
 * 语言选项卡栏：内容页顶部被两边缩进的无边框矩形覆盖，标签在其中横向滚动。
 * 明暗自适应（暗色 zinc-900），显式 overflow-y-hidden 避免出现垂直滚动条。
 */
export function LanguageTabs({
  languages,
  activeLanguage,
  onSelect,
  translatingLanguages,
  generatedLanguages,
}: {
  languages: string[];
  activeLanguage: string;
  onSelect: (language: string) => void;
  /** 正在翻译的语言（可选，发布工作单使用）。 */
  translatingLanguages?: Set<string>;
  /** 已生成文案的语言列表（可选）。 */
  generatedLanguages?: string[];
}) {
  const generated = new Set(generatedLanguages || []);
  return (
    /* 隐藏滚动条（scrollbar-hidden）但保留横向滚动：水平滚动条会在标签条
       底部占一条带、正好形成缝隙；隐藏后标签条与内容页完全贴平。 */
    <div className="scrollbar-hidden relative mx-5 -mb-0.5 z-10 bg-white dark:bg-zinc-900 overflow-x-auto overflow-y-hidden">
      {/* 无底内边距：标签底边与内容页边框齐平（-mb 重叠已把页面顶边上移）。 */}
      <div className="flex w-fit gap-0.5 px-1 pt-2">
        {languages.map((language) => {
          const translating = translatingLanguages?.has(language) || false;
          const isGenerated = generated.has(language);
          const active = language === activeLanguage;
          const title = translating
            ? `${languageLabel(language)}翻译进行中`
            : isGenerated
              ? `${languageLabel(language)}文案`
              : languageLabel(language);
          return (
            <button
              key={language}
              type="button"
              onClick={() => onSelect(language)}
              title={title}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-t-md shrink-0 whitespace-nowrap transition-colors",
                active
                  ? "border-zinc-300 dark:border-zinc-700 border-b-0 bg-white dark:bg-zinc-900 text-amber-700 dark:text-amber-400 font-medium"
                  : "border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700",
              )}
            >
              {language === UI_SOURCE_LANGUAGE ? (
                <span
                  className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"
                  title="界面语言（简体中文）"
                />
              ) : language === "en" ? (
                <span
                  className="w-1.5 h-1.5 rounded-full bg-sky-500 shrink-0"
                  title="英文"
                />
              ) : null}
              {languageLabel(language)}
              {translating && (
                <span className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
              )}
              {isGenerated && !translating && (
                <span className="text-emerald-500">✓</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
