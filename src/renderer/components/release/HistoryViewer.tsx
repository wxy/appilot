import { useEffect, useState } from "react";
import { formatHumanTime, languageLabel } from "../../lib/format";
import { localizationList } from "../../lib/release-localization";
import { draftVersionLabel } from "./releaseFormat";
import { CopyTabPage } from "./CopyTabPage";
import { ScreenshotMaterialsPanel } from "./ScreenshotMaterialsPanel";
import { btnSmSecondary } from "../ui/styles";
import { cn } from "../../lib/utils";

export function HistoryViewer({
  draft,
  projectId,
  productTrackName,
  onSaveScreenshotCopy,
  onBack,
  backLabel = "返回文案列表",
}: {
  draft: any;
  projectId?: string;
  productTrackName?: string | null;
  onSaveScreenshotCopy?: (screenshotCopy: any) => Promise<any>;
  onBack?: () => void;
  backLabel?: string;
}) {
  const [viewerDraft, setViewerDraft] = useState(draft);
  useEffect(() => setViewerDraft(draft), [draft?.id, draft?.updatedAt]);
  const localizations = localizationList(viewerDraft);
  const [language, setLanguage] = useState("");
  const [section, setSection] = useState<"store" | "screenshots">(
    localizations.length === 0 && viewerDraft.screenshotCopy ? "screenshots" : "store",
  );
  const hasStoreCopy = localizations.length > 0;
  const hasScreenshotCopy = Boolean(viewerDraft.screenshotCopy);
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
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">发布文案</h3>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className={btnSmSecondary}
            >
              ← {backLabel}
            </button>
          )}
          <span className="text-xs text-zinc-400 dark:text-zinc-500 truncate">
            {draftVersionLabel(viewerDraft)} · 更新于 {formatHumanTime(viewerDraft.updatedAt)}
          </span>
        </div>
        <div className="inline-flex rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
            {([['store', '商店文案'], ['screenshots', '截图文案']] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setSection(key)} className={cn("rounded-md px-3 py-1.5 text-xs transition-colors", section === key ? "bg-white font-medium text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100" : "text-zinc-500 dark:text-zinc-400")}>{label}</button>
            ))}
        </div>
      </div>
      <div className="p-6 space-y-6">
        {section === "store" ? hasStoreCopy ? <CopyTabPage
              languages={tabLanguages}
              activeLanguage={activeLanguage}
              onSelect={setLanguage}
              localization={loc}
              readOnly
              productTrackName={productTrackName}
            /> : <p className="py-10 text-center text-sm text-zinc-400 dark:text-zinc-500">这个版本没有商店文案。</p>
          : hasScreenshotCopy ? <ScreenshotMaterialsPanel
              projectId={projectId}
              draftId={viewerDraft.id}
              value={viewerDraft.screenshotCopy}
              supportedLanguages={viewerDraft.screenshotCopy?.selectedLanguages || tabLanguages}
              defaultSourceLanguage={viewerDraft.screenshotCopy?.sourceLanguage || localizations[0]?.language || ""}
              readOnly
              allowArtifactGeneration={Boolean(projectId && onSaveScreenshotCopy)}
              onChange={(screenshotCopy) => setViewerDraft((current: any) => ({
                ...current,
                screenshotCopy,
              }))}
              onCommit={async (screenshotCopy) => {
                const saved = await onSaveScreenshotCopy?.(screenshotCopy);
                if (saved) setViewerDraft(saved);
              }}
            /> : <p className="py-10 text-center text-sm text-zinc-400 dark:text-zinc-500">这个版本没有截图文案。</p>}
      </div>
    </div>
  );
}
