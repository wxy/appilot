/**
 * ASO keyword generation (Phase A step 3).
 *
 * In ONE AI request, generate a tracking keyword set for a target localization:
 * broad terms real users would search (rank observation).
 */

import type { AIProvider, ChatMessage } from "./ai-provider";
import { parseJsonObject, requestJson, MAX_OUTPUT_TOKENS } from "./ai-request";
import type { ProjectProfile } from "../project-profile";
import { profileToPromptBlock } from "../project-profile";
import { log } from "../logger";

export interface KeywordSuggestion {
  language: string;
  keyword: string;
  rationale: string;
  translation: string;
}

export interface KeywordGeneration {
  tracking: KeywordSuggestion[];
}

/** Parse the AI's JSON response into the tracking keyword set. */
export function parseKeywordGeneration(raw: string, fallbackLanguage = "en"): KeywordGeneration {
  return normalizeKeywordGeneration(parseJsonObject(raw), fallbackLanguage);
}

export function normalizeKeywordGeneration(data: any, fallbackLanguage = "en"): KeywordGeneration {
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
    profile?: ProjectProfile;
  },
  onProgress?: (received: { chars: number; phase: "reasoning" | "content" }) => void,
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
        ...(context.profile
          ? [profileToPromptBlock(context.profile), ""]
          : [
              `App name: ${context.name}`,
              `App subtitle: ${context.subtitle || "N/A"}`,
              `Platform: ${context.productType}`,
              `Description: ${context.description || "N/A"}`,
            ]),
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

  try {
    const data = await requestJson(provider, messages, {
      temperature: 0.4,
      maxTokens: MAX_OUTPUT_TOKENS,
      thinking: "low",
      retryWithoutThinking: true,
      onProgress,
    });
    return normalizeKeywordGeneration(data, context.language);
  } catch (err: any) {
    log.warn(
      `Keyword generation failed for ${context.name}: ${err.message}`,
    );
    throw new Error("AI 关键词响应无法解析，请重试。");
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
  return normalizeKeywordCuration(parseJsonObject(raw), fallbackLanguage);
}

export function normalizeKeywordCuration(data: any, fallbackLanguage = "en"): KeywordCuration {
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
    profile?: ProjectProfile;
  },
  onProgress?: (received: { chars: number; phase: "reasoning" | "content" }) => void,
): Promise<KeywordCuration> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You are Appilot's ASO keyword curator. Review the existing tracking keywords for one localization and produce a curated suggestion set.",
        "1. `removals`: keywords that are badly chosen or clearly ineffective. Common reasons: never ranked after many checks, irrelevant to the app, too generic, or competitor brands. Give one short reason each.",
        "2. `adds`: NEW keywords to track. Especially track terms that appear in the app name, subtitle, or submission keywords — those are high-value because they verify whether the submitted metadata helps ranking. Also cover high-value scenarios from the description and similar variants of keywords that HAVE ranked before. Never repeat existing or removed keywords.",
        "Keep removals ≤20 and adds ≤30. Do not include competitor brand names.",
        "Respond ONLY with JSON: {\"removals\":[{\"keyword\":\"...\",\"reason\":\"...\"}],\"adds\":[{\"language\":\"...\",\"keyword\":\"...\",\"translation\":\"...\",\"rationale\":\"...\"}]}",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        ...(context.profile
          ? [profileToPromptBlock(context.profile), ""]
          : [
              `App name: ${context.name}`,
              `App subtitle: ${context.subtitle || "N/A"}`,
              `Description: ${context.description || "N/A"}`,
            ]),
        `Target localization: ${context.language}`,
        `UI language (write rationale in this language): ${context.uiLanguage}`,
        `Submission keywords: ${context.submissionKeywords.join(", ") || "N/A"}`,
        `Existing tracked keywords (keyword|bestRank|lastSeenAt|status):\n${context.existingKeywords
          .map((k) => `${k.keyword}|${k.bestRank ?? "—"}|${k.lastSeenAt ?? "—"}|${k.status}`)
          .join("\n") || "N/A"}`,
        `Removed keywords (do not re-suggest): ${context.removedKeywords.join(", ") || "N/A"}`,
      ].join("\n"),
    },
  ];
  try {
    const data = await requestJson(provider, messages, {
      temperature: 0.4,
      maxTokens: MAX_OUTPUT_TOKENS,
      thinking: "low",
      retryWithoutThinking: true,
      onProgress,
    });
    return normalizeKeywordCuration(data, context.language);
  } catch (err: any) {
    log.warn(
      `Keyword curation failed for ${context.name}: ${err.message}`,
    );
    throw new Error("AI 关键词整理结果无法解析，请重试。");
  }
}

export interface SubmissionCandidate {
  keyword: string;
  source: "name" | "subtitle";
  rationale: string;
}

export function parseSubmissionCandidates(raw: string): SubmissionCandidate[] {
  return normalizeSubmissionCandidates(parseJsonObject(raw));
}

export function normalizeSubmissionCandidates(data: any): SubmissionCandidate[] {
  const candidates = Array.isArray(data.candidates)
    ? data.candidates
        .map((x: any) => ({
          keyword: String(x?.keyword || "").trim(),
          source: x?.source === "subtitle" ? ("subtitle" as const) : ("name" as const),
          rationale: String(x?.rationale || "").trim(),
        }))
        .filter((item: SubmissionCandidate) => item.keyword)
        .slice(0, 20)
    : [];
  return candidates;
}

/** 从名称 / 副标题抽取可作为跟踪候选的搜索意图词。 */
export async function extractSubmissionCandidates(
  provider: AIProvider,
  context: { name: string; subtitle?: string; language: string; uiLanguage: string },
  onProgress?: (received: { chars: number; phase: "reasoning" | "content" }) => void,
): Promise<SubmissionCandidate[]> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You are Appilot's ASO candidate extractor. Extract realistic SEARCH KEYWORDS from the app name and subtitle.",
        "Output candidates as search intents a user would actually type (2-4 words preferred). Mark each with its source: terms derived from the app name → 'name', from the subtitle → 'subtitle'.",
        "Keep candidates ≤20. Do not include competitor brand names. Do not output whole sentences.",
        "Respond ONLY with JSON: {\"candidates\":[{\"keyword\":\"...\",\"source\":\"name|subtitle\",\"rationale\":\"...\"}]}",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `App name: ${context.name}`,
        `App subtitle: ${context.subtitle || "N/A"}`,
        `Target localization: ${context.language}`,
        `UI language (write rationale in this language): ${context.uiLanguage}`,
      ].join("\n"),
    },
  ];
  const data = await requestJson(provider, messages, {
    temperature: 0.3,
    maxTokens: 16000,
    thinking: "low",
    onProgress,
  });
  return normalizeSubmissionCandidates(data);
}
