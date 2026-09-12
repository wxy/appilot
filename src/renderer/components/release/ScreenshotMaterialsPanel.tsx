import { useEffect, useMemo, useState } from "react";
import type { ScreenshotCopySet, ScreenshotImageAsset, ScreenshotMaterialItem } from "@appilot-labs/appilot-core/screenshot-material";
import {
  normalizeScreenshotCopySet,
  SCREENSHOT_DESCRIPTION_MAX,
  SCREENSHOT_TITLE_MAX,
  screenshotImageForLanguage,
} from "@appilot-labs/appilot-core/screenshot-material";
import { cn } from "../../lib/utils";
import { languageLabel } from "../../lib/format";
import { AIProgressButton } from "../ui/AIProgressButton";
import { CopyableTextInput } from "../ui/CopyFeedback";
import { LanguageTabs } from "./LanguageTabs";
import { btnPrimary, btnSecondary, inputLineClass } from "../ui/styles";

function cloneSet(value: ScreenshotCopySet): ScreenshotCopySet {
  return {
    ...value,
    selectedLanguages: [...value.selectedLanguages],
    items: value.items.map((item) => ({
      ...item,
      copies: { ...item.copies },
      imageOverrides: { ...(item.imageOverrides || {}) },
    })),
  };
}

function ScreenshotPreview({ asset, disabled, inherited, onSelect }: {
  asset?: ScreenshotImageAsset;
  disabled: boolean;
  inherited: boolean;
  onSelect: () => void;
}) {
  const [preview, setPreview] = useState("");
  useEffect(() => {
    let active = true;
    setPreview("");
    if (!asset?.path) return () => { active = false; };
    void (window as any).appilot.release.screenshotImagePreview(asset.path)
      .then((value: string | null) => { if (active) setPreview(value || ""); })
      .catch(() => { if (active) setPreview(""); });
    return () => { active = false; };
  }, [asset?.path, asset?.selectedAt]);
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-label={asset ? "更换截图图片" : "选择截图图片"}
      className={cn(
        "group relative flex aspect-[9/16] w-full items-center justify-center overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40 dark:border-zinc-700 dark:bg-zinc-800",
        disabled ? "cursor-default" : "cursor-pointer hover:border-amber-400 dark:hover:border-amber-500",
      )}
    >
      {preview ? <img src={preview} alt="截图预览" className={cn("h-full w-full object-contain transition", inherited && "grayscale opacity-55")} /> : <span className="px-3 text-center text-xs text-zinc-400">{asset ? "图片无法读取" : "点击选择本地图片"}</span>}
      {!disabled && <span className="absolute inset-x-2 bottom-2 rounded-md bg-black/65 px-2 py-1.5 text-center text-[11px] text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus:opacity-100">{asset ? "点击更换图片" : "点击选择图片"}</span>}
    </button>
  );
}

function ScreenshotCard({ item, language, sourceLanguage, textReadOnly, imageReadOnly, typeReadOnly, onChange, onImageChange, onCommit, onRemove }: {
  item: ScreenshotMaterialItem;
  language: string;
  sourceLanguage: string;
  textReadOnly: boolean;
  imageReadOnly: boolean;
  typeReadOnly: boolean;
  onChange: (field: "name" | "title" | "description", value: string) => void;
  onImageChange: (asset?: ScreenshotImageAsset) => void;
  onCommit: () => void;
  onRemove: () => void;
}) {
  const copy = item.copies[language] || { title: "", description: "" };
  const canEditType = language === sourceLanguage && !typeReadOnly;
  const override = language === sourceLanguage ? undefined : item.imageOverrides?.[language];
  const image = screenshotImageForLanguage(item, language, sourceLanguage);
  const inherited = language !== sourceLanguage && !override && Boolean(item.sourceImage);
  const selectImage = async () => {
    const asset = await (window as any).appilot.release.selectScreenshotImage();
    if (asset) onImageChange(asset);
  };
  return (
    <article className="flex min-w-0 flex-col rounded-xl border border-zinc-200 bg-white p-3.5 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-3 flex min-w-0 items-center gap-2">
        {canEditType ? (
          <input value={item.name} onChange={(event) => onChange("name", event.target.value)} onBlur={onCommit} maxLength={100} className={cn(inputLineClass, "min-w-0 flex-1")} />
        ) : (
          <h4 className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">{item.name}</h4>
        )}
        {canEditType && (
          <button type="button" onClick={onRemove} className="h-7 w-7 shrink-0 rounded text-xs text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30" aria-label="删除截图类型" title="删除截图类型">×</button>
        )}
      </div>
      <div className="space-y-3">
        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">标题 <span className="text-violet-600 dark:text-violet-400">（appilot.title）</span></span>
          <CopyableTextInput copyKey={`screenshot:${language}:${item.id}:title`} aria-label={`${item.name}标题`} value={copy.title} onChange={(event) => onChange("title", event.target.value)} onBlur={onCommit} placeholder={language === sourceLanguage ? "由 AI 生成，也可手工修改" : "尚未翻译"} maxLength={SCREENSHOT_TITLE_MAX} readOnly={textReadOnly} className={cn(inputLineClass, textReadOnly && "cursor-default")} />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">描述 <span className="text-violet-600 dark:text-violet-400">（appilot.description）</span></span>
          <CopyableTextInput copyKey={`screenshot:${language}:${item.id}:description`} aria-label={`${item.name}描述`} value={copy.description} onChange={(event) => onChange("description", event.target.value)} onBlur={onCommit} placeholder={language === sourceLanguage ? "由 AI 生成，也可手工修改" : "尚未翻译"} maxLength={SCREENSHOT_DESCRIPTION_MAX} readOnly={textReadOnly} className={cn(inputLineClass, textReadOnly && "cursor-default")} />
        </label>
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            <span>截图预览 <span className="text-violet-600 dark:text-violet-400">（appilot.image）</span></span>
            <span className="flex shrink-0 items-center gap-1.5">
              {inherited && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">继承</span>}
              {override && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">本语言</span>}
              {!imageReadOnly && language !== sourceLanguage && override && <button type="button" onClick={() => onImageChange(undefined)} className="text-zinc-400 hover:text-amber-700 dark:hover:text-amber-300">继承</button>}
              {!imageReadOnly && language === sourceLanguage && item.sourceImage && <button type="button" onClick={() => onImageChange(undefined)} className="text-zinc-400 hover:text-red-600 dark:hover:text-red-400">移除</button>}
            </span>
          </div>
          <ScreenshotPreview asset={image} disabled={imageReadOnly} inherited={inherited} onSelect={() => void selectImage()} />
          {image && <p className="truncate text-[10px] text-zinc-400" title={image.path}>{image.fileName} · {image.width}×{image.height}</p>}
        </div>
      </div>
    </article>
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
  const [artifactRunning, setArtifactRunning] = useState(false);
  const [artifactResult, setArtifactResult] = useState("");

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
  const fieldReadOnly = readOnly;
  const typeReadOnly = readOnly;

  const addType = () => {
    const name = newTypeName.trim();
    if (!name) return setError("请先输入截图类型名称。");
    setError("");
    update((next) => {
      next.items.push({ id: globalThis.crypto?.randomUUID?.() || `screenshot-${Date.now()}-${next.items.length}`, name, copies: {} });
      next.masterUpdatedAt = new Date().toISOString();
      delete next.masterConfirmedAt;
      delete next.batchConfirmedAt;
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
    if (readOnly || language === screenshotCopy.sourceLanguage) return;
    update((next) => {
      next.selectedLanguages = next.selectedLanguages.includes(language)
        ? next.selectedLanguages.filter((item) => item !== language)
        : languages.filter((item) => [...next.selectedLanguages, language].includes(item));
      delete next.batchConfirmedAt;
    }, true);
  };
  const generatedLanguages = screenshotCopy.selectedLanguages.filter(languageComplete);
  const activeImages = screenshotCopy.items.filter((item) => screenshotImageForLanguage(item, activeLanguage, screenshotCopy.sourceLanguage));
  const activeOverrides = activeLanguage === screenshotCopy.sourceLanguage
    ? activeImages.length
    : screenshotCopy.items.filter((item) => item.imageOverrides?.[activeLanguage]).length;
  const allTextReady = screenshotCopy.selectedLanguages.every(languageComplete);
  const missingImagePageCount = screenshotCopy.selectedLanguages.reduce(
    (count, language) => count + screenshotCopy.items.filter(
      (item) => !screenshotImageForLanguage(item, language, screenshotCopy.sourceLanguage),
    ).length,
    0,
  );
  const keynoteReady = allTextReady && missingImagePageCount === 0;
  const selectKeynoteTemplate = async () => {
    const templatePath = await (window as any).appilot.release.selectKeynoteTemplate();
    if (!templatePath) return;
    update((next) => { next.keynoteTemplatePath = templatePath; }, true);
    setArtifactResult("");
  };
  const generateArtifacts = async () => {
    if (!projectId || !draftId || !screenshotCopy.keynoteTemplatePath || artifactRunning) return;
    setError(""); setArtifactResult(""); setArtifactRunning(true);
    try {
      await onCommit?.(screenshotCopy);
      const result = await (window as any).appilot.release.generateScreenshotArtifacts(projectId, draftId, screenshotCopy.keynoteTemplatePath);
      if (result?.outputPath) setArtifactResult(`已生成 ${result.pageCount} 页；Keynote：${result.outputPath}；PNG：${result.outputDirectory}`);
    } catch (reason: any) {
      setError(reason?.message || "截图成品生成失败。");
    } finally {
      setArtifactRunning(false);
    }
  };
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
                return <button key={language} type="button" onClick={() => toggleLanguage(language)} disabled={readOnly || source} className={cn("rounded-md px-2 py-1.5 text-left text-[11px]", selected ? "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300" : "text-zinc-400 hover:bg-zinc-50 dark:text-zinc-500 dark:hover:bg-zinc-700")}>{source ? "母本 · " : selected ? "✓ " : "○ "}{languageLabel(language)}</button>;
              })}
            </div>
          </details>
        </div>
        <span className={cn("text-xs", batchConfirmed ? "text-emerald-600 dark:text-emerald-400" : masterConfirmed ? "text-amber-600 dark:text-amber-400" : "text-zinc-400")}>{batchConfirmed ? "截图文案已完成" : masterConfirmed ? "截图母本已确定" : "截图母本编辑中"}</span>
      </div>

      <LanguageTabs languages={screenshotCopy.selectedLanguages} activeLanguage={activeLanguage} onSelect={setActiveLanguage} generatedLanguages={generatedLanguages} />
      <div className="space-y-3">
        {screenshotCopy.items.length > 0 && <div className="flex items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400">
          <span>当前语言图片 {activeImages.length}/{screenshotCopy.items.length}</span>
          {activeLanguage !== screenshotCopy.sourceLanguage && <span>{activeOverrides} 张本地化，{activeImages.length - activeOverrides} 张继承母本</span>}
        </div>}
        <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {screenshotCopy.items.map((item) => (
            <ScreenshotCard key={`${activeLanguage}:${item.id}`} item={item} language={activeLanguage} sourceLanguage={screenshotCopy.sourceLanguage} textReadOnly={fieldReadOnly} imageReadOnly={readOnly} typeReadOnly={typeReadOnly}
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
                if (activeLanguage === next.sourceLanguage || field === "name") {
                  next.masterUpdatedAt = new Date().toISOString();
                  delete next.masterConfirmedAt;
                  delete next.batchConfirmedAt;
                } else {
                  delete next.batchConfirmedAt;
                }
              })}
              onImageChange={(asset) => update((next) => {
                const target = next.items.find((entry) => entry.id === item.id);
                if (!target) return;
                if (activeLanguage === next.sourceLanguage) {
                  if (asset) target.sourceImage = asset;
                  else delete target.sourceImage;
                } else {
                  target.imageOverrides = { ...(target.imageOverrides || {}) };
                  if (asset) target.imageOverrides[activeLanguage] = asset;
                  else delete target.imageOverrides[activeLanguage];
                }
              }, true)}
              onCommit={commitCurrent}
              onRemove={() => update((next) => {
                next.items = next.items.filter((entry) => entry.id !== item.id);
                next.masterUpdatedAt = new Date().toISOString();
                delete next.masterConfirmedAt;
                delete next.batchConfirmedAt;
              }, true)} />
          ))}
        </div>
          {!typeReadOnly && activeLanguage === screenshotCopy.sourceLanguage && (
            <div className="flex items-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-zinc-50/60 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800/20">
              <input value={newTypeName} onChange={(event) => setNewTypeName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addType(); }} maxLength={100} placeholder="添加截图类型，例如首页、设置页或 HUD" className={cn(inputLineClass, "max-w-sm")} />
              <button type="button" onClick={addType} className={btnSecondary}>＋ 添加类型</button>
            </div>
          )}
          {screenshotCopy.items.length === 0 && (typeReadOnly || activeLanguage !== screenshotCopy.sourceLanguage) && <div className="rounded-xl border border-zinc-200 px-4 py-10 text-center text-sm text-zinc-400 dark:border-zinc-700">尚未添加截图类型。</div>}
      </div>

      {!readOnly && <section className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3.5 dark:border-zinc-700 dark:bg-zinc-800/20">
        <h4 className="mb-2.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">文案操作</h4>
        <div className="flex flex-wrap items-center gap-2">
          {activeLanguage === screenshotCopy.sourceLanguage && screenshotCopy.items.length > 0 && (
            <AIProgressButton onStart={() => void run("generate")} onStop={() => { if (operationId) void (window as any).appilot.ai.cancel(operationId); }} loading={running} progress={progress} idleLabel={sourceComplete ? "重新润色截图文本" : "生成截图文本"} retry={failed} retrying={retrying} />
          )}
          {activeLanguage !== screenshotCopy.sourceLanguage && masterConfirmed && (
            <AIProgressButton onStart={() => void run("translate", activeLanguage)} onStop={() => { if (operationId) void (window as any).appilot.ai.cancel(operationId); }} loading={running} progress={progress} idleLabel={languageComplete(activeLanguage) ? "重新翻译截图文案" : `翻译为${languageLabel(activeLanguage)}`} retry={failed} retrying={retrying} />
          )}
          {activeLanguage !== screenshotCopy.sourceLanguage && !masterConfirmed && (
            <p className="text-xs text-zinc-400 dark:text-zinc-500">先确定截图母本，再翻译其他语言。</p>
          )}
          {!batchConfirmed && <button type="button" onClick={confirmMaster} disabled={masterConfirmed} className={masterConfirmed ? btnSecondary : btnPrimary}>{masterConfirmed ? "截图文本已确定" : "确定截图文本"}</button>}
          <button type="button" onClick={confirmBatch} disabled={!masterConfirmed || batchConfirmed} className={batchConfirmed ? btnSecondary : btnPrimary}>{batchConfirmed ? "整批文案已确定" : "确定整批文案"}</button>
          {onDelete && <button type="button" onClick={() => { if (window.confirm("删除本版本的全部截图文案？商店文案不会受到影响。")) void onDelete(); }} className={cn(btnSecondary, "border-red-200 text-red-600 hover:border-red-300 hover:bg-red-50 dark:border-red-900/70 dark:text-red-400 dark:hover:bg-red-950/30")}>删除截图文案</button>}
        </div>
      </section>}
      {!readOnly && <section className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3.5 dark:border-zinc-700 dark:bg-zinc-800/20">
        <h4 className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">成品生成</h4>
        <div className="grid items-center gap-2 border-b border-zinc-200/80 py-2.5 sm:grid-cols-[180px_minmax(0,1fr)] dark:border-zinc-700/80">
          <button type="button" onClick={() => void selectKeynoteTemplate()} className={cn(btnSecondary, "w-full justify-center")}>{screenshotCopy.keynoteTemplatePath ? "更换 Keynote 模板" : "选择 Keynote 模板"}</button>
          <p className="min-w-0 break-all text-xs text-zinc-400 dark:text-zinc-500" title={screenshotCopy.keynoteTemplatePath}>{screenshotCopy.keynoteTemplatePath || "选择包含 appilot.screenshot.v1 母板的模板"}</p>
        </div>
        <div className="grid items-center gap-2 pt-2.5 sm:grid-cols-[180px_minmax(0,1fr)]">
          <button type="button" onClick={() => void generateArtifacts()} disabled={!screenshotCopy.keynoteTemplatePath || !keynoteReady || artifactRunning} className={cn(btnPrimary, "w-full justify-center")}>{artifactRunning ? "正在生成…" : "生成 Keynote 及图片"}</button>
          {artifactResult
            ? <p className="min-w-0 break-all text-xs text-emerald-600 dark:text-emerald-400">{artifactResult}</p>
            : !keynoteReady
              ? <p className="text-xs text-amber-600 dark:text-amber-400">{!allTextReady ? "仍有语言文案未完成。" : `仍缺少 ${missingImagePageCount} 个语言截图。`}</p>
              : <p className="text-xs text-zinc-400 dark:text-zinc-500">Keynote 保存在模板同目录，PNG 存入同目录下的新子目录。</p>}
        </div>
      </section>}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
