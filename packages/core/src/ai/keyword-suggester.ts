/**
 * ASO keyword generation (Phase A step 3).
 *
 * In ONE AI request, generate a tracking keyword set for a target localization:
 * broad terms real users would search (rank observation).
 */

import type { AIProvider } from "./ai-provider";
import { parseJsonObject, requestJson, buildArchiveMessages, MAX_OUTPUT_TOKENS } from "./ai-request";
import type { ProjectProfile } from "../project-profile";
import { log } from "../logger";
import type { RankSnapshotLike } from "../rank-snapshots";

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
  signal?: AbortSignal,
): Promise<KeywordGeneration> {
  log.info(`Generating ASO keywords for ${context.name} (${context.language})`);

  const messages = buildArchiveMessages(
    context.profile,
    [
      "You are Appilot's ASO keyword analyst. In ONE response, generate a tracking keyword set for the target localization language:",
      "1. `tracking`: realistic SEARCH PHRASES (2-4 words, spaces allowed) a user would type and this app could plausibly rank for. If the target localization is English, return 10-20 English phrases with `language` set to 'en'. Otherwise return 8-12 phrases in the target localization language and 8-12 English phrases, each item marked with its own `language` field. Prefer specific product phrases, category+function phrases, and use-case phrases. Avoid single generic words like 'ai', 'code', or 'tracker' unless part of a longer phrase. Do not include competitor brand names.",
      "Each tracking term needs a `language`, a `keyword`, a `translation` of that keyword into the UI language, and a `rationale` written in the UI language.",
      'Respond ONLY with a JSON object in this exact shape:',
      '{"tracking":[{"language":"zh-Hans","keyword":"...","translation":"...","rationale":"..."},{"language":"en","keyword":"...","translation":"...","rationale":"..."}]}',
    ].join("\n"),
    [
      `Submission keywords: ${(context.submissionKeywords || []).join(", ") || "N/A"}`,
      `Existing tracked keywords (do not repeat): ${(context.existingKeywords || [])
        .map((item) => item.keyword)
        .join(", ") || "N/A"}`,
      `Removed keywords (do not re-suggest): ${(context.removedKeywords || []).join(", ") || "N/A"}`,
      `Target localization (keywords must be in this language): ${context.language}`,
      `UI language (write the rationale in this language): ${context.uiLanguage}`,
    ],
    [
      `App name: ${context.name}`,
      `App subtitle: ${context.subtitle || "N/A"}`,
      `Platform: ${context.productType}`,
      `Description: ${context.description || "N/A"}`,
    ],
  );

  try {
    const data = await requestJson(provider, messages, {
      temperature: 0.4,
      maxTokens: MAX_OUTPUT_TOKENS,
      thinking: "low",
      retryWithoutThinking: true,
      onProgress,
      signal,
    });
    return normalizeKeywordGeneration(data, context.language);
  } catch (err: any) {
    // 用户主动取消：原样上抛，渲染层按「已取消」静默处理。
    if (err?.code === "AI_CANCELLED" || String(err?.message || "").includes("已取消")) throw err;
    log.warn(
      `Keyword generation failed for ${context.name}: ${err.message}`,
    );
    throw new Error("AI 关键词响应无法解析，请重试。");
  }
}

/**
 * 母本本地化：把英文（全局）母本关键词集改写为目标语言的搜索短语。
 * 与 generateKeywords 的“从零头脑风暴”不同，这里以母本为基准一一对应：
 * 输出更小更快，各语言词表天然对齐（同一套搜索意图），英文短语不再被
 * 每种语言重复生成一遍。
 */
export async function localizeKeywords(
  provider: AIProvider,
  context: {
    name: string;
    subtitle?: string;
    description: string;
    productType: string;
    language: string;
    uiLanguage: string;
    /** 英文（全局）母本关键词集，本地化的基准。 */
    masterKeywords: { keyword: string; translation?: string }[];
    existingKeywords?: { keyword: string }[];
    removedKeywords?: string[];
    profile?: ProjectProfile;
  },
  onProgress?: (received: { chars: number; phase: "reasoning" | "content" }) => void,
  signal?: AbortSignal,
): Promise<KeywordGeneration> {
  log.info(
    `Localizing ASO keywords for ${context.name} (${context.language}) from ${context.masterKeywords.length} masters`,
  );

  const messages = buildArchiveMessages(
    context.profile,
    [
      "You are Appilot's ASO keyword localizer. The app already tracks a master set of English (global) search phrases. Localize that master set into the target localization language.",
      "1. `tracking`: for EACH master phrase, give the search phrase a real user of the target locale would type (2-4 words, spaces allowed). Keep the same search intent — do not invent unrelated phrases. You may DROP a master phrase only when it makes no sense for this locale, and add at most 3 locale-specific variant phrases users there would actually type.",
      "Each item needs a `language` (the target localization language), a `keyword` in the target language, a `translation` of that keyword into the UI language, and a `rationale` written in the UI language (mention which master phrase it maps to).",
      "Do not repeat existing or removed keywords. Do not include competitor brand names. Keep total items close to the master count (at most master count + 3).",
      'Respond ONLY with a JSON object in this exact shape:',
      '{"tracking":[{"language":"de","keyword":"...","translation":"...","rationale":"..."}]}',
    ].join("\n"),
    [
      `Target localization (keywords must be in this language): ${context.language}`,
      `UI language (write the translation and rationale in this language): ${context.uiLanguage}`,
      `Master phrases (localize each one; format: keyword | UI-language gloss):\n${context.masterKeywords
        .map((k) => `${k.keyword}${k.translation ? ` | ${k.translation}` : ""}`)
        .join("\n") || "N/A"}`,
      `Existing tracked keywords in this language (do not repeat): ${(context.existingKeywords || [])
        .map((item) => item.keyword)
        .join(", ") || "N/A"}`,
      `Removed keywords (do not re-suggest): ${(context.removedKeywords || []).join(", ") || "N/A"}`,
    ],
    [
      `App name: ${context.name}`,
      `App subtitle: ${context.subtitle || "N/A"}`,
      `Platform: ${context.productType}`,
      `Description: ${context.description || "N/A"}`,
    ],
  );

  try {
    const data = await requestJson(provider, messages, {
      temperature: 0.4,
      maxTokens: MAX_OUTPUT_TOKENS,
      thinking: "low",
      retryWithoutThinking: true,
      onProgress,
      signal,
    });
    return normalizeKeywordGeneration(data, context.language);
  } catch (err: any) {
    // 用户主动取消：原样上抛，渲染层按「已取消」静默处理。
    if (err?.code === "AI_CANCELLED" || String(err?.message || "").includes("已取消")) throw err;
    log.warn(
      `Keyword localization failed for ${context.name}: ${err.message}`,
    );
    throw new Error("AI 关键词本地化结果无法解析，请重试。");
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

export interface KeywordCurationEvidence {
  keyword: string;
  language: string;
  bestRank: number | null;
  lastSeenAt: string | null;
  lastCheckedAt: string | null;
  checkCount: number;
  rankedCheckCount: number;
  status: string;
  source: string;
  pendingReview: boolean;
}

/** 仅从当前商店产品的快照取证，避免共享词池中的跨平台排名影响整理。 */
export function buildKeywordCurationEvidence(
  tracked: Array<{
    keyword: string;
    language: string;
    status?: string;
    source?: string;
    pendingPausePlatforms?: string[];
    pausedPlatforms?: string[];
  }>,
  snapshots: RankSnapshotLike[],
  language: string,
  platform: string,
): KeywordCurationEvidence[] {
  const evidence = new Map<string, KeywordCurationEvidence>();
  for (const item of tracked) {
    if (item.language !== language || evidence.has(item.keyword)) continue;
    evidence.set(item.keyword, {
      keyword: item.keyword,
      language,
      bestRank: null,
      lastSeenAt: null,
      lastCheckedAt: null,
      checkCount: 0,
      rankedCheckCount: 0,
      status: item.status === "paused" || (item.pausedPlatforms || []).includes(platform) ? "paused" : "active",
      source: item.source || "unknown",
      pendingReview: (item.pendingPausePlatforms || []).includes(platform),
    });
  }
  for (const snapshot of snapshots) {
    if (snapshot.language !== language) continue;
    const item = evidence.get(snapshot.keyword);
    if (!item) continue;
    item.checkCount += 1;
    if (snapshot.checkedAt && (!item.lastCheckedAt || snapshot.checkedAt > item.lastCheckedAt)) {
      item.lastCheckedAt = snapshot.checkedAt;
    }
    if (snapshot.rank == null) continue;
    item.rankedCheckCount += 1;
    item.bestRank = item.bestRank == null ? snapshot.rank : Math.min(item.bestRank, snapshot.rank);
    if (snapshot.checkedAt && (!item.lastSeenAt || snapshot.checkedAt > item.lastSeenAt)) {
      item.lastSeenAt = snapshot.checkedAt;
    }
  }
  return [...evidence.values()];
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
    existingKeywords: KeywordCurationEvidence[];
    collectionLoad?: { dailyInstances: number; referenceLine: number; costPerKeyword: number };
    submissionKeywords: string[];
    removedKeywords: string[];
    profile?: ProjectProfile;
  },
  onProgress?: (received: { chars: number; phase: "reasoning" | "content" }) => void,
  signal?: AbortSignal,
): Promise<KeywordCuration> {
  const messages = buildArchiveMessages(
    context.profile,
    [
      "You are Appilot's ASO keyword curator. Review the existing tracking keywords for one localization and produce a curated suggestion set.",
      "1. `removals`: suggest low-value EXISTING keywords from the target language for human review, especially when collection load is near/above the reference line. Use the platform-specific check count, ranked check count, recency, and pending-review status as evidence. To reduce active collection load, prioritize weak ACTIVE keywords: paused and pending-review keywords are already excluded from that estimate. A keyword with no/few checks has unknown effectiveness, not proven poor performance. Do not remove a useful app-name, subtitle, or submitted-metadata term solely to make room. Give a short evidence-based reason; if evidence is insufficient, return fewer or no removals.",
      "2. `adds`: NEW keywords to track. Especially track terms that appear in the app name, subtitle, or submission keywords — those are high-value because they verify whether the submitted metadata helps ranking. Also cover high-value scenarios from the description and similar variants of keywords that HAVE ranked before. Never repeat existing or removed keywords.",
      "The collection reference line is advisory, not a cap. Recommend high-value adds even if the projected load exceeds it; never silently discard them. Removal suggestions are optional and require user confirmation.",
      "Keep removals ≤20 and adds ≤30. Do not include competitor brand names.",
      "Respond ONLY with JSON: {\"removals\":[{\"keyword\":\"...\",\"reason\":\"...\"}],\"adds\":[{\"language\":\"...\",\"keyword\":\"...\",\"translation\":\"...\",\"rationale\":\"...\"}]}",
    ].join("\n"),
    [
      `Target localization: ${context.language}`,
      `UI language (write rationale in this language): ${context.uiLanguage}`,
      `Submission keywords: ${context.submissionKeywords.join(", ") || "N/A"}`,
      `Collection load for this platform (estimated daily instances/reference line; each active keyword in target language adds the stated instances): ${context.collectionLoad ? `${context.collectionLoad.dailyInstances}/${context.collectionLoad.referenceLine}; +${context.collectionLoad.costPerKeyword} per keyword` : "unknown"}`,
      `Existing tracked keywords for this platform (keyword|bestRank|rankedChecks/checks|lastSeenAt|lastCheckedAt|status|source|pendingReview):\n${context.existingKeywords
        .map((k) => `${k.keyword}|${k.bestRank ?? "unknown"}|${k.rankedCheckCount}/${k.checkCount}|${k.lastSeenAt ?? "unknown"}|${k.lastCheckedAt ?? "unknown"}|${k.status}|${k.source}|${k.pendingReview}`)
        .join("\n") || "N/A"}`,
      `Removed keywords (do not re-suggest): ${context.removedKeywords.join(", ") || "N/A"}`,
    ],
    [
      `App name: ${context.name}`,
      `App subtitle: ${context.subtitle || "N/A"}`,
      `Description: ${context.description || "N/A"}`,
    ],
  );
  try {
    const data = await requestJson(provider, messages, {
      temperature: 0.4,
      maxTokens: MAX_OUTPUT_TOKENS,
      thinking: "low",
      retryWithoutThinking: true,
      onProgress,
      signal,
    });
    return normalizeKeywordCuration(data, context.language);
  } catch (err: any) {
    // 用户主动取消：原样上抛，渲染层按「已取消」静默处理。
    if (err?.code === "AI_CANCELLED" || String(err?.message || "").includes("已取消")) throw err;
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
  context: {
    name: string;
    subtitle?: string;
    language: string;
    uiLanguage: string;
    profile?: ProjectProfile;
  },
  onProgress?: (received: { chars: number; phase: "reasoning" | "content" }) => void,
  signal?: AbortSignal,
): Promise<SubmissionCandidate[]> {
  const messages = buildArchiveMessages(
    context.profile,
    [
      "You are Appilot's ASO candidate extractor. Extract realistic SEARCH KEYWORDS from the app name and subtitle.",
      "Output candidates as search intents a user would actually type (2-4 words preferred). Mark each with its source: terms derived from the app name → 'name', from the subtitle → 'subtitle'.",
      "Keep candidates ≤20. Do not include competitor brand names. Do not output whole sentences.",
      "Respond ONLY with JSON: {\"candidates\":[{\"keyword\":\"...\",\"source\":\"name|subtitle\",\"rationale\":\"...\"}]}",
    ].join("\n"),
    [
      `Target localization: ${context.language}`,
      `UI language (write rationale in this language): ${context.uiLanguage}`,
    ],
    [
      `App name: ${context.name}`,
      `App subtitle: ${context.subtitle || "N/A"}`,
    ],
  );
  const data = await requestJson(provider, messages, {
    temperature: 0.3,
    maxTokens: 16000,
    thinking: "low",
    onProgress,
    signal,
  });
  return normalizeSubmissionCandidates(data);
}
