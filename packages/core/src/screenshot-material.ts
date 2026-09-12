import type { AIProvider } from "./ai/ai-provider";
import { buildArchiveMessages, requestJson } from "./ai/ai-request";
import type { ProjectProfile } from "./project-profile";
import { EngineError } from "./errors";

export const SCREENSHOT_TITLE_MAX = 60;
export const SCREENSHOT_DESCRIPTION_MAX = 180;

export interface ScreenshotMaterialCopy {
  title: string;
  description: string;
  /** 母本更新时间；用于判断译文是否仍对应当前母本。 */
  sourceUpdatedAt?: string;
}

export interface ScreenshotImageAsset {
  path: string;
  fileName: string;
  width: number;
  height: number;
  selectedAt: string;
}

export interface ScreenshotMaterialItem {
  id: string;
  name: string;
  copies: Record<string, ScreenshotMaterialCopy>;
  /** 母本语言使用的默认截图。 */
  sourceImage?: ScreenshotImageAsset;
  /** 目标语言的本地化截图；缺省时继承 sourceImage。 */
  imageOverrides?: Record<string, ScreenshotImageAsset>;
}

export function screenshotImageForLanguage(
  item: ScreenshotMaterialItem,
  language: string,
  sourceLanguage: string,
): ScreenshotImageAsset | undefined {
  if (language === sourceLanguage) return item.sourceImage;
  return item.imageOverrides?.[language] || item.sourceImage;
}

/** 截图文案属于某个版本，但拥有独立的母本、语言范围和确认状态。 */
export interface ScreenshotCopySet {
  sourceLanguage: string;
  selectedLanguages: string[];
  masterUpdatedAt: string;
  masterConfirmedAt?: string;
  batchConfirmedAt?: string;
  items: ScreenshotMaterialItem[];
  keynoteTemplatePath?: string;
  updatedAt: string;
}

export interface ScreenshotMaterialDraft {
  projectId: string;
  productId: string;
  sourceLanguage: string;
  masterUpdatedAt: string;
  selectedLanguages: string[];
  items: ScreenshotMaterialItem[];
  updatedAt: string;
}

export function normalizeScreenshotCopySet(
  value: unknown,
  sourceLanguage: string,
  supportedLanguages: string[],
): ScreenshotCopySet {
  const raw = value && typeof value === "object" ? value as any : {};
  const normalized = normalizeScreenshotMaterialDraft(
    value,
    "embedded-release-draft",
    "embedded-release-draft",
    supportedLanguages,
  );
  const source = supportedLanguages.includes(sourceLanguage)
    ? sourceLanguage
    : normalized.sourceLanguage;
  // The first embedded screenshot-copy shape inherited the store copy's full
  // language range and therefore had no selectedLanguages field. Preserve that
  // meaning during migration. A present array, including [source] only, is an
  // explicit selection in the independent workflow.
  const selectedLanguages = Array.isArray(raw.selectedLanguages)
    ? normalized.selectedLanguages
    : supportedLanguages;
  const keepsIndependentConfirmation = Array.isArray(raw.selectedLanguages)
    && String(raw.sourceLanguage || "").trim() === source;
  return {
    sourceLanguage: source,
    selectedLanguages: selectedLanguages.length > 0
      ? Array.from(new Set([source, ...selectedLanguages]))
      : [source],
    masterUpdatedAt: normalized.masterUpdatedAt,
    ...(keepsIndependentConfirmation && String(raw.masterConfirmedAt || "").trim()
      ? { masterConfirmedAt: String(raw.masterConfirmedAt).trim() }
      : {}),
    ...(keepsIndependentConfirmation && String(raw.batchConfirmedAt || "").trim()
      ? { batchConfirmedAt: String(raw.batchConfirmedAt).trim() }
      : {}),
    items: normalized.items,
    ...(String(raw.keynoteTemplatePath || "").trim()
      ? { keynoteTemplatePath: String(raw.keynoteTemplatePath).trim() }
      : {}),
    updatedAt: normalized.updatedAt,
  };
}

function cleanText(value: unknown, max: number): string {
  return Array.from(String(value || "").trim().replace(/\s+/g, " ")).slice(0, max).join("");
}

function normalizeImageAsset(value: unknown): ScreenshotImageAsset | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as any;
  const imagePath = String(raw.path || "").trim();
  if (!imagePath) return undefined;
  return {
    path: imagePath,
    fileName: String(raw.fileName || imagePath.split(/[\\/]/).pop() || "截图").trim(),
    width: Math.max(0, Number(raw.width) || 0),
    height: Math.max(0, Number(raw.height) || 0),
    selectedAt: String(raw.selectedAt || "").trim() || new Date(0).toISOString(),
  };
}

export function normalizeScreenshotMaterialDraft(
  value: unknown,
  projectId: string,
  productId: string,
  supportedLanguages: string[],
): ScreenshotMaterialDraft {
  const raw = value && typeof value === "object" ? value as any : {};
  const supported = new Set(supportedLanguages.map((item) => String(item).trim()).filter(Boolean));
  const selectedLanguages = Array.from(new Set<string>(
    (Array.isArray(raw.selectedLanguages) ? raw.selectedLanguages : [])
      .map((item: unknown) => String(item).trim())
      .filter((item: string) => supported.has(item)),
  ));
  const sourceLanguage = supported.has(String(raw.sourceLanguage || "").trim())
    ? String(raw.sourceLanguage).trim()
    : selectedLanguages[0] || supportedLanguages[0] || "en";
  const seenIds = new Set<string>();
  const items: ScreenshotMaterialItem[] = [];
  for (const [index, entry] of (Array.isArray(raw.items) ? raw.items : []).entries()) {
    if (!entry || typeof entry !== "object") continue;
    let id = String(entry.id || "").trim() || `screenshot-${index + 1}`;
    if (seenIds.has(id)) id = `${id}-${index + 1}`;
    seenIds.add(id);
    const copies: Record<string, ScreenshotMaterialCopy> = {};
    const rawCopies = entry.copies && typeof entry.copies === "object" ? entry.copies : {};
    for (const language of supported) {
      const copy = rawCopies[language];
      if (!copy || typeof copy !== "object") continue;
      copies[language] = {
        title: cleanText(copy.title, SCREENSHOT_TITLE_MAX),
        description: cleanText(copy.description, SCREENSHOT_DESCRIPTION_MAX),
        ...(String(copy.sourceUpdatedAt || "").trim()
          ? { sourceUpdatedAt: String(copy.sourceUpdatedAt).trim() }
          : {}),
      };
    }
    const imageOverrides: Record<string, ScreenshotImageAsset> = {};
    const rawOverrides = entry.imageOverrides && typeof entry.imageOverrides === "object"
      ? entry.imageOverrides
      : {};
    for (const language of supported) {
      if (language === sourceLanguage) continue;
      const asset = normalizeImageAsset(rawOverrides[language]);
      if (asset) imageOverrides[language] = asset;
    }
    const sourceImage = normalizeImageAsset(entry.sourceImage);
    items.push({
      id,
      name: cleanText(entry.name, 100),
      copies,
      ...(sourceImage ? { sourceImage } : {}),
      ...(Object.keys(imageOverrides).length ? { imageOverrides } : {}),
    });
  }
  return {
    projectId,
    productId,
    sourceLanguage,
    masterUpdatedAt: String(raw.masterUpdatedAt || ""),
    selectedLanguages,
    items,
    updatedAt: String(raw.updatedAt || ""),
  };
}

export function screenshotMaterialsForProduct(
  project: { screenshotMaterials?: unknown[] },
  productId: string,
): ScreenshotMaterialDraft | null {
  const item = (project.screenshotMaterials || []).find(
    (entry: any) => String(entry?.productId || "") === productId,
  );
  return item && typeof item === "object" ? item as ScreenshotMaterialDraft : null;
}

export function upsertScreenshotMaterials(
  project: { screenshotMaterials?: unknown[] },
  draft: ScreenshotMaterialDraft,
): void {
  const list = Array.isArray(project.screenshotMaterials)
    ? [...project.screenshotMaterials]
    : [];
  const index = list.findIndex((entry: any) => entry?.productId === draft.productId);
  if (index >= 0) list[index] = draft;
  else list.push(draft);
  project.screenshotMaterials = list;
}

function languageName(code: string): string {
  const names: Record<string, string> = {
    en: "English",
    "zh-Hans": "Simplified Chinese",
    "zh-Hant": "Traditional Chinese",
    de: "German",
    es: "Spanish",
    fr: "French",
    it: "Italian",
    ja: "Japanese",
    ko: "Korean",
    pt: "Portuguese",
    ru: "Russian",
  };
  return names[code] || code;
}

function parseScreenshotCopies(
  data: any,
  screenshots: Array<{ id: string; name: string }>,
  language: string,
): Record<string, ScreenshotMaterialCopy> {
  const rawScreenshots = Array.isArray(data?.screenshots) ? data.screenshots : [];
  const result: Record<string, ScreenshotMaterialCopy> = {};
  for (const screenshot of screenshots) {
    const rawCopy = rawScreenshots.find(
      (entry: any) => String(entry?.id || "").trim() === screenshot.id,
    );
    const title = cleanText(rawCopy?.title, SCREENSHOT_TITLE_MAX);
    const description = cleanText(rawCopy?.description, SCREENSHOT_DESCRIPTION_MAX);
    if (!title || !description) {
      throw new EngineError(
        `AI 没有完整返回 ${language} 的“${screenshot.name}”文案，请重试。`,
        "AI_EMPTY_RESPONSE",
      );
    }
    result[screenshot.id] = { title, description };
  }
  return result;
}

export async function generateScreenshotMaterialMaster(
  provider: AIProvider,
  input: {
    productName: string;
    profile?: ProjectProfile;
    language: string;
    screenshots: Array<{ id: string; name: string }>;
    existing?: Record<string, ScreenshotMaterialCopy>;
    storeMaster?: {
      name?: string;
      subtitle?: string;
      promotionalText?: string;
      description?: string;
      whatsNew?: string;
    };
  },
  options: {
    onProgress?: (received: { chars: number; phase: "reasoning" | "content" }) => void;
    signal?: AbortSignal;
    onRetry?: () => void;
  } = {},
): Promise<Record<string, ScreenshotMaterialCopy>> {
  const language = String(input.language || "").trim();
  const screenshots = input.screenshots
    .map((item) => ({ id: String(item.id || "").trim(), name: String(item.name || "").trim() }))
    .filter((item) => item.id && item.name);
  if (!language) throw new EngineError("请先选择母本语言。", "INVALID_INPUT");
  if (screenshots.length === 0) throw new EngineError("请先添加截图并填写名称。", "INVALID_INPUT");

  const messages = buildArchiveMessages(
    input.profile,
    [
      "You write concise marketing copy that is printed directly onto App Store screenshots.",
      `Write the master screenshot copy entirely in ${languageName(language)} (code ${language}).`,
      "Create a title and description for every screenshot type.",
      "The screenshot type name is an internal description supplied by the user. Use it for meaning; do not mechanically repeat it.",
      "Treat all screenshots as one ordered story: avoid repeated claims, let each screen make one clear point, and never invent product behavior.",
      "Use the project profile as the factual product reference. Claims must be grounded in that profile.",
      "Titles should usually fit on one short line. Descriptions should fit in one or two short lines.",
      `Hard limits: title <= ${SCREENSHOT_TITLE_MAX} characters; description <= ${SCREENSHOT_DESCRIPTION_MAX} characters. Prefer substantially shorter copy.`,
      "Keep the product brand unchanged.",
      'Return ONLY JSON with this shape: {"screenshots":[{"id":"stable-id","title":"...","description":"..."}]}',
    ].join("\n"),
    [
      `Product: ${input.productName}`,
      `Master language: ${language}`,
      "Ordered screenshot types:",
      ...screenshots.map((item, index) => `${index + 1}. id=${item.id}; name=${item.name}`),
      input.existing && Object.keys(input.existing).length > 0
        ? `Existing master copy to polish where useful:\n${JSON.stringify(input.existing)}`
        : "",
      input.storeMaster
        ? `Current release copy for tone and factual consistency:\n${JSON.stringify(input.storeMaster)}`
        : "",
    ],
    [`Product: ${input.productName}`],
  );

  const data = await requestJson(provider, messages, {
    temperature: 0.4,
    maxTokens: 16000,
    thinking: "disabled",
    onProgress: options.onProgress,
    signal: options.signal,
    onRetry: options.onRetry,
  });
  return parseScreenshotCopies(data, screenshots, language);
}

export async function translateScreenshotMaterialMaster(
  provider: AIProvider,
  input: {
    productName: string;
    sourceLanguage: string;
    targetLanguages: string[];
    screenshots: Array<{ id: string; name: string }>;
    source: Record<string, ScreenshotMaterialCopy>;
  },
  options: {
    onProgress?: (received: { chars: number; phase: "reasoning" | "content" }) => void;
    onLanguageProgress?: (event: { language: string; status: "started" | "completed" }) => void;
    signal?: AbortSignal;
    onRetry?: () => void;
  } = {},
): Promise<Record<string, Record<string, ScreenshotMaterialCopy>>> {
  const sourceLanguage = String(input.sourceLanguage || "").trim();
  const targetLanguages = Array.from(new Set(
    input.targetLanguages.map((item) => item.trim()).filter((item) => item && item !== sourceLanguage),
  ));
  const screenshots = input.screenshots
    .map((item) => ({ id: String(item.id || "").trim(), name: String(item.name || "").trim() }))
    .filter((item) => item.id && item.name);
  if (!sourceLanguage) throw new EngineError("找不到母本语言。", "INVALID_INPUT");
  if (screenshots.length === 0) throw new EngineError("请先添加截图类型。", "INVALID_INPUT");
  for (const screenshot of screenshots) {
    if (!input.source[screenshot.id]?.title || !input.source[screenshot.id]?.description) {
      throw new EngineError("请先完整生成母本文案。", "INVALID_INPUT");
    }
  }

  const result: Record<string, Record<string, ScreenshotMaterialCopy>> = {};
  for (const language of targetLanguages) {
    options.onLanguageProgress?.({ language, status: "started" });
    const messages = buildArchiveMessages(
      undefined,
      [
        `Translate the complete ordered App Store screenshot story from ${languageName(sourceLanguage)} (${sourceLanguage}) into ${languageName(language)} (${language}).`,
        "Translate every title and description faithfully. Keep all screenshots coherent as one story and preserve their order.",
        "Write the entire output in the target language, keep the product brand unchanged, and never add product claims absent from the source.",
        `Hard limits: title <= ${SCREENSHOT_TITLE_MAX} characters; description <= ${SCREENSHOT_DESCRIPTION_MAX} characters. Prefer concise natural marketing language.`,
        'Return ONLY JSON with this shape: {"screenshots":[{"id":"stable-id","title":"...","description":"..."}]}',
      ].join("\n"),
      [
        `Product: ${input.productName}`,
        `Source language: ${sourceLanguage}`,
        `Target language: ${language}`,
        "Ordered source screenshot story:",
        ...screenshots.map((item, index) => {
          const copy = input.source[item.id];
          return `${index + 1}. id=${item.id}; type=${item.name}; title=${copy.title}; description=${copy.description}`;
        }),
      ],
      [`Product: ${input.productName}`],
    );
    const data = await requestJson(provider, messages, {
      temperature: 0.3,
      maxTokens: 8000,
      thinking: "disabled",
      onProgress: options.onProgress,
      signal: options.signal,
      onRetry: options.onRetry,
    });
    result[language] = parseScreenshotCopies(data, screenshots, language);
    options.onLanguageProgress?.({ language, status: "completed" });
  }
  return result;
}
