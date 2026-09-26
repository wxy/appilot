import { useEffect, useMemo, useRef, useState } from "react";
import type { KeynoteScreenshotTheme, ScreenshotCopySet, ScreenshotImageAsset, ScreenshotMaterialItem } from "@appilot-labs/appilot-core/screenshot-material";
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
    keynoteLayoutAssignments: { ...(value.keynoteLayoutAssignments || {}) },
    keynoteThemeAssignments: { ...(value.keynoteThemeAssignments || {}) },
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
  const [previewChecked, setPreviewChecked] = useState(false);
  useEffect(() => {
    let active = true;
    setPreview("");
    setPreviewChecked(false);
    if (!asset?.path) {
      setPreviewChecked(true);
      return () => { active = false; };
    }
    void (window as any).appilot.release.screenshotImagePreview(asset.path)
      .then((value: string | null) => { if (active) { setPreview(value || ""); setPreviewChecked(true); } })
      .catch(() => { if (active) { setPreview(""); setPreviewChecked(true); } });
    return () => { active = false; };
  }, [asset?.path, asset?.selectedAt]);
  const authorizePreview = async () => {
    if (!asset?.path) return;
    try {
      const authorized = await (window as any).appilot.release.authorizeScreenshotImagePreview(asset.path);
      if (!authorized) return;
      const value = await (window as any).appilot.release.screenshotImagePreview(asset.path);
      setPreview(value || "");
    } catch {
      setPreview("");
    }
  };
  const canAuthorize = Boolean(disabled && asset?.path && previewChecked && !preview);
  return (
    <button
      type="button"
      onClick={canAuthorize ? () => void authorizePreview() : onSelect}
      disabled={disabled && !canAuthorize}
      aria-label={canAuthorize ? "选择原截图以授权预览" : asset ? "更换截图图片" : "选择截图图片"}
      className={cn(
        "group relative flex aspect-[9/16] w-full items-center justify-center overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40 dark:border-zinc-700 dark:bg-zinc-800",
        disabled && !canAuthorize ? "cursor-default" : "cursor-pointer hover:border-amber-400 dark:hover:border-amber-500",
      )}
    >
      {preview ? <img src={preview} alt="截图预览" className={cn("h-full w-full object-contain transition", inherited && "grayscale opacity-55")} /> : <span className="px-3 text-center text-xs text-zinc-400">{asset ? !previewChecked ? "加载预览…" : canAuthorize ? "点击选择原图以授权预览" : "图片无法预览 · 点击重新选择" : "点击选择本地图片"}</span>}
      {(!disabled || canAuthorize) && <span className="absolute inset-x-2 bottom-2 rounded-md bg-black/65 px-2 py-1.5 text-center text-[11px] text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus:opacity-100">{canAuthorize ? "选择原截图" : asset ? "点击更换图片" : "点击选择图片"}</span>}
    </button>
  );
}

function ScreenshotCard({ item, language, sourceLanguage, textReadOnly, imageReadOnly, typeReadOnly, themes, themeId, layoutName, layoutReadOnly, onThemeChange, onLayoutChange, onChange, onImageChange, onError, onCommit, onRemove }: {
  item: ScreenshotMaterialItem;
  language: string;
  sourceLanguage: string;
  textReadOnly: boolean;
  imageReadOnly: boolean;
  typeReadOnly: boolean;
  themes: KeynoteScreenshotTheme[];
  themeId: string;
  layoutName: string;
  layoutReadOnly: boolean;
  onThemeChange: (themeId: string, defaultLayout: string) => void;
  onLayoutChange: (layoutName: string) => void;
  onChange: (field: "name" | "title" | "description", value: string) => void;
  onImageChange: (asset?: ScreenshotImageAsset) => Promise<void> | void;
  onError: (message: string) => void;
  onCommit: () => void;
  onRemove: () => void;
}) {
  const copy = item.copies[language] || { title: "", description: "" };
  const canEditType = language === sourceLanguage && !typeReadOnly;
  const override = language === sourceLanguage ? undefined : item.imageOverrides?.[language];
  const image = screenshotImageForLanguage(item, language, sourceLanguage);
  const inherited = language !== sourceLanguage && !override && Boolean(item.sourceImage);
  const selectedTheme = themes.find((theme) => theme.id === themeId) || null;
  const layouts = selectedTheme?.layouts.map((layout) => layout.name) || [];
  const selectImage = async () => {
    try {
      const asset = await (window as any).appilot.release.selectScreenshotImage();
      if (asset) await onImageChange(asset);
    } catch (cause: any) {
      onError(cause?.message || "选择截图图片失败。");
    }
  };
  return (
    <article className="flex min-w-0 flex-col rounded-xl border border-zinc-200 bg-white p-3.5 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-zinc-500 dark:text-zinc-400">{item.name}</span>
        {canEditType && (
          <button type="button" onClick={onRemove} className="h-7 w-7 shrink-0 rounded text-xs text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30" aria-label="删除截图类型" title="删除截图类型">×</button>
        )}
      </div>
      <label className="mb-3 block space-y-1">
        <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Keynote 截图套件</span>
        <select
          value={themeId}
          disabled={layoutReadOnly}
          onChange={(event) => {
            const nextTheme = themes.find((theme) => theme.id === event.target.value);
            onThemeChange(event.target.value, nextTheme?.layouts.length === 1 ? nextTheme.layouts[0].name : "");
          }}
          className={cn(inputLineClass, "w-full", !themeId && "text-amber-700 dark:text-amber-300")}
        >
          <option value="">请选择截图套件</option>
          {themeId && !themes.some((theme) => theme.id === themeId) && <option value={themeId}>原套件已不存在</option>}
          {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
        </select>
      </label>
      <label className="mb-3 block space-y-1">
        <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Keynote 版式</span>
        <select
          value={layoutName}
          disabled={layoutReadOnly || !themeId}
          onChange={(event) => onLayoutChange(event.target.value)}
          className={cn(inputLineClass, "w-full", !layoutName && "text-amber-700 dark:text-amber-300")}
        >
          <option value="">请选择版式</option>
          {layoutName && !layouts.includes(layoutName) && <option value={layoutName}>{layoutName}（套件中已不存在）</option>}
          {layouts.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <label className="mb-3 block space-y-1">
        <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">截图类型名称</span>
        {canEditType ? (
          <input value={item.name} onChange={(event) => onChange("name", event.target.value)} onBlur={onCommit} maxLength={100} className={cn(inputLineClass, "min-w-0 flex-1")} />
        ) : (
          <p className="min-w-0 truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">{item.name}</p>
        )}
      </label>
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
            <span>截图 <span className="text-violet-600 dark:text-violet-400">（appilot.image）</span></span>
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

export function ScreenshotMaterialsPanel({ projectId, productId, draftId, value, supportedLanguages, defaultSourceLanguage, readOnly = false, allowArtifactGeneration = false, onChange, onCommit, onGenerated, onDelete }: {
  projectId?: string;
  productId?: string;
  draftId?: string;
  value?: ScreenshotCopySet | null;
  supportedLanguages: string[];
  defaultSourceLanguage: string;
  readOnly?: boolean;
  /** 文案只读时仍可选择模板并生成 Keynote/PNG；模板路径不属于冻结内容。 */
  allowArtifactGeneration?: boolean;
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
  const [newTypeThemeId, setNewTypeThemeId] = useState("");
  const [newTypeLayoutName, setNewTypeLayoutName] = useState("");
  const [themes, setThemes] = useState<KeynoteScreenshotTheme[]>([]);
  const [themeLoading, setThemeLoading] = useState(Boolean(projectId));
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [operationId, setOperationId] = useState("");
  const activeOperationIdRef = useRef("");
  const [progress, setProgress] = useState<{ chars: number; phase: "reasoning" | "content" } | null>(null);
  const [error, setError] = useState("");
  const [artifactRunning, setArtifactRunning] = useState(false);
  const [artifactResult, setArtifactResult] = useState("");

  useEffect(() => {
    let active = true;
    setThemes([]);
    if (!projectId || !productId) {
      setThemeLoading(false);
      return () => { active = false; };
    }
    setThemeLoading(true);
    void (window as any).appilot.release.getScreenshotThemes(projectId, productId)
      .then((value: KeynoteScreenshotTheme[]) => { if (active) setThemes(Array.isArray(value) ? value : []); })
      .catch((cause: unknown) => {
        if (!active) return;
        setThemes([]);
        setError(`读取 Keynote 截图套件失败：${cause instanceof Error ? cause.message : String(cause)}`);
      })
      .finally(() => { if (active) setThemeLoading(false); });
    return () => { active = false; };
  }, [projectId, productId]);

  useEffect(() => {
    const selectedTheme = themes.find((theme) => theme.id === newTypeThemeId)
      || (themes.length === 1 ? themes[0] : null);
    if (selectedTheme && selectedTheme.id !== newTypeThemeId) setNewTypeThemeId(selectedTheme.id);
    const names = selectedTheme?.layouts.map((layout) => layout.name) || [];
    if (!names.includes(newTypeLayoutName)) {
      const defaultLayout = names.length === 1 ? names[0] : "";
      setNewTypeLayoutName(defaultLayout);
      setNewTypeName((current) => current.trim() ? current : defaultLayout);
    }
  }, [themes.map((theme) => `${theme.id}:${theme.inspectedAt}`).join("|")]);

  const chooseTheme = async (): Promise<KeynoteScreenshotTheme | null> => {
    if (!projectId || !productId) return null;
    setError("");
    try {
      const selected = await (window as any).appilot.release.selectKeynoteTemplate(projectId, productId);
      if (!selected) return null;
      setThemes((current) => current.some((theme) => theme.id === selected.id)
        ? current.map((theme) => theme.id === selected.id ? selected : theme)
        : [...current, selected]);
      setNewTypeThemeId(selected.id);
      setArtifactResult("");
      return selected;
    } catch (reason: any) {
      setError(reason?.message || "Keynote 截图主题检测失败。");
      return null;
    }
  };

  const removeTheme = async (themeId: string) => {
    if (!projectId || !productId) return;
    await (window as any).appilot.release.removeScreenshotTheme(projectId, productId, themeId);
    setThemes((current) => current.filter((theme) => theme.id !== themeId));
    setArtifactResult("");
  };

  useEffect(() => {
    if (!normalizedValue) return;
    if (!normalizedValue.selectedLanguages.includes(activeLanguage)) setActiveLanguage(normalizedValue.sourceLanguage);
  }, [normalizedValue?.sourceLanguage, normalizedValue?.selectedLanguages.join("|"), activeLanguage]);

  useEffect(() => {
    const off = (window as any).appilot?.release?.onGenerateProgress?.((event: any) => {
      if (!running || !activeOperationIdRef.current || event?.operationId !== activeOperationIdRef.current) return;
      if (event?.kind === "retry") setRetrying(true);
      if (event?.kind === "chars" && typeof event.chars === "number") setProgress({ chars: event.chars, phase: event.phase === "content" ? "content" : "reasoning" });
    });
    return () => off?.();
  }, [running]);

  if (!normalizedValue) {
    if (readOnly) return <div className="rounded-xl border border-zinc-200 px-4 py-10 text-center text-sm text-zinc-400 dark:border-zinc-800">这份版本没有创建截图文案。</div>;
    const create = async () => {
      if (themes.length === 0 && !await chooseTheme()) return;
      const next: ScreenshotCopySet = { sourceLanguage: fixedSourceLanguage, selectedLanguages: languages.length ? languages : [fixedSourceLanguage], masterUpdatedAt: "", items: [], updatedAt: new Date().toISOString() };
      onChange?.(next);
      await onCommit?.(next);
    };
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 px-6 py-12 text-center dark:border-zinc-700">
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">本版本尚未创建截图文案</p>
        <p className="mx-auto mt-1 max-w-lg text-xs text-zinc-400 dark:text-zinc-500">先为当前平台添加至少一个 Keynote 截图套件，再为每种截图绑定套件与版式。</p>
        <button type="button" onClick={() => void create()} disabled={themeLoading} className={cn(btnPrimary, "mt-4")}>{themeLoading ? "正在读取截图套件…" : themes.length > 0 ? "创建截图文案" : "添加截图套件并创建"}</button>
        {error && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    );
  }

  const screenshotCopy = normalizedValue;
  const masterConfirmed = Boolean(screenshotCopy.masterConfirmedAt);
  const batchConfirmed = Boolean(screenshotCopy.batchConfirmedAt);
  const update = (mutate: (next: ScreenshotCopySet) => void, commit = false) => {
    if (running) return screenshotCopy;
    const next = cloneSet(screenshotCopy);
    mutate(next);
    next.updatedAt = new Date().toISOString();
    onChange?.(next);
    if (commit) void onCommit?.(next);
    return next;
  };
  const commitCurrent = () => {
    if (running) return;
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
  const allTextReady = screenshotCopy.selectedLanguages.every(languageComplete);
  const missingImagePageCount = screenshotCopy.selectedLanguages.reduce(
    (count, language) => count + screenshotCopy.items.filter(
      (item) => !screenshotImageForLanguage(item, language, screenshotCopy.sourceLanguage),
    ).length,
    0,
  );
  const fieldReadOnly = readOnly
    || batchConfirmed
    || (!masterConfirmed && activeLanguage !== screenshotCopy.sourceLanguage)
    || (masterConfirmed && activeLanguage === screenshotCopy.sourceLanguage);
  const typeReadOnly = readOnly || masterConfirmed || batchConfirmed;
  const selectedNewTheme = themes.find((theme) => theme.id === newTypeThemeId) || null;
  const newTypeLayoutNames = selectedNewTheme?.layouts.map((layout) => layout.name) || [];

  const addType = () => {
    const name = newTypeName.trim();
    if (!name) return setError("请先输入截图类型名称。");
    if (!newTypeThemeId) return setError("请先为截图类型选择 Keynote 截图套件。");
    if (!newTypeLayoutName) return setError("请先为截图类型选择 Keynote 版式。");
    setError("");
    update((next) => {
      const id = globalThis.crypto?.randomUUID?.() || `screenshot-${Date.now()}-${next.items.length}`;
      next.items.push({ id, name, copies: {} });
      next.keynoteThemeAssignments = { ...(next.keynoteThemeAssignments || {}), [id]: newTypeThemeId };
      next.keynoteLayoutAssignments = { ...(next.keynoteLayoutAssignments || {}), [id]: newTypeLayoutName };
      next.masterUpdatedAt = new Date().toISOString();
      delete next.masterConfirmedAt;
      delete next.batchConfirmedAt;
    }, true);
    const nextDefaultTheme = themes.length === 1 ? themes[0] : null;
    const nextDefaultLayout = nextDefaultTheme?.layouts.length === 1 ? nextDefaultTheme.layouts[0].name : "";
    setNewTypeThemeId(nextDefaultTheme?.id || "");
    setNewTypeLayoutName(nextDefaultLayout);
    setNewTypeName(nextDefaultLayout);
  };

  const run = async (mode: "generate" | "translate", targetLanguage = "") => {
    if (!projectId || !draftId || running) return;
    if (mode === "generate" && screenshotCopy.items.length === 0) return setError("请先添加截图类型。");
    setError(""); setRunning(true); setFailed(false); setRetrying(false); setProgress(null);
    const id = globalThis.crypto?.randomUUID?.() || `screenshot-ai-${Date.now()}`;
    activeOperationIdRef.current = id;
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
      activeOperationIdRef.current = "";
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
    if (missingTranslations.length > 0) return setError(`还有 ${missingTranslations.length} 个截图语言尚未翻译。`);
    if (missingImagePageCount > 0) return setError(`还有 ${missingImagePageCount} 个语言截图尚未选择。`);
    setError("");
    update((next) => { next.batchConfirmedAt = new Date().toISOString(); }, true);
  };
  const generatedLanguages = screenshotCopy.selectedLanguages.filter(languageComplete);
  const tabLanguages = [...screenshotCopy.selectedLanguages].sort((a, b) =>
    languageLabel(a).localeCompare(languageLabel(b), "zh-CN"),
  );
  const activeImages = screenshotCopy.items.filter((item) => screenshotImageForLanguage(item, activeLanguage, screenshotCopy.sourceLanguage));
  const activeOverrides = activeLanguage === screenshotCopy.sourceLanguage
    ? activeImages.length
    : screenshotCopy.items.filter((item) => item.imageOverrides?.[activeLanguage]).length;
  const missingLayoutCount = screenshotCopy.items.filter((item) => {
    const assignedThemeId = screenshotCopy.keynoteThemeAssignments?.[item.id] || (themes.length === 1 ? themes[0].id : "");
    const assignedTheme = themes.find((theme) => theme.id === assignedThemeId);
    const assigned = screenshotCopy.keynoteLayoutAssignments?.[item.id] || "";
    return !assignedTheme || !assigned || !assignedTheme.layouts.some((layout) => layout.name === assigned);
  }).length;
  const keynoteReady = themes.length > 0 && allTextReady && missingImagePageCount === 0 && missingLayoutCount === 0;
  const generateArtifacts = async () => {
    if (!projectId || !draftId || themes.length === 0 || artifactRunning) return;
    setError(""); setArtifactResult(""); setArtifactRunning(true);
    try {
      await onCommit?.(screenshotCopy);
      const result = await (window as any).appilot.release.generateScreenshotArtifacts(projectId, draftId);
      if (result?.artifacts?.length) {
        setArtifactResult(`已按 ${result.artifacts.length} 个套件生成 ${result.pageCount} 页：${result.artifacts.map((item: any) => `${item.themeName} → ${item.outputPath}`).join("；")}`);
      }
    } catch (reason: any) {
      setError(reason?.message || "截图成品生成失败。");
    } finally {
      setArtifactRunning(false);
    }
  };
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3.5 dark:border-zinc-700 dark:bg-zinc-800/20">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h4 className="text-xs font-medium text-zinc-600 dark:text-zinc-300">当前平台的截图套件</h4>
            <p className="mt-1 break-all text-xs text-zinc-400 dark:text-zinc-500">
              {themes.length > 0 ? `已配置 ${themes.length} 个 Keynote 文件；不同画布尺寸分别生成。` : "尚未添加 Keynote 截图套件"}
            </p>
          </div>
          {(!readOnly || allowArtifactGeneration) && <button type="button" onClick={() => void chooseTheme()} disabled={running} className={btnSecondary}>＋ 添加 Keynote 套件</button>}
        </div>
        {themes.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{themes.map((theme) => <div key={theme.id} className="rounded-lg border border-zinc-200 bg-white p-2.5 dark:border-zinc-700 dark:bg-zinc-900"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-200">{theme.name}</p><p className="mt-0.5 truncate text-[10px] text-zinc-400" title={theme.templatePath}>{theme.templatePath}</p><p className="mt-1 text-[10px] text-emerald-600 dark:text-emerald-400">✓ {theme.layouts.length} 个版式</p></div>{(!readOnly || allowArtifactGeneration) && <button type="button" disabled={running} onClick={() => void removeTheme(theme.id)} className="shrink-0 text-xs text-zinc-400 hover:text-red-600">移除</button>}</div></div>)}</div>}
      </section>
      <div>
        <LanguageTabs languages={tabLanguages} activeLanguage={activeLanguage} onSelect={setActiveLanguage} generatedLanguages={generatedLanguages} />
        <div className="overflow-hidden rounded-lg border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900">
          <div className="space-y-3 p-4">
          {!typeReadOnly && activeLanguage === screenshotCopy.sourceLanguage && (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50/60 p-4 dark:border-zinc-700 dark:bg-zinc-800/20">
              <div className="grid gap-3 sm:max-w-xl">
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Keynote 截图套件</span>
                  <select
                    value={newTypeThemeId}
                    onChange={(event) => {
                      const nextTheme = themes.find((theme) => theme.id === event.target.value) || null;
                      setNewTypeThemeId(event.target.value);
                      const defaultLayout = nextTheme?.layouts.length === 1 ? nextTheme.layouts[0].name : "";
                      setNewTypeLayoutName(defaultLayout);
                      setNewTypeName((current) => !current.trim() || current === newTypeLayoutName ? defaultLayout : current);
                    }}
                    disabled={themes.length === 0 || running}
                    className={cn(inputLineClass, "w-full")}
                  >
                    <option value="">选择 Keynote 截图套件</option>
                    {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">版式</span>
                  <select
                    value={newTypeLayoutName}
                    onChange={(event) => {
                      const nextLayout = event.target.value;
                      const previousLayout = newTypeLayoutName;
                      setNewTypeLayoutName(nextLayout);
                      setNewTypeName((current) => !current.trim() || current === previousLayout ? nextLayout : current);
                    }}
                    disabled={!selectedNewTheme || running}
                    className={cn(inputLineClass, "w-full")}
                  >
                    <option value="">选择 Keynote 版式</option>
                    {newTypeLayoutNames.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">截图类型名称</span>
                  <input value={newTypeName} onChange={(event) => setNewTypeName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addType(); }} disabled={running} maxLength={100} placeholder="选择版式后默认使用版式名称" className={cn(inputLineClass, "w-full")} />
                  <span className="block text-[11px] text-zinc-400 dark:text-zinc-500">名称会作为 AI 理解这张截图内容的语义，请尽量描述画面重点。</span>
                </label>
                <div><button type="button" onClick={addType} disabled={running} className={btnSecondary}>＋ 添加类型</button></div>
              </div>
            </div>
          )}
        {screenshotCopy.items.length > 0 && <div className="flex items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400">
          <span>当前语言图片 {activeImages.length}/{screenshotCopy.items.length}</span>
          {activeLanguage !== screenshotCopy.sourceLanguage && <span>{activeOverrides} 张本地化，{activeImages.length - activeOverrides} 张继承母本</span>}
        </div>}
        <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {screenshotCopy.items.map((item) => (
            <ScreenshotCard key={`${activeLanguage}:${item.id}`} item={item} language={activeLanguage} sourceLanguage={screenshotCopy.sourceLanguage} textReadOnly={fieldReadOnly || running} imageReadOnly={readOnly || batchConfirmed || running} typeReadOnly={typeReadOnly || running}
              themes={themes} themeId={screenshotCopy.keynoteThemeAssignments?.[item.id] || (themes.length === 1 ? themes[0].id : "")} layoutName={screenshotCopy.keynoteLayoutAssignments?.[item.id] || ""} layoutReadOnly={running || themes.length === 0 || (readOnly && !allowArtifactGeneration)}
              onThemeChange={(themeId, defaultLayout) => update((next) => {
                next.keynoteThemeAssignments = { ...(next.keynoteThemeAssignments || {}), [item.id]: themeId };
                next.keynoteLayoutAssignments = { ...(next.keynoteLayoutAssignments || {}), [item.id]: defaultLayout };
              }, true)}
              onLayoutChange={(layoutName) => update((next) => {
                next.keynoteLayoutAssignments = { ...(next.keynoteLayoutAssignments || {}), [item.id]: layoutName };
              }, true)}
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
              onImageChange={async (asset) => {
                if (!projectId || !draftId) return;
                setError("");
                try {
                  // Save only the selected image against the newest persisted
                  // draft. A dialog opened before translation must not write
                  // a stale whole-copy snapshot after translation completes.
                  const saved = await (window as any).appilot.release.saveScreenshotImage(
                    projectId, draftId, item.id, activeLanguage, asset ?? null,
                  );
                  onGenerated?.(saved);
                } catch (cause: any) {
                  setError(cause?.message || "截图图片保存失败。");
                }
              }}
              onError={setError}
              onCommit={commitCurrent}
              onRemove={() => update((next) => {
                next.items = next.items.filter((entry) => entry.id !== item.id);
                next.keynoteThemeAssignments = { ...(next.keynoteThemeAssignments || {}) };
                delete next.keynoteThemeAssignments[item.id];
                next.keynoteLayoutAssignments = { ...(next.keynoteLayoutAssignments || {}) };
                delete next.keynoteLayoutAssignments[item.id];
                next.masterUpdatedAt = new Date().toISOString();
                delete next.masterConfirmedAt;
                delete next.batchConfirmedAt;
              }, true)} />
          ))}
        </div>
          {screenshotCopy.items.length === 0 && (typeReadOnly || activeLanguage !== screenshotCopy.sourceLanguage) && <div className="rounded-xl border border-zinc-200 px-4 py-10 text-center text-sm text-zinc-400 dark:border-zinc-700">尚未添加截图类型。</div>}
          </div>
        </div>
      </div>

      {!readOnly && <section className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3.5 dark:border-zinc-700 dark:bg-zinc-800/20">
        <h4 className="mb-2.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">文案操作</h4>
        <div className="flex flex-wrap items-center gap-2">
          {activeLanguage === screenshotCopy.sourceLanguage && screenshotCopy.items.length > 0 && (
            <AIProgressButton onStart={() => void run("generate")} onStop={() => { if (operationId) void (window as any).appilot.ai.cancel(operationId); }} loading={running} progress={progress} disabled={masterConfirmed || batchConfirmed} idleLabel={sourceComplete ? "重新润色截图文本" : "生成截图文本"} retry={failed} retrying={retrying} />
          )}
          {activeLanguage !== screenshotCopy.sourceLanguage && masterConfirmed && (
            <AIProgressButton onStart={() => void run("translate", activeLanguage)} onStop={() => { if (operationId) void (window as any).appilot.ai.cancel(operationId); }} loading={running} progress={progress} disabled={batchConfirmed} idleLabel={languageComplete(activeLanguage) ? "重新翻译截图文案" : `翻译为${languageLabel(activeLanguage)}`} retry={failed} retrying={retrying} />
          )}
          {activeLanguage !== screenshotCopy.sourceLanguage && !masterConfirmed && (
            <p className="text-xs text-zinc-400 dark:text-zinc-500">先确定截图母本，再翻译其他语言。</p>
          )}
          <button type="button" onClick={confirmMaster} disabled={running || masterConfirmed || batchConfirmed} className={masterConfirmed ? btnSecondary : btnPrimary}>{masterConfirmed ? "截图母本已锁定" : "锁定截图母本并开始翻译"}</button>
          <button type="button" onClick={confirmBatch} disabled={running || !masterConfirmed || batchConfirmed} className={batchConfirmed ? btnSecondary : btnPrimary}>{batchConfirmed ? "截图文案已定稿" : "定稿本批截图文案"}</button>
          {onDelete && !masterConfirmed && <button type="button" disabled={running} onClick={() => { if (window.confirm("删除本版本的全部截图文案？商店文案不会受到影响。")) void onDelete(); }} className={cn(btnSecondary, "border-red-200 text-red-600 hover:border-red-300 hover:bg-red-50 dark:border-red-900/70 dark:text-red-400 dark:hover:bg-red-950/30")}>删除截图文案</button>}
        </div>
      </section>}
      {(!readOnly || allowArtifactGeneration) && <section className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3.5 dark:border-zinc-700 dark:bg-zinc-800/20">
        <h4 className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">成品生成</h4>
        <div className="grid items-center gap-2 pt-2.5 sm:grid-cols-[180px_minmax(0,1fr)]">
          <button type="button" onClick={() => void generateArtifacts()} disabled={running || !keynoteReady || artifactRunning} className={cn(btnPrimary, "w-full justify-center")}>{artifactRunning ? "正在生成…" : "生成 Keynote 及图片"}</button>
          {artifactResult
            ? <p className="min-w-0 break-all text-xs text-emerald-600 dark:text-emerald-400">{artifactResult}</p>
            : !keynoteReady
              ? <p className="text-xs text-amber-600 dark:text-amber-400">{themes.length === 0 ? "请先为当前平台添加截图套件。" : missingLayoutCount > 0 ? `仍有 ${missingLayoutCount} 个截图类型未绑定有效套件与版式。` : !allTextReady ? "仍有语言文案未完成。" : `仍缺少 ${missingImagePageCount} 个语言截图。`}</p>
              : <p className="text-xs text-zinc-400 dark:text-zinc-500">每个套件分别在其模板目录生成 Keynote 和 PNG。</p>}
        </div>
      </section>}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
