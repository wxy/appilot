/**
 * Overview AI brief: generate ≤3 actionable suggestions from real app data.
 */

import type { AIProvider, ChatMessage } from "./ai-provider";
import { parseJsonObject, requestJson, buildArchiveMessages } from "./ai-request";
import type { OverviewBriefInput } from "../overview-summary";
import { EngineError } from "../errors";
import { log } from "../logger";

export type BriefAction = "keywords" | "release" | "trend";

export interface BriefSuggestion {
  id: string;
  title: string;
  reason: string;
  action: BriefAction;
  target: string | null;
}

export function briefSuggestionId(title: string, action: BriefAction, target: unknown): string {
  let hash = 5381;
  const input = `${title}\u0000${action}\u0000${target ?? ""}`;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return `brief-${hash.toString(36)}`;
}

const BRIEF_ACTIONS: BriefAction[] = ["keywords", "release", "trend"];

export function parseBriefSuggestions(raw: string): BriefSuggestion[] {
  return normalizeBriefSuggestions(parseJsonObject(raw));
}

export function normalizeBriefSuggestions(data: any): BriefSuggestion[] {
  const list = Array.isArray(data.suggestions) ? data.suggestions : [];
  const suggestions: BriefSuggestion[] = [];
  for (const item of list.slice(0, 3)) {
    if (!item || typeof item.title !== "string" || !item.title.trim()) continue;
    const action: BriefAction = BRIEF_ACTIONS.includes(item.action) ? item.action : "keywords";
    const title = item.title.trim();
    suggestions.push({
      id: briefSuggestionId(title, action, item.target),
      title,
      reason: String(item.reason || "").trim(),
      action,
      target: typeof item.target === "string" && item.target ? item.target : null,
    });
  }
  return suggestions;
}

export function buildBriefMessages(input: OverviewBriefInput): ChatMessage[] {
  const { profile, ...taskData } = input;
  const contextLines: string[] = [];
  if (input.feedbackThemes?.length) {
    contextLines.push(`用户反馈主题（${input.feedbackThemes.length} 个）：${JSON.stringify(input.feedbackThemes)}`);
  }
  if (input.competitorDeltas?.length) {
    contextLines.push(`竞品动态：${JSON.stringify(input.competitorDeltas)}`);
  }
  const instruction = contextLines.length > 0
    ? "可在建议中引用用户反馈主题或竞品动态作为依据。"
    : "";
  return buildArchiveMessages(
    profile,
    [
      "你是 Appilot 的运营副驾驶，为独立开发者的 App Store 增长给出简短、可执行的建议。",
      "你只能基于下面给定的真实数据输出建议，reason 必须引用数据，不得编造。",
      "输出一个 JSON 对象：{\"suggestions\":[{\"title\":\"一句话动作\",\"reason\":\"引用数据的依据\",\"action\":\"keywords|release|trend\",\"target\":\"可选辅助信息或 null\"}]}",
      "最多 3 条，按价值排序。action 只能是 keywords、release、trend 之一。title 用中文。",
      instruction,
      ...contextLines,
    ].filter(Boolean).join("\n"),
    [JSON.stringify(taskData, null, 2)],
  );
}

export async function generateOverviewBrief(
  provider: AIProvider,
  input: OverviewBriefInput,
  onProgress?: (received: { chars: number; phase: "reasoning" | "content" }) => void,
): Promise<BriefSuggestion[]> {
  log.info(`Generating overview brief for ${input.name}`);
  const data = await requestJson(provider, buildBriefMessages(input), {
    temperature: 0.3,
    maxTokens: 8000,
    thinking: "disabled",
    onProgress,
  });
  const suggestions = normalizeBriefSuggestions(data);
  if (suggestions.length === 0) {
    throw new EngineError("AI brief returned no suggestions", "BRIEF_EMPTY");
  }
  return suggestions;
}
