/**
 * Overview AI brief: generate ≤3 actionable suggestions from real app data.
 */

import type { AIProvider, ChatMessage } from "./ai-provider";
import { parseJsonObject, requestJson, buildArchiveMessages } from "./ai-request";
import type { OverviewBriefInput } from "../overview-summary";
import { EngineError } from "../errors";
import { log } from "../logger";

export type BriefAction = "keywords" | "release" | "trend";
export type BriefCommandKind =
  | "keyword.open"
  | "keyword.pause"
  | "keyword.remove"
  | "keyword.restore"
  | "keyword.resume"
  | "rank.collect"
  | "trend.open"
  | "release.open";

export interface BriefProposedAction {
  id: string;
  kind: BriefCommandKind;
  label: string;
  language: string | null;
  keyword: string | null;
  storefront: string | null;
  requiresConfirmation: boolean;
}

export interface BriefSuggestion {
  id: string;
  title: string;
  reason: string;
  action: BriefAction;
  target: string | null;
  proposedActions: BriefProposedAction[];
}

export interface BriefFollowupResponse {
  answer: string;
  proposedActions: BriefProposedAction[];
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
const BRIEF_COMMANDS: BriefCommandKind[] = [
  "keyword.open", "keyword.pause", "keyword.remove", "keyword.restore",
  "keyword.resume", "rank.collect", "trend.open", "release.open",
];
const CONFIRM_COMMANDS = new Set<BriefCommandKind>([
  "keyword.pause", "keyword.remove", "keyword.restore", "keyword.resume", "rank.collect",
]);

function proposedActionId(kind: BriefCommandKind, language: string | null, keyword: string | null, storefront: string | null): string {
  return briefSuggestionId(kind, "keywords", `${language || ""}\u0000${keyword || ""}\u0000${storefront || ""}`);
}

export function normalizeBriefProposedActions(value: unknown): BriefProposedAction[] {
  if (!Array.isArray(value)) return [];
  const result: BriefProposedAction[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || !BRIEF_COMMANDS.includes((raw as any).kind)) continue;
    const kind = (raw as any).kind as BriefCommandKind;
    const language = typeof (raw as any).language === "string" && (raw as any).language.trim()
      ? (raw as any).language.trim() : null;
    const keyword = typeof (raw as any).keyword === "string" && (raw as any).keyword.trim()
      ? (raw as any).keyword.trim() : null;
    const storefront = typeof (raw as any).storefront === "string" && (raw as any).storefront.trim()
      ? (raw as any).storefront.trim().toLowerCase() : null;
    if (kind.startsWith("keyword.") && kind !== "keyword.open" && (!language || !keyword)) continue;
    if (kind === "rank.collect" && !language) continue;
    const id = proposedActionId(kind, language, keyword, storefront);
    if (seen.has(id)) continue;
    seen.add(id);
    result.push({
      id,
      kind,
      label: typeof (raw as any).label === "string" && (raw as any).label.trim()
        ? (raw as any).label.trim().slice(0, 40)
        : kind,
      language,
      keyword,
      storefront,
      requiresConfirmation: CONFIRM_COMMANDS.has(kind),
    });
    if (result.length >= 5) break;
  }
  return result;
}

export function normalizeBriefFollowupResponse(data: any): BriefFollowupResponse {
  return {
    answer: String(data?.answer || "").trim(),
    proposedActions: normalizeBriefProposedActions(data?.proposedActions),
  };
}

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
      proposedActions: normalizeBriefProposedActions(item.proposedActions),
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
      "keywordInventory 和 keywordRankDetails 是数据库中的关键词级证据。涉及排名时先比较语言、商店和关键词差异；只有确实没有检查记录时，才能判断采集数据缺失。",
      "如果建议能由 Appilot 执行，请提供 proposedActions。允许 kind：keyword.open、keyword.pause、keyword.remove、keyword.restore、keyword.resume、rank.collect、trend.open、release.open。关键词动作必须填写真实存在的 language 和 keyword；rank.collect 必须填写 language，storefront 可选。不要根据不充分证据提出删除。",
      "每条建议必须代表一个不同的决策：title 直接写下一步动作；reason 只解释为什么现在值得做，最多引用两个关键证据。若只有一个高价值动作，就只输出一条。",
      "输出一个 JSON 对象：{\"suggestions\":[{\"title\":\"一句话动作\",\"reason\":\"引用数据的依据\",\"action\":\"keywords|release|trend\",\"target\":\"可选辅助信息或 null\",\"proposedActions\":[{\"kind\":\"keyword.open\",\"label\":\"查看关键词\",\"language\":\"en\",\"keyword\":\"night walk\",\"storefront\":\"us\"}]}]}",
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
