import type { AIProvider } from "./ai-provider";
import type { ReleaseInfo } from "../release-watcher";
import type { StoreSubmissionContent, StoreSubmissionLocalization } from "../store-submission";
import { requestJson, buildArchiveMessages } from "./ai-request";
import type { ProjectProfile } from "../project-profile";
import { EngineError } from "../errors";
import { log } from "../logger";

export interface ReleaseReview {
  summary: string;
  descriptionSuggestions: string[];
  keywordSuggestions: string[];
  promotionAngles: string[];
}

/** 目标语言全称（提示词里用全称重复强调，降低模型回显母本的概率）。 */
const LANGUAGE_NAMES: Record<string, string> = {
  en: "English (English)",
  de: "German (Deutsch)",
  fr: "French (Français)",
  es: "Spanish (Español)",
  it: "Italian (Italiano)",
  nl: "Dutch (Nederlands)",
  pt: "Portuguese (Português)",
  "pt-BR": "Brazilian Portuguese (Português do Brasil)",
  ja: "Japanese (日本語)",
  ko: "Korean (한국어)",
  "zh-Hans": "Simplified Chinese (简体中文)",
  "zh-Hant": "Traditional Chinese (繁體中文)",
  ru: "Russian (Русский)",
};

function languageFullName(code: string): string {
  return LANGUAGE_NAMES[code] || code;
}

/** Normalize + clamp an AI-generated localization into the store field limits. */
export function normalizeLocalizedStoreCopy(
  raw: any,
  language: string,
  fallbackName = "",
): StoreSubmissionLocalization {
  return {
    language,
    name: clampText(String(raw?.name || fallbackName || ""), 30),
    subtitle: clampText(String(raw?.subtitle || ""), 30),
    promotionalText: clampText(ensureQuotePrefix(String(raw?.promotionalText || "").trim()), 170),
    description: clampText(String(raw?.description || ""), 4000),
    whatsNew: clampText(String(raw?.whatsNew || ""), 4000),
    keywords: clampKeywords(String(raw?.keywords || ""), 100),
  };
}

/** 超长时在句子/单词边界截短，避免中间切断；关键词按逗号从尾部舍弃。 */
function clampText(value: string, max: number): string {
  const chars = Array.from(value);
  if (chars.length <= max) return chars.join("").trim();
  const cut = chars.slice(0, max).join("");
  const boundary = Math.max(
    cut.lastIndexOf("。"),
    cut.lastIndexOf("．"),
    cut.lastIndexOf("."),
    cut.lastIndexOf("！"),
    cut.lastIndexOf("!"),
    cut.lastIndexOf("？"),
    cut.lastIndexOf("?"),
    cut.lastIndexOf("；"),
    cut.lastIndexOf(";"),
    cut.lastIndexOf("，"),
    cut.lastIndexOf(","),
    cut.lastIndexOf("、"),
    cut.lastIndexOf(" "),
    cut.lastIndexOf("\n"),
  );
  if (boundary >= max * 0.5) {
    return Array.from(cut.slice(0, boundary + 1)).join("").trimEnd();
  }
  return cut.trimEnd();
}

function clampKeywords(value: string, max: number): string {
  const parts = String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  let out = parts.join(",");
  while (out.length > max && parts.length > 1) {
    parts.pop();
    out = parts.join(",");
  }
  return out.slice(0, max);
}

/**
 * 轻量语言安全网：目标语言明显回显母本/输出错误语言时拒绝保存。
 * 纯确定性字符检查，零 AI 成本；正常翻译不受影响。
 */
export function validateTranslatedCopy(
  localization: StoreSubmissionLocalization,
  targetLanguage: string,
  source: StoreSubmissionLocalization,
): void {
  const compact = (value: any) =>
    String(value || "").replace(/\s+/g, "").trim();
  const sample = [
    localization.name,
    localization.subtitle,
    localization.description,
    localization.whatsNew,
    localization.keywords,
  ].map(compact).join("");
  const sourceSample = [
    source.name,
    source.subtitle,
    source.description,
    source.whatsNew,
    source.keywords,
  ].map(compact).join("");
  if (sample && sample === sourceSample) {
    throw new EngineError(
      `翻译结果与母本相同（疑似未翻译），请重试。`,
      "AI_BAD_TRANSLATION",
    );
  }
  const hanCount = (sample.match(/\p{Script=Han}/gu) || []).length;
  const totalChars = sample.length;
  const isCjkTarget = ["zh-Hans", "zh-Hant", "ja"].includes(targetLanguage);
  if (!isCjkTarget && totalChars > 0 && hanCount / totalChars > 0.3) {
    throw new EngineError(
      `翻译结果包含大量中文字符（疑似回显母本），请重试。`,
      "AI_BAD_TRANSLATION",
    );
  }
  const requiredScript: Record<string, RegExp> = {
    ru: /\p{Script=Cyrillic}/u,
    ko: /\p{Script=Hangul}/u,
    ja: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u,
    "zh-Hans": /\p{Script=Han}/u,
    "zh-Hant": /\p{Script=Han}/u,
  };
  const hint = requiredScript[targetLanguage];
  if (hint && !hint.test(sample)) {
    throw new EngineError(
      `翻译结果缺少目标语言的文字（疑似输出为源语言），请重试。`,
      "AI_BAD_TRANSLATION",
    );
  }
  if (!hint && totalChars > 0 && !/\p{Script=Latin}/u.test(sample)) {
    throw new EngineError(
      `翻译结果疑似未使用目标语言，请重试。`,
      "AI_BAD_TRANSLATION",
    );
  }
}

/** Promotional text is shown above the description; prefix it with "> " so it
 *  reads as the indented intro line instead of a description heading marker. */
function ensureQuotePrefix(text: string): string {
  if (!text) return "";
  return text.startsWith("> ") ? text : `> ${text}`;
}

export async function reviewRelease(
  provider: AIProvider,
  context: {
    name: string;
    description: string;
    keywords: string[];
    recentRankings: { keyword: string; storefront: string; rank: number | null; checkedAt: string }[];
    release: ReleaseInfo;
    profile?: ProjectProfile;
  },
): Promise<ReleaseReview> {
  const messages = buildArchiveMessages(
    context.profile,
    [
      "You are Appilot's release analyst. Given an app and its new release, produce an ASO and promotion review.",
      "Respond ONLY with JSON in this shape:",
      '{"summary":"...","descriptionSuggestions":["..."],"keywordSuggestions":["..."],"promotionAngles":["..."]}',
      "summary should be written in Chinese. Keep the other arrays concise and actionable.",
    ].join("\n"),
    [
      `App name: ${context.name}`,
      `Current description: ${context.description || "N/A"}`,
      `Tracked keywords: ${context.keywords.join(", ") || "N/A"}`,
      `Recent rankings: ${context.recentRankings
        .map((item) => `${item.keyword}@${item.storefront}:${item.rank ?? "not ranked"}`)
        .join(", ") || "N/A"}`,
      `Release tag: ${context.release.tag}`,
      `Release name: ${context.release.name || context.release.tag}`,
      `Published at: ${context.release.publishedAt}`,
      `Release body:\n${context.release.body || "N/A"}`,
    ],
  );

  const data = await requestJson(provider, messages, {
    temperature: 0.4,
    maxTokens: 8000,
    thinking: "low",
  });

  return {
    summary: String(data.summary || "").trim(),
    descriptionSuggestions: Array.isArray(data.descriptionSuggestions)
      ? data.descriptionSuggestions.map((item: any) => String(item).trim()).filter(Boolean).slice(0, 8)
      : [],
    keywordSuggestions: Array.isArray(data.keywordSuggestions)
      ? data.keywordSuggestions.map((item: any) => String(item).trim()).filter(Boolean).slice(0, 12)
      : [],
    promotionAngles: Array.isArray(data.promotionAngles)
      ? data.promotionAngles.map((item: any) => String(item).trim()).filter(Boolean).slice(0, 8)
      : [],
  };
}

export async function generateStoreSubmissionContent(
  provider: AIProvider,
  context: {
    name: string;
    description: string;
    language: string;
    trackedKeywords: string[];
    currentSubmissionKeywords: { language: string; text: string }[];
    recentRankings: { keyword: string; storefront: string; rank: number | null; checkedAt: string }[];
    release: ReleaseInfo;
    reviewFeedback?: string;
    baseLocalization?: StoreSubmissionLocalization;
    previousDescription?: string;
    previousLocalization?: StoreSubmissionLocalization;
    profile?: ProjectProfile;
    includedChanges?: string[];
    /** 文案缺口关键词：排名不佳但产品相关、当前文案未覆盖，需自然融入。 */
    copyGapKeywords?: string[];
  },
  onProgress?: (event: { language: string; status: "started" | "completed" }) => void,
  onChars?: (received: { chars: number; phase: "reasoning" | "content" }) => void,
  signal?: AbortSignal,
): Promise<StoreSubmissionContent> {
  const primaryLanguage = context.language || "en";

  onProgress?.({ language: "global", status: "started" });
  const globalPlan = await generateGlobalReleasePlan(provider, context, onChars, signal);
  onProgress?.({ language: "global", status: "completed" });
  const localizations: StoreSubmissionLocalization[] = [];

  onProgress?.({ language: primaryLanguage, status: "started" });
  const primaryLocalization = context.baseLocalization && context.reviewFeedback
    ? await reviseLocalizedStoreCopy(provider, context, primaryLanguage, context.baseLocalization, onChars, signal)
    : await generateLocalizedStoreCopy(provider, context, primaryLanguage, onChars, signal);
  onProgress?.({ language: primaryLanguage, status: "completed" });
  localizations.push(primaryLocalization);

  const primary = localizations[0];
  return {
    summary: globalPlan.summary,
    localizations,
    promotionalText: primary.promotionalText,
    whatsNew: primary.whatsNew,
    description: primary.description,
    submissionKeywords: localizations.map((item) => ({
      language: item.language,
      text: item.keywords,
    })),
    promotionAngles: globalPlan.promotionAngles,
  };
}

export async function translateStoreSubmissionContent(
  provider: AIProvider,
  context: {
    name: string;
    profile?: ProjectProfile;
    /** 各语言的跟踪关键词（按语言注入目标语言的词，而不是翻译源词）。 */
    trackedKeywordsByLanguage?: Record<string, string[]>;
    copyGapKeywordsByLanguage?: Record<string, string[]>;
  },
  source: StoreSubmissionLocalization,
  targetLanguages: string[],
  onProgress?: (event: { language: string; status: "started" | "completed" }) => void,
  onChars?: (received: { chars: number; phase: "reasoning" | "content" }) => void,
  signal?: AbortSignal,
): Promise<StoreSubmissionLocalization[]> {
  const translations: StoreSubmissionLocalization[] = [];

  for (const language of targetLanguages) {
    if (language === source.language) continue;
    onProgress?.({ language, status: "started" });
    let translation = await generateTranslatedStoreCopy(
      provider,
      context,
      source,
      language,
      onChars,
      signal,
    );
    // 轻量语言安全网：模型明显回显母本/错误语言时，强制重写一次，
    // 明确告知上次输出是源语言；仍失败才抛出，让用户重试。
    try {
      validateTranslatedCopy(translation, language, source);
    } catch (firstError: any) {
      log.warn(
        `Translation safety net rejected ${language} (${firstError?.message}); forcing a rewrite`,
      );
      translation = await generateTranslatedStoreCopy(
        provider,
        context,
        source,
        language,
        onChars,
        signal,
        true,
      );
      validateTranslatedCopy(translation, language, source);
    }
    onProgress?.({ language, status: "completed" });
    translations.push(translation);
  }

  return translations;
}

async function generateGlobalReleasePlan(
  provider: AIProvider,
  context: {
    name: string;
    description: string;
    trackedKeywords: string[];
    currentSubmissionKeywords: { language: string; text: string }[];
    recentRankings: { keyword: string; storefront: string; rank: number | null; checkedAt: string }[];
    release: ReleaseInfo;
    reviewFeedback?: string;
    previousDescription?: string;
    previousLocalization?: StoreSubmissionLocalization;
    profile?: ProjectProfile;
    copyGapKeywords?: string[];
  },
  onChars?: (received: { chars: number; phase: "reasoning" | "content" }) => void,
  signal?: AbortSignal,
): Promise<{
  summary: string;
  promotionAngles: string[];
}> {
  const messages = buildArchiveMessages(
    context.profile,
    [
      "You are Appilot's release planner.",
      "Given the release announcement and current product context, produce a release summary and promotion angles.",
      "Respond ONLY with JSON in this shape:",
      JSON.stringify(
        {
          summary: "Chinese summary of this release",
          promotionAngles: ["short angle"],
        },
        null,
        2,
      ),
    ].join("\n"),
    [
      `App name: ${context.name}`,
      `Current description: ${context.description || "N/A"}`,
      `Tracked keywords: ${context.trackedKeywords.join(", ") || "N/A"}`,
      context.copyGapKeywords && context.copyGapKeywords.length > 0
        ? `Copy-gap keywords (product-relevant but currently NOT covered by the store copy; weave them naturally into name/subtitle/promotional text/keywords/description where appropriate — do not stack): ${context.copyGapKeywords.join(", ")}`
        : "",
      `Current submission keywords: ${context.currentSubmissionKeywords
        .map((item) => `${item.language}:${item.text}`)
        .join("; ") || "N/A"}`,
      `Recent rankings: ${context.recentRankings
        .map((item) => `${item.keyword}@${item.storefront}:${item.rank ?? "not ranked"}`)
        .join(", ") || "N/A"}`,
      `Release tag: ${context.release.tag}`,
      `Release name: ${context.release.name || context.release.tag}`,
      `Published at: ${context.release.publishedAt}`,
      `Release body:\n${context.release.body || "N/A"}`,
      context.reviewFeedback
        ? `Reviewer feedback / required changes:\n${context.reviewFeedback}`
        : "",
    ],
  );

  const data = await requestJson(provider, messages, {
    temperature: 0.4,
    maxTokens: 8000,
    thinking: "disabled",
    onProgress: onChars,
    signal,
  });

  return {
    summary: String(data.summary || "").trim(),
    promotionAngles: Array.isArray(data.promotionAngles)
      ? data.promotionAngles.map((item: any) => String(item).trim()).filter(Boolean).slice(0, 8)
      : [],
  };
}

async function generateLocalizedStoreCopy(
  provider: AIProvider,
  context: {
    name: string;
    description: string;
    trackedKeywords: string[];
    currentSubmissionKeywords: { language: string; text: string }[];
    recentRankings: { keyword: string; storefront: string; rank: number | null; checkedAt: string }[];
    release: ReleaseInfo;
    reviewFeedback?: string;
    previousDescription?: string;
    previousLocalization?: StoreSubmissionLocalization;
    profile?: ProjectProfile;
    includedChanges?: string[];
    copyGapKeywords?: string[];
  },
  language: string,
  onChars?: (received: { chars: number; phase: "reasoning" | "content" }) => void,
  signal?: AbortSignal,
): Promise<StoreSubmissionLocalization> {
  const messages = buildArchiveMessages(
    context.profile,
    [
      `You are Appilot's App Store localization writer for language: ${language}.`,
      "Respond ONLY with JSON in this shape:",
      JSON.stringify(
        {
          name: "app name with ': short descriptive phrase', max 30 chars",
          subtitle: "short tagline, max 30 chars",
          promotionalText: "'> ' followed by a short promo line, max 170 chars",
          description: "max 4000 characters",
          whatsNew: "max 4000 characters",
          keywords: "comma separated keywords, max 100 chars",
        },
        null,
        2,
      ),
      "ASO: App Store search ranking is driven mainly by the app name, subtitle, and hidden keyword field. Treat them as ONE coherent set:",
      "- `name`: keep the app's brand name verbatim, append a colon and a short descriptive phrase containing high-value search terms (e.g. `GloWalk: Path of Light`). Total ≤30 characters.",
      "- `subtitle`: a compact tagline (≤30 characters) that complements the name and adds searchable terms.",
      "- `keywords`: cover terms NOT already in the name or subtitle (Apple indexes those automatically); prioritize tracked keywords, current rankings, and release features. Total ≤100 characters.",
      "Base the description on the current app description/README context, not only the release announcement.",
      context.includedChanges?.length
        ? "whatsNew 必须严格只包含本次确认的变更项，不得添加未列出的内容，也不得加版本标题。"
        : "Use the release body primarily for whatsNew. For whatsNew, include only user-visible changes and fixes. Do not add a version heading. Do not include deployment, schema, testing, or engineering-only notes.",
      "Keep promotionalText ≤170 characters, keywords ≤100 characters, and description/whatsNew ≤4000 characters.",
    ].join("\n"),
    [
      `Language: ${language}`,
      `App name: ${context.name}`,
      `Current description/README: ${context.description || "N/A"}`,
      context.previousDescription
        ? `Previous release description:\n${context.previousDescription}`
        : "",
      context.previousLocalization
        ? `Previous release ${context.previousLocalization.language} description:\n${context.previousLocalization.description}`
        : "",
      context.previousLocalization?.name || context.previousLocalization?.subtitle
        ? `Previous release ${context.previousLocalization?.language || ""} name:\n${context.previousLocalization?.name || "N/A"}\nPrevious release ${context.previousLocalization?.language || ""} subtitle:\n${context.previousLocalization?.subtitle || "N/A"}`
        : "",
      `Tracked keywords: ${context.trackedKeywords.join(", ") || "N/A"}`,
      context.copyGapKeywords && context.copyGapKeywords.length > 0
        ? `Copy-gap keywords for this language (ranked poorly because the copy does not cover them; weave the most important ones into name/subtitle/promotional text/keywords where natural — do not stack): ${context.copyGapKeywords.join(", ")}`
        : "",
      `Current submission keywords: ${context.currentSubmissionKeywords
        .filter((item: { language: string; text: string }) => item.language === language)
        .map((item: { language: string; text: string }) => item.text)
        .join(", ") || "N/A"}`,
      `Recent rankings: ${context.recentRankings
        .map((item) => `${item.keyword}@${item.storefront}:${item.rank ?? "not ranked"}`)
        .join(", ") || "N/A"}`,
      `Release tag: ${context.release.tag}`,
      `Release name: ${context.release.name || context.release.tag}`,
      ...(context.includedChanges?.length
        ? ["Confirmed changes for this release (whatsNew must ONLY cover these):", ...context.includedChanges.map((change) => `- ${change}`)]
        : []),
      `Release body:\n${context.release.body || "N/A"}`,
      context.reviewFeedback
        ? `Reviewer feedback / required changes:\n${context.reviewFeedback}`
        : "",
    ],
  );

  const data = await requestJson(provider, messages, {
    temperature: 0.4,
    maxTokens: 32000,
    thinking: "disabled",
    onProgress: onChars,
    signal,
  });

  try {
    return normalizeLocalizedStoreCopy(data, language, context.name);
  } catch (err: any) {
    log.warn(`Localized store copy generation failed for ${language}: ${err.message}`);
    throw new EngineError(`AI 无法解析 ${language} 的商店文案，请重试。`, "AI_EMPTY_RESPONSE");
  }
}

async function generateTranslatedStoreCopy(
  provider: AIProvider,
  context: {
    name: string;
    profile?: ProjectProfile;
    trackedKeywordsByLanguage?: Record<string, string[]>;
    copyGapKeywordsByLanguage?: Record<string, string[]>;
  },
  primary: StoreSubmissionLocalization,
  language: string,
  onChars?: (received: { chars: number; phase: "reasoning" | "content" }) => void,
  signal?: AbortSignal,
  forceTargetLanguage = false,
): Promise<StoreSubmissionLocalization> {
  const targetTrackedKeywords = (context.trackedKeywordsByLanguage || {})[language] || [];
  const targetGapKeywords = (context.copyGapKeywordsByLanguage || {})[language] || [];
  const messages = buildArchiveMessages(
    context.profile,
    [
      `You are Appilot's App Store translation assistant. Translate the source localization into language: ${languageFullName(language)} (code ${language}).`,
      "The ENTIRE output must be written in the target language. Never copy or echo the source language text. If the source is Chinese and the target is Russian, the result MUST be Russian in Cyrillic — Chinese output for a non-Chinese target is a failure.",
      forceTargetLanguage
        ? "Your previous attempt returned the SOURCE language text instead of the target language — that is a failure. Rewrite EVERY field entirely in the target language (for Russian: Cyrillic script). Use the source only for meaning; the output must be fully in the target language."
        : "",
      "Keep the meaning and structure consistent with the source.",
      "Respond ONLY with JSON in this shape:",
      JSON.stringify(
        {
          name: "translated app name: short descriptive phrase, max 30 chars",
          subtitle: "translated tagline, max 30 chars",
          promotionalText: "keep the leading '> ' and translate, max 170 chars",
          description: "max 4000 characters",
          whatsNew: "max 4000 characters",
          keywords: "comma separated keywords, max 100 chars",
        },
        null,
        2,
      ),
      "Keep the output concise. Every field MUST fit its limit (name ≤30, subtitle ≤30, promotionalText ≤170, keywords ≤100, description ≤4000, whatsNew ≤4000). Prefer shorter over longer; never pad, repeat, or expand. If content does not fit, cut less important parts instead of exceeding the limit.",
      "Translate `name`, `subtitle`, `promotionalText`, `description`, and `whatsNew` faithfully; keep the brand name verbatim and localize the colon phrase and tagline.",
      "For `keywords`: do NOT translate the source keywords verbatim. Build the target-language keyword set from (1) the translated source keywords that still make sense in this market, (2) the target language's tracked keywords, and (3) the target language's copy-gap keywords. If no tracked/copy-gap keywords exist for the target language, translate or adapt the source keywords into the target language — never keep them in the source language. Keep it ≤100 characters, comma separated.",
      "If the target language has copy-gap keywords (ranked poorly because the current copy does not cover them), weave the most important 1-2 into the name/subtitle/promotional text where natural — do not stack or force them.",
      "After adapting keywords, re-polish the whole set so name + subtitle + keywords stay coherent and read naturally in the target language.",
      "Do not invent new product facts. Translate the provided copy faithfully.",
      "For whatsNew, include only user-visible changes and fixes. Do not add a version heading. Do not include deployment, schema, testing, or engineering-only notes.",
    ].join("\n"),
    [
      `Source language: ${primary.language}`,
      `Target language: ${language}`,
      `App name: ${context.name}`,
      `Source name:\n${primary.name}`,
      `Source subtitle:\n${primary.subtitle}`,
      `Source promotionalText:\n${primary.promotionalText}`,
      `Source description:\n${primary.description}`,
      `Source whatsNew:\n${primary.whatsNew}`,
      `Source keywords:\n${primary.keywords}`,
      targetTrackedKeywords.length > 0
        ? `Tracked keywords (${language}): ${targetTrackedKeywords.join(", ")}`
        : "",
      targetGapKeywords.length > 0
        ? `Copy-gap keywords (${language}, product-relevant but NOT covered by the current copy — incorporate into keywords, and where natural into name/subtitle/promotional text): ${targetGapKeywords.join(", ")}`
        : "",
    ],
  );

  const data = await requestJson(provider, messages, {
    temperature: 0.3,
    maxTokens: 8000,
    thinking: "disabled",
    onProgress: onChars,
    signal,
  });

  try {
    return normalizeLocalizedStoreCopy(data, language, primary.name || context.name);
  } catch (err: any) {
    log.warn(`Translated store copy generation failed for ${language}: ${err.message}`);
    throw new EngineError(`AI 无法解析 ${language} 的翻译文案，请重试。`, "AI_EMPTY_RESPONSE");
  }
}

async function reviseLocalizedStoreCopy(
  provider: AIProvider,
  context: {
    name: string;
    description: string;
    trackedKeywords: string[];
    currentSubmissionKeywords: { language: string; text: string }[];
    recentRankings: { keyword: string; storefront: string; rank: number | null; checkedAt: string }[];
    release: ReleaseInfo;
    reviewFeedback?: string;
    profile?: ProjectProfile;
  },
  language: string,
  base: StoreSubmissionLocalization,
  onChars?: (received: { chars: number; phase: "reasoning" | "content" }) => void,
  signal?: AbortSignal,
): Promise<StoreSubmissionLocalization> {
  const messages = buildArchiveMessages(
    context.profile,
    [
      `You are Appilot's App Store localization rewriter for language: ${language}.`,
      "Revise the existing copy according to the reviewer/author feedback while preserving its structure and formatting.",
      "Respond ONLY with JSON in this shape:",
      JSON.stringify(
        {
          name: "app name with ': short descriptive phrase', max 30 chars",
          subtitle: "short tagline, max 30 chars",
          promotionalText: "keep the leading '> ' if present, max 170 chars",
          description: "max 4000 characters",
          whatsNew: "max 4000 characters",
          keywords: "comma separated keywords, max 100 chars",
        },
        null,
        2,
      ),
      "Revise `name`, `subtitle`, and `keywords` together so they stay a coherent ASO set (name+subtitle+keywords). Keep the brand name verbatim.",
      "Do not discard the existing structure or section markers.",
      "For whatsNew, include only user-visible changes and fixes. Do not add a version heading. Do not include deployment, schema, testing, or engineering-only notes.",
    ].join("\n"),
    [
      `Language: ${language}`,
      `App name: ${context.name}`,
      `Existing name:\n${base.name}`,
      `Existing subtitle:\n${base.subtitle}`,
      `Existing promotionalText:\n${base.promotionalText}`,
      `Existing description:\n${base.description}`,
      `Existing whatsNew:\n${base.whatsNew}`,
      `Existing keywords:\n${base.keywords}`,
      context.reviewFeedback
        ? `Reviewer feedback / required changes:\n${context.reviewFeedback}`
        : "",
      `Release body:\n${context.release.body || "N/A"}`,
    ],
  );

  const data = await requestJson(provider, messages, {
    temperature: 0.3,
    maxTokens: 16000,
    thinking: "disabled",
    onProgress: onChars,
    signal,
  });

  try {
    return normalizeLocalizedStoreCopy(data, language, base.name || context.name);
  } catch (err: any) {
    log.warn(`Revised store copy generation failed for ${language}: ${err.message}`);
    throw new EngineError(`AI 无法解析 ${language} 的修订文案，请重试。`, "AI_EMPTY_RESPONSE");
  }
}
