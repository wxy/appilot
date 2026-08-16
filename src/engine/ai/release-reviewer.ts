import type { AIProvider, ChatMessage } from "./ai-provider";
import type { ReleaseInfo } from "../release-watcher";
import type { StoreSubmissionContent, StoreSubmissionLocalization, TrackingKeywordChange } from "../store-submission";
import { EngineError } from "../errors";
import { log } from "../logger";

export interface ReleaseReview {
  summary: string;
  descriptionSuggestions: string[];
  keywordSuggestions: string[];
  promotionAngles: string[];
}

function parseJson(raw: string): any {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  const candidates = [
    s,
    s.replace(/,\s*([}\]])/g, "$1"),
    s.replace(/}\s*{/g, "},{"),
  ];
  let lastError: any = null;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("JSON parse failed");
}

async function parseJsonWithRepair(provider: AIProvider, raw: string): Promise<any> {
  try {
    return parseJson(raw);
  } catch {
    const repaired = await provider.chat(
      [
        {
          role: "user",
          content: [
            "The following response was supposed to be a single JSON object, but it could not be parsed.",
            "Return ONLY the corrected JSON object. Do not wrap it in markdown. Do not add commentary.",
            raw,
          ].join("\n\n"),
        },
      ],
      {
        temperature: 0,
        maxTokens: 8000,
        thinking: "low",
      },
    );
    return parseJson(repaired);
  }
}

function withDescriptionHeading(description: string): string {
  const marker = "──── 介绍 ────";
  return description.startsWith(marker) ? description : `${marker}\n${description}`;
}

export async function reviewRelease(
  provider: AIProvider,
  context: {
    name: string;
    description: string;
    keywords: string[];
    recentRankings: { keyword: string; storefront: string; rank: number | null; checkedAt: string }[];
    release: ReleaseInfo;
  },
): Promise<ReleaseReview> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You are Appilot's release analyst. Given an app and its new release, produce an ASO and promotion review.",
        "Respond ONLY with JSON in this shape:",
        '{"summary":"...","descriptionSuggestions":["..."],"keywordSuggestions":["..."],"promotionAngles":["..."]}',
        "summary should be written in Chinese. Keep the other arrays concise and actionable.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
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
      ].join("\n"),
    },
  ];

  const raw = await provider.chat(messages, {
    temperature: 0.4,
    maxTokens: 1800,
    thinking: "low",
  });

  try {
    const data = await parseJsonWithRepair(provider, raw);
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
  } catch (err: any) {
    log.warn(`Release review JSON parse failed: ${err.message}\nRaw: ${raw.slice(0, 1000)}`);
    throw new EngineError("AI 无法解析 Release 审核结果，请重试。", "AI_EMPTY_RESPONSE");
  }
}

export async function generateStoreSubmissionContent(
  provider: AIProvider,
  context: {
    name: string;
    description: string;
    languages: string[];
    trackedKeywords: string[];
    currentSubmissionKeywords: { language: string; text: string }[];
    recentRankings: { keyword: string; storefront: string; rank: number | null; checkedAt: string }[];
    release: ReleaseInfo;
    reviewFeedback?: string;
    baseLocalization?: StoreSubmissionLocalization;
  },
  onProgress?: (event: { language: string; status: "started" | "completed" }) => void,
): Promise<StoreSubmissionContent> {
  const languages = context.languages.length > 0 ? context.languages : ["en"];
  const primaryLanguage = languages[0];

  onProgress?.({ language: "global", status: "started" });
  const globalPlan = await generateGlobalReleasePlan(provider, context);
  onProgress?.({ language: "global", status: "completed" });
  const localizations: StoreSubmissionLocalization[] = [];

  onProgress?.({ language: primaryLanguage, status: "started" });
  const primaryLocalization = context.baseLocalization && context.reviewFeedback
    ? await reviseLocalizedStoreCopy(provider, context, primaryLanguage, context.baseLocalization)
    : await generateLocalizedStoreCopy(provider, context, primaryLanguage);
  onProgress?.({ language: primaryLanguage, status: "completed" });
  localizations.push(primaryLocalization);

  for (const language of languages.slice(1)) {
    onProgress?.({ language, status: "started" });
    const localization = await generateTranslatedStoreCopy(
      provider,
      context,
      primaryLocalization,
      language,
    );
    onProgress?.({ language, status: "completed" });
    localizations.push(localization);
  }

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
    trackingKeywordDeltas: globalPlan.trackingKeywordDeltas,
    promotionAngles: globalPlan.promotionAngles,
  };
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
  },
): Promise<{
  summary: string;
  trackingKeywordDeltas: TrackingKeywordChange[];
  promotionAngles: string[];
}> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You are Appilot's release planner.",
        "Given the release announcement and current product context, produce a release summary, keyword deltas, and promotion angles.",
        "Respond ONLY with JSON in this shape:",
        JSON.stringify(
          {
            summary: "Chinese summary of this release",
            trackingKeywordDeltas: [
              {
                language: "en",
                keyword: "night walking",
                direction: "add",
                reason: "short reason",
              },
            ],
            promotionAngles: ["short angle"],
          },
          null,
          2,
        ),
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `App name: ${context.name}`,
        `Current description: ${context.description || "N/A"}`,
        `Tracked keywords: ${context.trackedKeywords.join(", ") || "N/A"}`,
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
      ].join("\n"),
    },
  ];

  const raw = await provider.chat(messages, {
    temperature: 0.4,
    maxTokens: 2000,
    thinking: "low",
  });

  try {
    const data = await parseJsonWithRepair(provider, raw);
    const trackingKeywordDeltas: TrackingKeywordChange[] = Array.isArray(data.trackingKeywordDeltas)
      ? data.trackingKeywordDeltas
          .map((item: any) => ({
            language: String(item?.language || "en").trim(),
            keyword: String(item?.keyword || "").trim(),
            direction: item?.direction === "remove" ? "remove" : "add",
            reason: String(item?.reason || "").trim(),
          }))
          .filter(
            (item: TrackingKeywordChange) =>
              item.language &&
              item.keyword &&
              (item.direction === "add" || item.direction === "remove"),
          )
          .slice(0, 20)
      : [];

    return {
      summary: String(data.summary || "").trim(),
      trackingKeywordDeltas,
      promotionAngles: Array.isArray(data.promotionAngles)
        ? data.promotionAngles.map((item: any) => String(item).trim()).filter(Boolean).slice(0, 8)
        : [],
    };
  } catch (err: any) {
    log.warn(`Global release plan JSON parse failed: ${err.message}\nRaw: ${raw.slice(0, 1000)}`);
    throw new EngineError("AI 无法解析发布计划，请重试。", "AI_EMPTY_RESPONSE");
  }
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
  },
  language: string,
): Promise<StoreSubmissionLocalization> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        `You are Appilot's App Store localization writer for language: ${language}.`,
        "Respond ONLY with JSON in this shape:",
        JSON.stringify(
          {
            promotionalText: "max 170 characters",
            description: "max 4000 characters",
            whatsNew: "max 4000 characters",
            keywords: "comma separated keywords, max 100 chars",
          },
          null,
          2,
        ),
        "Base the description on the current app description/README context, not only the release announcement.",
        "Use the release body primarily for whatsNew.",
        "Keep promotionalText ≤170 characters, keywords ≤100 characters, and description/whatsNew ≤4000 characters.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Language: ${language}`,
        `App name: ${context.name}`,
        `Current description/README: ${context.description || "N/A"}`,
        `Tracked keywords: ${context.trackedKeywords.join(", ") || "N/A"}`,
        `Current submission keywords: ${context.currentSubmissionKeywords
          .filter((item: { language: string; text: string }) => item.language === language)
          .map((item: { language: string; text: string }) => item.text)
          .join(", ") || "N/A"}`,
        `Recent rankings: ${context.recentRankings
          .map((item) => `${item.keyword}@${item.storefront}:${item.rank ?? "not ranked"}`)
          .join(", ") || "N/A"}`,
        `Release tag: ${context.release.tag}`,
        `Release name: ${context.release.name || context.release.tag}`,
        `Release body:\n${context.release.body || "N/A"}`,
        context.reviewFeedback
          ? `Reviewer feedback / required changes:\n${context.reviewFeedback}`
          : "",
      ].join("\n"),
    },
  ];

  const raw = await provider.chat(messages, {
    temperature: 0.4,
    maxTokens: 5000,
    thinking: "low",
  });

  try {
    const data = await parseJsonWithRepair(provider, raw);
    return {
      language,
      promotionalText: String(data.promotionalText || "").trim().slice(0, 170),
      description: withDescriptionHeading(String(data.description || "").trim()).slice(0, 4000),
      whatsNew: String(data.whatsNew || "").trim().slice(0, 4000),
      keywords: String(data.keywords || "").trim().slice(0, 100),
    };
  } catch (err: any) {
    log.warn(`Localized store copy JSON parse failed for ${language}: ${err.message}\nRaw: ${raw.slice(0, 1000)}`);
    throw new EngineError(`AI 无法解析 ${language} 的商店文案，请重试。`, "AI_EMPTY_RESPONSE");
  }
}

async function generateTranslatedStoreCopy(
  provider: AIProvider,
  context: {
    name: string;
    description: string;
    trackedKeywords: string[];
    currentSubmissionKeywords: { language: string; text: string }[];
    recentRankings: { keyword: string; storefront: string; rank: number | null; checkedAt: string }[];
    release: ReleaseInfo;
    reviewFeedback?: string;
  },
  primary: StoreSubmissionLocalization,
  language: string,
): Promise<StoreSubmissionLocalization> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        `You are Appilot's App Store translation assistant. Translate the source localization into language: ${language}.`,
        "Keep the meaning and structure consistent with the source.",
        "Respond ONLY with JSON in this shape:",
        JSON.stringify(
          {
            promotionalText: "max 170 characters",
            description: "max 4000 characters",
            whatsNew: "max 4000 characters",
            keywords: "comma separated keywords, max 100 chars",
          },
          null,
          2,
        ),
        "Do not invent new product facts. Translate the provided copy faithfully.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Source language: ${primary.language}`,
        `Target language: ${language}`,
        `App name: ${context.name}`,
        `Source promotionalText:\n${primary.promotionalText}`,
        `Source description:\n${primary.description}`,
        `Source whatsNew:\n${primary.whatsNew}`,
        `Source keywords:\n${primary.keywords}`,
        context.reviewFeedback
          ? `Reviewer feedback / required changes:\n${context.reviewFeedback}`
          : "",
      ].join("\n"),
    },
  ];

  const raw = await provider.chat(messages, {
    temperature: 0.3,
    maxTokens: 5000,
    thinking: "low",
  });

  try {
    const data = await parseJsonWithRepair(provider, raw);
    return {
      language,
      promotionalText: String(data.promotionalText || "").trim().slice(0, 170),
      description: withDescriptionHeading(String(data.description || "").trim()).slice(0, 4000),
      whatsNew: String(data.whatsNew || "").trim().slice(0, 4000),
      keywords: String(data.keywords || "").trim().slice(0, 100),
    };
  } catch (err: any) {
    log.warn(`Translated store copy JSON parse failed for ${language}: ${err.message}\nRaw: ${raw.slice(0, 1000)}`);
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
  },
  language: string,
  base: StoreSubmissionLocalization,
): Promise<StoreSubmissionLocalization> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        `You are Appilot's App Store localization rewriter for language: ${language}.`,
        "Revise the existing copy according to the reviewer/author feedback while preserving its structure and formatting.",
        "Respond ONLY with JSON in this shape:",
        JSON.stringify(
          {
            promotionalText: "max 170 characters",
            description: "max 4000 characters",
            whatsNew: "max 4000 characters",
            keywords: "comma separated keywords, max 100 chars",
          },
          null,
          2,
        ),
        "Do not discard the existing structure or section markers.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Language: ${language}`,
        `App name: ${context.name}`,
        `Existing promotionalText:\n${base.promotionalText}`,
        `Existing description:\n${base.description}`,
        `Existing whatsNew:\n${base.whatsNew}`,
        `Existing keywords:\n${base.keywords}`,
        context.reviewFeedback
          ? `Reviewer feedback / required changes:\n${context.reviewFeedback}`
          : "",
        `Release body:\n${context.release.body || "N/A"}`,
      ].join("\n"),
    },
  ];

  const raw = await provider.chat(messages, {
    temperature: 0.3,
    maxTokens: 5000,
    thinking: "low",
  });

  try {
    const data = await parseJsonWithRepair(provider, raw);
    return {
      language,
      promotionalText: String(data.promotionalText || "").trim().slice(0, 170),
      description: withDescriptionHeading(String(data.description || "").trim()).slice(0, 4000),
      whatsNew: String(data.whatsNew || "").trim().slice(0, 4000),
      keywords: String(data.keywords || "").trim().slice(0, 100),
    };
  } catch (err: any) {
    log.warn(`Revised store copy JSON parse failed for ${language}: ${err.message}\nRaw: ${raw.slice(0, 1000)}`);
    throw new EngineError(`AI 无法解析 ${language} 的修订文案，请重试。`, "AI_EMPTY_RESPONSE");
  }
}
