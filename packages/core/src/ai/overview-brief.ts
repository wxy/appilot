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
  const seenActions = new Set<string>();
  for (const item of list) {
    if (suggestions.length >= 3) break;
    if (!item || typeof item.title !== "string" || !item.title.trim()) continue;
    const action: BriefAction = BRIEF_ACTIONS.includes(item.action) ? item.action : "keywords";
    const title = item.title.trim();
    const target = typeof item.target === "string" && item.target ? item.target : null;
    const actionKey = `${action}\u0000${target || title.toLocaleLowerCase()}`;
    if (seenActions.has(actionKey)) continue;
    seenActions.add(actionKey);
    suggestions.push({
      id: briefSuggestionId(title, action, target),
      title,
      reason: String(item.reason || "").trim(),
      action,
      target,
    });
  }
  return suggestions;
}

export function buildBriefMessages(input: OverviewBriefInput): ChatMessage[] {
  const { profile, ...taskData } = input;
  return buildArchiveMessages(
    profile,
    [
      "你是 Appilot 的运营副驾驶，为独立开发者的 App Store 增长给出简短、可执行的建议。",
      "你只能基于下面给定的真实数据输出建议，reason 必须引用数据，不得编造。",
      "detectedIssues 是确定性规则从现有数据中发现的问题。优先处理 high，其次 medium；不要用低价值建议挤占更高优先级问题。",
      "如果 detectedIssues 为空，不要假装发现缺陷；可基于其余数据给出优化建议，并明确这是机会而非已确认问题。",
      "feedbackThemes 和 competitorDeltas 只作为补充依据；竞品更新本身不等于风险。",
      "总览页已经展示关键词数量、排名分布、发布进度、仓库活动、评价和竞品概况。不要复述这些状态，也不要把同一问题拆成多条建议。",
      "每条建议必须代表一个不同的决策：title 直接写下一步动作；reason 只解释为什么现在值得做，最多引用两个关键证据。若只有一个高价值动作，就只输出一条。",
      "输出一个 JSON 对象：{\"suggestions\":[{\"title\":\"一句话动作\",\"reason\":\"引用数据的依据\",\"action\":\"keywords|release|trend\",\"target\":\"可选辅助信息或 null\"}]}",
      "最多 3 条，按价值排序。action 只能是 keywords、release、trend 之一。title 用中文。",
    ].join("\n"),
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
    maxTokens: 2400,
    thinking: "disabled",
    onProgress,
  });
  const suggestions = normalizeBriefSuggestions(data);
  if (suggestions.length === 0) {
    throw new EngineError("AI brief returned no suggestions", "BRIEF_EMPTY");
  }
  return suggestions;
}
