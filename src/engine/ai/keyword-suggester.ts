/**
 * ASO keyword generation (Phase A step 3).
 *
 * In ONE AI request, generate a tracking keyword set for a target localization:
 * broad terms real users would search (rank observation).
 */

import type { AIProvider, ChatMessage } from "./ai-provider";
import { log } from "../logger";
import { EngineError } from "../errors";

export interface KeywordSuggestion {
  language: string;
  keyword: string;
  rationale: string;
  translation: string;
}

export interface KeywordGeneration {
  tracking: KeywordSuggestion[];
}

function parseJsonObject(raw: string): any {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  const repairs = [
    s.replace(/,\s*([}\]])/g, "$1"),
    s.replace(/}\s*{/g, "},{"),
    s.replace(/]\s*\[/g, "],["),
    s.replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3'),
  ];
  let lastError: any = null;
  for (const candidate of repairs) {
    try {
      return JSON.parse(candidate);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("JSON parse failed");
}

async function parseJsonWithRepair(
  provider: AIProvider,
  raw: string,
  onProgress?: (received: { chars: number }) => void,
): Promise<any> {
  try {
    return parseJsonObject(raw);
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
        thinking: "disabled",
        responseFormat: "json_object",
        onProgress,
      },
    );
    return parseJsonObject(repaired);
  }
}

/** Parse the AI's JSON response into the tracking keyword set. */
export function parseKeywordGeneration(raw: string, fallbackLanguage = "en"): KeywordGeneration {
  const data = parseJsonObject(raw);

  const tracking: KeywordSuggestion[] = Array.isArray(data.tracking)
    ? data.tracking
        .filter((x: any) => x && typeof x.keyword === "string" && x.keyword.trim())
        .map((x: any) => ({
          language: String(x.language || fallbackLanguage).trim(),
          keyword: x.keyword.trim(),
          rationale: String(x.rationale || "").trim(),
          translation: String(x.translation || "").trim(),
        }))
        .slice(0, 30)
    : [];

  return { tracking };
}

export async function generateKeywords(
  provider: AIProvider,
  context: {
    name: string;
    subtitle?: string;
    description: string;
    productType: string;
    language: string;
    uiLanguage: string;
    submissionKeywords?: string[];
    existingKeywords?: { keyword: string }[];
    removedKeywords?: string[];
  },
  onProgress?: (received: { chars: number }) => void,
): Promise<KeywordGeneration> {
  log.info(`Generating ASO keywords for ${context.name} (${context.language})`);

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You are Appilot's ASO keyword analyst. In ONE response, generate a tracking keyword set for the target localization language:",
        "1. `tracking`: realistic SEARCH PHRASES (2-4 words, spaces allowed) a user would type and this app could plausibly rank for. If the target localization is English, return 10-20 English phrases with `language` set to 'en'. Otherwise return 8-12 phrases in the target localization language and 8-12 English phrases, each item marked with its own `language` field. Prefer specific product phrases, category+function phrases, and use-case phrases. Avoid single generic words like 'ai', 'code', or 'tracker' unless part of a longer phrase. Do not include competitor brand names.",
        "Each tracking term needs a `language`, a `keyword`, a `translation` of that keyword into the UI language, and a `rationale` written in the UI language.",
        'Respond ONLY with a JSON object in this exact shape:',
        '{"tracking":[{"language":"zh-Hans","keyword":"...","translation":"...","rationale":"..."},{"language":"en","keyword":"...","translation":"...","rationale":"..."}]}',
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `App name: ${context.name}`,
        `App subtitle: ${context.subtitle || "N/A"}`,
        `Platform: ${context.productType}`,
        `Description: ${context.description || "N/A"}`,
        `Submission keywords: ${(context.submissionKeywords || []).join(", ") || "N/A"}`,
        `Existing tracked keywords (do not repeat): ${(context.existingKeywords || [])
          .map((item) => item.keyword)
          .join(", ") || "N/A"}`,
        `Removed keywords (do not re-suggest): ${(context.removedKeywords || []).join(", ") || "N/A"}`,
        `Target localization (keywords must be in this language): ${context.language}`,
        `UI language (write the rationale in this language): ${context.uiLanguage}`,
      ].join("\n"),
    },
  ];

  let raw: string;
  try {
    raw = await provider.chat(messages, {
      temperature: 0.4,
      maxTokens: 8000,
      thinking: "low",
      responseFormat: "json_object",
      onProgress,
    });
  } catch (err) {
    if (err instanceof EngineError && err.code === "AI_EMPTY_RESPONSE") {
      log.warn(
        `Low-thinking keyword generation returned no content for ${context.name}; falling back to disabled thinking`,
      );
      raw = await provider.chat(messages, {
        temperature: 0.4,
        maxTokens: 8000,
        thinking: "disabled",
        responseFormat: "json_object",
        onProgress,
      });
    } else {
      throw err;
    }
  }
  try {
    return parseKeywordGeneration(raw, context.language);
  } catch (err: any) {
    log.warn(
      `Failed to parse keyword generation for ${context.name}: ${err.message}\nRaw response: ${raw.slice(0, 1200)}`,
    );
    try {
      const data = await parseJsonWithRepair(provider, raw, onProgress);
      return parseKeywordGeneration(JSON.stringify(data), context.language);
    } catch (repairErr: any) {
      log.warn(
        `Keyword generation JSON repair failed for ${context.name}: ${repairErr.message}`,
      );
      throw new Error("AI 关键词响应无法解析，请重试。");
    }
  }
}

export interface KeywordCurationRemoval {
  keyword: string;
  reason: string;
}

export interface KeywordCuration {
  removals: KeywordCurationRemoval[];
  adds: KeywordSuggestion[];
}

export function parseKeywordCuration(raw: string, fallbackLanguage = "en"): KeywordCuration {
  const data = parseJsonObject(raw);
  const removals = Array.isArray(data.removals)
    ? data.removals
        .map((item: any) => ({
          keyword: String(item?.keyword || "").trim(),
          reason: String(item?.reason || "").trim(),
        }))
        .filter((item: { keyword: string; reason: string }) => item.keyword)
        .slice(0, 20)
    : [];
  const adds = Array.isArray(data.adds)
    ? data.adds
        .filter((x: any) => x && typeof x.keyword === "string" && x.keyword.trim())
        .map((x: any) => ({
          language: String(x.language || fallbackLanguage).trim(),
          keyword: x.keyword.trim(),
          rationale: String(x.rationale || "").trim(),
          translation: String(x.translation || "").trim(),
        }))
        .slice(0, 30)
    : [];
  return { removals, adds };
}

/** 复盘模式：结合现有跟踪词与观察数据，给出建议移除 / 建议新增。 */
export async function curateKeywords(
  provider: AIProvider,
  context: {
    name: string;
    subtitle?: string;
    description: string;
    language: string;
    uiLanguage: string;
    existingKeywords: { keyword: string; language: string; bestRank: number | null; lastSeenAt: string | null; status: string }[];
    submissionKeywords: string[];
    removedKeywords: string[];
  },
  onProgress?: (received: { chars: number }) => void,
): Promise<KeywordCuration> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You are Appilot's ASO keyword curator. Review the existing tracking keywords for one localization and produce a curated suggestion set.",
        "1. `removals`: keywords that are badly chosen or clearly ineffective. Common reasons: never ranked after many checks, irrelevant to the app, duplicate of the name/subtitle, or too generic. Give one short reason each.",
        "2. `adds`: NEW keywords to track. Cover gaps (name/subtitle/submission-keyword intents), high-value scenarios from the description, and similar variants of keywords that HAVE ranked before. Never repeat existing or removed keywords.",
        "Keep removals ≤20 and adds ≤30. Do not include competitor brand names.",
        "Respond ONLY with JSON: {\"removals\":[{\"keyword\":\"...\",\"reason\":\"...\"}],\"adds\":[{\"language\":\"...\",\"keyword\":\"...\",\"translation\":\"...\",\"rationale\":\"...\"}]}",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `App name: ${context.name}`,
        `App subtitle: ${context.subtitle || "N/A"}`,
        `Target localization: ${context.language}`,
        `UI language (write rationale in this language): ${context.uiLanguage}`,
        `Description: ${context.description || "N/A"}`,
        `Submission keywords: ${context.submissionKeywords.join(", ") || "N/A"}`,
        `Existing tracked keywords (keyword|bestRank|lastSeenAt|status):\n${context.existingKeywords
          .map((k) => `${k.keyword}|${k.bestRank ?? "—"}|${k.lastSeenAt ?? "—"}|${k.status}`)
          .join("\n") || "N/A"}`,
        `Removed keywords (do not re-suggest): ${context.removedKeywords.join(", ") || "N/A"}`,
      ].join("\n"),
    },
  ];
  let raw: string;
  try {
    raw = await provider.chat(messages, {
      temperature: 0.4,
      maxTokens: 8000,
      thinking: "low",
      responseFormat: "json_object",
      onProgress,
    });
  } catch (err) {
    if (err instanceof EngineError && err.code === "AI_EMPTY_RESPONSE") {
      log.warn(
        `Low-thinking keyword curation returned no content for ${context.name}; falling back to disabled thinking`,
      );
      raw = await provider.chat(messages, {
        temperature: 0.4,
        maxTokens: 8000,
        thinking: "disabled",
        responseFormat: "json_object",
        onProgress,
      });
    } else {
      throw err;
    }
  }
  try {
    return parseKeywordCuration(raw, context.language);
  } catch (err: any) {
    log.warn(
      `Failed to parse keyword curation for ${context.name}: ${err.message}\nRaw response: ${raw.slice(0, 1200)}`,
    );
    try {
      const data = await parseJsonWithRepair(provider, raw, onProgress);
      return parseKeywordCuration(JSON.stringify(data), context.language);
    } catch (repairErr: any) {
      log.warn(
        `Keyword curation JSON repair failed for ${context.name}: ${repairErr.message}`,
      );
      throw new Error("AI 关键词整理结果无法解析，请重试。");
    }
  }
}
