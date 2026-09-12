import { useEffect, useMemo, useState } from "react";
import type { ScreenshotCopySet, ScreenshotMaterialItem } from "@appilot-labs/appilot-core/screenshot-material";
import {
  normalizeScreenshotCopySet,
  SCREENSHOT_DESCRIPTION_MAX,
  SCREENSHOT_TITLE_MAX,
} from "@appilot-labs/appilot-core/screenshot-material";
import { cn } from "../../lib/utils";
import { languageLabel } from "../../lib/format";
import { AIProgressButton } from "../ui/AIProgressButton";
import { CopyableTextInput } from "../ui/CopyFeedback";
import { LanguageTabs } from "./LanguageTabs";
import { btnPrimary, btnSecondary, btnSmSecondary, inputLineClass } from "../ui/styles";

function cloneSet(value: ScreenshotCopySet): ScreenshotCopySet {
  return {
    ...value,
    selectedLanguages: [...value.selectedLanguages],
    items: value.items.map((item) => ({ ...item, copies: { ...item.copies } })),
  };
}

function CopyRow({ item, language, sourceLanguage, readOnly, typeReadOnly, onChange, onCommit, onRemove }: {
  item: ScreenshotMaterialItem;
  language: string;
  sourceLanguage: string;
  readOnly: boolean;
  typeReadOnly: boolean;
  onChange: (field: "name" | "title" | "description", value: string) => void;
  onCommit: () => void;
  onRemove: () => void;
}) {
  const copy = item.copies[language] || { title: "", description: "" };
  const canEditType = language === sourceLanguage && !typeReadOnly;
  return (
    <div className="grid grid-cols-[minmax(150px,0.72fr)_minmax(180px,1fr)_minmax(260px,1.45fr)] items-start gap-3 border-b border-zinc-100 px-4 py-3 last:border-b-0 dark:border-zinc-800">
      <div className="flex min-w-0 items-center gap-2">
        {canEditType ? (
          <input value={item.name} onChange={(event) => onChange("name", event.target.value)} onBlur={onCommit} maxLength={100} className={cn(inputLineClass, "min-w-0 flex-1")} />
        ) : (
          <span className="min-w-0 flex-1 truncate py-2 text-sm text-zinc-700 dark:text-zinc-300">{item.name}</span>
        )}
        {canEditType && (
          <button type="button" onClick={onRemove} className="h-7 w-7 shrink-0 rounded text-xs text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30" aria-label="删除截图类型" title="删除截图类型">×</button>
        )}
      </div>
      <CopyableTextInput copyKey={`screenshot:${language}:${item.id}:title`} aria-label={`${item.name}标题`} value={copy.title} onChange={(event) => onChange("title", event.target.value)} onBlur={onCommit} placeholder={language === sourceLanguage ? "由 AI 生成，也可手工修改" : "尚未翻译"} maxLength={SCREENSHOT_TITLE_MAX} readOnly={readOnly} className={cn(inputLineClass, readOnly && "cursor-default")} />
      <CopyableTextInput copyKey={`screenshot:${language}:${item.id}:description`} aria-label={`${item.name}描述`} value={copy.description} onChange={(event) => onChange("description", event.target.value)} onBlur={onCommit} placeholder={language === sourceLanguage ? "由 AI 生成，也可手工修改" : "尚未翻译"} maxLength={SCREENSHOT_DESCRIPTION_MAX} readOnly={readOnly} className={cn(inputLineClass, readOnly && "cursor-default")} />
    </div>
  );
}

export function ScreenshotMaterialsPanel({ projectId, draftId, value, supportedLanguages, defaultSourceLanguage, readOnly = false, onChange, onCommit, onGenerated, onDelete }: {
  projectId?: string;
  draftId?: string;
  value?: ScreenshotCopySet | null;
  supportedLanguages: string[];
  defaultSourceLanguage: string;
  readOnly?: boolean;
  onChange?: (value: ScreenshotCopySet) => void;
  onCommit?: (value: ScreenshotCopySet) => Promise<void> | void;
  onGenerated?: (draft: any) => void;
  onDelete?: () => Promise<void> | void;
}) {
  const languages = useMemo(
    () => Array.from(new Set(supportedLanguages.map((item) => String(item).trim()).filter(Boolean))),
    [supportedLanguages.join("|")],
  );
  const fixedSourceLanguage = languages.includes(defaultSourceLanguage)
    ? defaultSourceLanguage
    : languages[0] || "en";
  // HMR can pair the new renderer with a still-running old main process. Normalize
  // the previous embedded shape here as well as in the persistence layer so that
  // opening the tab never depends on a main-process restart.
  const normalizedValue = useMemo(
    () => value
      ? normalizeScreenshotCopySet(
          value,
          fixedSourceLanguage,
          languages,
        )
      : null,
    [value, fixedSourceLanguage, languages],
  );
  const [activeLanguage, setActiveLanguage] = useState(normalizedValue?.sourceLanguage || fixedSourceLanguage);
  const [newTypeName, setNewTypeName] = useState("");
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [operationId, setOperationId] = useState("");
  const [progress, setProgress] = useState<{ chars: number; phase: "reasoning" | "content" } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!normalizedValue) return;
    if (!normalizedValue.selectedLanguages.includes(activeLanguage)) setActiveLanguage(normalizedValue.sourceLanguage);
  }, [normalizedValue?.sourceLanguage, normalizedValue?.selectedLanguages.join("|"), activeLanguage]);

  useEffect(() => {
    const off = (window as any).appilot?.release?.onGenerateProgress?.((event: any) => {
      if (!running) return;
      if (event?.kind === "retry") setRetrying(true);
      if (event?.kind === "chars" && typeof event.chars === "number") setProgress({ chars: event.chars, phase: event.phase === "content" ? "content" : "reasoning" });
    });
    return () => off?.();
  }, [running]);

  if (!normalizedValue) {
    if (readOnly) return <div className="rounded-xl border border-zinc-200 px-4 py-10 text-center text-sm text-zinc-400 dark:border-zinc-800">这份版本没有创建截图文案。</div>;
    const create = () => {
      const next: ScreenshotCopySet = { sourceLanguage: fixedSourceLanguage, selectedLanguages: languages.length ? languages : [fixedSourceLanguage], masterUpdatedAt: "", items: [], updatedAt: new Date().toISOString() };
      onChange?.(next);
      void onCommit?.(next);
    };
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 px-6 py-12 text-center dark:border-zinc-700">
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">本版本尚未创建截图文案</p>
        <p className="mx-auto mt-1 max-w-lg text-xs text-zinc-400 dark:text-zinc-500">创建后先用界面语言编写母本，再选择所需语言逐一翻译；整个流程不影响商店文案。</p>
        <button type="button" onClick={create} className={cn(btnPrimary, "mt-4")}>创建截图文案</button>
      </div>
    );
  }

  const screenshotCopy = normalizedValue;
  const masterConfirmed = Boolean(screenshotCopy.masterConfirmedAt);
  const batchConfirmed = Boolean(screenshotCopy.batchConfirmedAt);
  const update = (mutate: (next: ScreenshotCopySet) => void, commit = false) => {
    const next = cloneSet(screenshotCopy);
    mutate(next);
    next.updatedAt = new Date().toISOString();
    onChange?.(next);
    if (commit) void onCommit?.(next);
    return next;
  };
  const commitCurrent = () => {
    const next = cloneSet(screenshotCopy);
    next.items = next.items
      .map((item) => ({ ...item, name: item.name.trim() }))
      .filter((item) => item.name.length > 0);
    next.updatedAt = new Date().toISOString();
    const cleanedTypes = next.items.length !== screenshotCopy.items.length
      || next.items.some((item, index) => item.name !== screenshotCopy.items[index]?.name);
    if (cleanedTypes) {
      next.masterUpdatedAt = next.updatedAt;
      delete next.masterConfirmedAt;
      delete next.batchConfirmedAt;
      onChange?.(next);
    }
    void onCommit?.(next);
  };
  const sourceComplete = Boolean(screenshotCopy.items.length && screenshotCopy.items.every((item) => {
    const copy = item.copies[screenshotCopy.sourceLanguage];
    return copy?.title && copy?.description;
  }));
  const languageComplete = (language: string) => Boolean(screenshotCopy.items.length && screenshotCopy.items.every((item) => {
    const copy = item.copies[language];
    if (!copy?.title || !copy?.description) return false;
    return language === screenshotCopy.sourceLanguage || copy.sourceUpdatedAt === screenshotCopy.masterUpdatedAt;
  }));
  const missingTranslations = screenshotCopy.selectedLanguages.filter(
    (language) => language !== screenshotCopy.sourceLanguage && !languageComplete(language),
  );
  const fieldReadOnly = readOnly || batchConfirmed || (masterConfirmed && activeLanguage === screenshotCopy.sourceLanguage);
  const typeReadOnly = readOnly || masterConfirmed || batchConfirmed;

  const addType = () => {
    const name = newTypeName.trim();
    if (!name) return setError("请先输入截图类型名称。");
    setError("");
    update((next) => {
      next.items.push({ id: globalThis.crypto?.randomUUID?.() || `screenshot-${Date.now()}-${next.items.length}`, name, copies: {} });
      if (sourceComplete) next.masterUpdatedAt = new Date().toISOString();
    }, true);
    setNewTypeName("");
  };

  const run = async (mode: "generate" | "translate", targetLanguage = "") => {
    if (!projectId || !draftId || running) return;
    if (mode === "generate" && screenshotCopy.items.length === 0) return setError("请先添加截图类型。");
    setError(""); setRunning(true); setFailed(false); setRetrying(false); setProgress(null);
    const id = globalThis.crypto?.randomUUID?.() || `screenshot-ai-${Date.now()}`;
    setOperationId(id);
    try {
      await onCommit?.(screenshotCopy);
      const next = mode === "generate"
        ? await (window as any).appilot.release.generateScreenshotMaster(projectId, draftId, screenshotCopy, id)
        : await (window as any).appilot.release.translateScreenshotCopy(projectId, draftId, [targetLanguage], id);
      if (mode === "generate" && next?.screenshotCopy) {
        // Keep the invariant in the renderer too, so HMR with an older main
        // process cannot accidentally present freshly generated copy as confirmed.
        next.screenshotCopy = { ...next.screenshotCopy };
        delete next.screenshotCopy.masterConfirmedAt;
        delete next.screenshotCopy.batchConfirmedAt;
        await onCommit?.(next.screenshotCopy);
        setActiveLanguage(screenshotCopy.sourceLanguage);
      }
      onGenerated?.(next);
    } catch (reason: any) {
      if (!String(reason?.message || "").includes("已取消")) { setFailed(true); setError(reason?.message || "截图文案 AI 操作失败。"); }
    } finally {
      setRunning(false); setRetrying(false); setOperationId("");
    }
  };

  const confirmMaster = () => {
    if (!sourceComplete) return setError("请先完整生成或填写每个截图类型的标题和描述。");
    setError("");
    update((next) => { next.masterConfirmedAt = new Date().toISOString(); }, true);
  };
  const confirmBatch = () => {
    if (!masterConfirmed) return;
    if (missingTranslations.length > 0 && !window.confirm(`还有 ${missingTranslations.length} 个截图语言尚未翻译。仍要确定整批截图文案吗？`)) return;
    update((next) => { next.batchConfirmedAt = new Date().toISOString(); }, true);
  };
  const toggleLanguage = (language: string) => {
    if (readOnly || batchConfirmed || language === screenshotCopy.sourceLanguage) return;
    update((next) => {
      next.selectedLanguages = next.selectedLanguages.includes(language)
        ? next.selectedLanguages.filter((item) => item !== language)
        : languages.filter((item) => [...next.selectedLanguages, language].includes(item));
    }, true);
  };
  const generatedLanguages = screenshotCopy.selectedLanguages.filter(languageComplete);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-zinc-50 px-4 py-3 dark:bg-zinc-800/30">
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">母本 · {languageLabel(screenshotCopy.sourceLanguage)}</span>
          <details className="relative">
            <summary className="cursor-pointer list-none text-xs text-zinc-500 dark:text-zinc-400">目标语言 {screenshotCopy.selectedLanguages.length}/{languages.length} ▾</summary>
            <div className="absolute left-0 top-7 z-20 grid min-w-56 grid-cols-2 gap-1 rounded-xl border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-800">
              {languages.map((language) => {
                const selected = screenshotCopy.selectedLanguages.includes(language);
                const source = language === screenshotCopy.sourceLanguage;
                return <button key={language} type="button" onClick={() => toggleLanguage(language)} disabled={readOnly || batchConfirmed || source} className={cn("rounded-md px-2 py-1.5 text-left text-[11px]", selected ? "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300" : "text-zinc-400 hover:bg-zinc-50 dark:text-zinc-500 dark:hover:bg-zinc-700")}>{source ? "母本 · " : selected ? "✓ " : "○ "}{languageLabel(language)}</button>;
              })}
            </div>
          </details>
        </div>
        <span className={cn("text-xs", batchConfirmed ? "text-emerald-600 dark:text-emerald-400" : masterConfirmed ? "text-amber-600 dark:text-amber-400" : "text-zinc-400")}>{batchConfirmed ? "截图文案已完成" : masterConfirmed ? "截图母本已确定" : "截图母本编辑中"}</span>
      </div>

      <LanguageTabs languages={screenshotCopy.selectedLanguages} activeLanguage={activeLanguage} onSelect={setActiveLanguage} generatedLanguages={generatedLanguages} />
      <div className="overflow-x-auto rounded-xl border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-[minmax(150px,0.72fr)_minmax(180px,1fr)_minmax(260px,1.45fr)] gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-[11px] font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-400"><span>截图类型</span><span>标题</span><span>描述</span></div>
          {screenshotCopy.items.map((item) => (
            <CopyRow key={`${activeLanguage}:${item.id}`} item={item} language={activeLanguage} sourceLanguage={screenshotCopy.sourceLanguage} readOnly={fieldReadOnly} typeReadOnly={typeReadOnly}
              onChange={(field, fieldValue) => update((next) => {
                const target = next.items.find((entry) => entry.id === item.id);
                if (!target) return;
                if (field === "name") target.name = fieldValue;
                else {
                  const existing = target.copies[activeLanguage] || { title: "", description: "" };
                  target.copies[activeLanguage] = {
                    ...existing,
                    [field]: fieldValue,
                    ...(activeLanguage !== next.sourceLanguage
                      ? { sourceUpdatedAt: next.masterUpdatedAt }
                      : {}),
                  };
                }
                if (activeLanguage === next.sourceLanguage) next.masterUpdatedAt = new Date().toISOString();
              })}
              onCommit={commitCurrent}
              onRemove={() => update((next) => {
                next.items = next.items.filter((entry) => entry.id !== item.id);
                if (sourceComplete) next.masterUpdatedAt = new Date().toISOString();
              }, true)} />
          ))}
          {!typeReadOnly && activeLanguage === screenshotCopy.sourceLanguage && (
            <div className="flex items-center gap-2 bg-zinc-50/60 px-4 py-3 dark:bg-zinc-800/20">
              <input value={newTypeName} onChange={(event) => setNewTypeName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addType(); }} maxLength={100} placeholder="添加截图类型，例如首页、设置页或 HUD" className={cn(inputLineClass, "max-w-sm")} />
              <button type="button" onClick={addType} className={btnSecondary}>＋ 添加类型</button>
            </div>
          )}
          {screenshotCopy.items.length === 0 && (typeReadOnly || activeLanguage !== screenshotCopy.sourceLanguage) && <div className="px-4 py-10 text-center text-sm text-zinc-400">尚未添加截图类型。</div>}
        </div>
      </div>

      {!readOnly && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-2">
          {activeLanguage === screenshotCopy.sourceLanguage && !masterConfirmed && screenshotCopy.items.length > 0 && (
            <AIProgressButton onStart={() => void run("generate")} onStop={() => { if (operationId) void (window as any).appilot.ai.cancel(operationId); }} loading={running} progress={progress} idleLabel={sourceComplete ? "重新润色截图母本" : "生成截图母本"} retry={failed} retrying={retrying} />
          )}
          {activeLanguage !== screenshotCopy.sourceLanguage && masterConfirmed && !batchConfirmed && (
            <AIProgressButton onStart={() => void run("translate", activeLanguage)} onStop={() => { if (operationId) void (window as any).appilot.ai.cancel(operationId); }} loading={running} progress={progress} idleLabel={languageComplete(activeLanguage) ? "重新翻译截图文案" : `翻译为${languageLabel(activeLanguage)}`} retry={failed} retrying={retrying} />
          )}
          {activeLanguage !== screenshotCopy.sourceLanguage && !masterConfirmed && (
            <p className="text-xs text-zinc-400 dark:text-zinc-500">先确定截图母本，再翻译其他语言。</p>
          )}
          {!batchConfirmed && <button type="button" onClick={confirmMaster} disabled={masterConfirmed} className={masterConfirmed ? btnSecondary : btnPrimary}>{masterConfirmed ? "截图母本已确定" : "确定截图母本"}</button>}
          <button type="button" onClick={confirmBatch} disabled={!masterConfirmed || batchConfirmed} className={batchConfirmed ? btnSecondary : btnPrimary}>{batchConfirmed ? "截图文案已完成" : "确定整批截图文案"}</button>
        </div>
        {!batchConfirmed && onDelete && <button type="button" onClick={() => { if (window.confirm("删除本版本的全部截图文案？商店文案不会受到影响。")) void onDelete(); }} className={btnSmSecondary}>删除截图文案</button>}
      </div>}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
