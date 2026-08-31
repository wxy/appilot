import type { AIProvider, ChatMessage } from "./ai-provider";
import { parseJsonObject, requestJson, buildArchiveMessages } from "./ai-request";
import type { ProjectProfile } from "../project-profile";
import type { FeedbackItem, FeedbackTheme } from "../feedback-inbox";
import { log } from "../logger";

const MAX_THEMES = 5;

export function buildThemeMessages(
  profile: ProjectProfile | undefined,
  items: FeedbackItem[],
): ChatMessage[] {
  const taskData = items.slice(0, 80).map((item) => ({
    source: item.source,
    title: item.title,
    body: item.body,
    createdAt: item.createdAt,
  }));
  return buildArchiveMessages(
    profile,
    [
      "你是 Appilot 的反馈分析师，把 App Store 评论与 GitHub Issues 聚成「用户一直要什么」的主题。",
      "只基于给定的反馈原文，不得编造证据。",
      '输出一个 JSON 对象：{"themes":[{"title":"一句话主题","evidenceCount":N,"sampleQuotes":["原文引用"],"suggestedKeywords":["建议跟踪关键词"],"suggestedDescriptionAngles":["建议描述角度"],"sourceBreakdown":{"reviews":N,"issues":N}}]}',
      `最多 ${MAX_THEMES} 个主题，按证据数降序。title 用中文。evidenceCount 必须等于 sourceBreakdown.reviews + sourceBreakdown.issues。`,
    ].join("\n"),
    [JSON.stringify(taskData, null, 2)],
  );
}

export function normalizeReviewThemes(data: any): FeedbackTheme[] {
  const list = Array.isArray(data?.themes) ? data.themes : [];
  const themes: FeedbackTheme[] = [];
  for (const item of list.slice(0, MAX_THEMES)) {
    if (!item || typeof item.title !== "string" || !item.title.trim()) continue;
    const reviews = Number(item.sourceBreakdown?.reviews) || 0;
    const issues = Number(item.sourceBreakdown?.issues) || 0;
    const evidenceCount = Number(item.evidenceCount) || reviews + issues;
    if (evidenceCount <= 0) continue;
    themes.push({
      title: item.title.trim(),
      evidenceCount,
      sampleQuotes: Array.isArray(item.sampleQuotes) ? item.sampleQuotes.map(String).slice(0, 5) : [],
      suggestedKeywords: Array.isArray(item.suggestedKeywords) ? item.suggestedKeywords.map(String).slice(0, 8) : [],
      suggestedDescriptionAngles: Array.isArray(item.suggestedDescriptionAngles)
        ? item.suggestedDescriptionAngles.map(String).slice(0, 3)
        : [],
      sourceBreakdown: { reviews, issues },
    });
  }
  return themes;
}

export function parseReviewThemes(raw: string): FeedbackTheme[] {
  return normalizeReviewThemes(parseJsonObject(raw));
}

export async function generateReviewThemes(
  provider: AIProvider,
  profile: ProjectProfile | undefined,
  items: FeedbackItem[],
  onProgress?: (received: { chars: number; phase: "reasoning" | "content" }) => void,
): Promise<FeedbackTheme[]> {
  log.info(`Generating feedback themes for ${items.length} items`);
  const data = await requestJson(provider, buildThemeMessages(profile, items), {
    temperature: 0.3,
    maxTokens: 8000,
    thinking: "disabled",
    onProgress,
  });
  return normalizeReviewThemes(data);
}
