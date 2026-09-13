/**
 * Overview AI brief: generate ≤3 actionable suggestions from real app data.
 */

import type { AIProvider, ChatMessage } from "./ai-provider";
import { parseJsonObject, requestJson, buildArchiveMessages } from "./ai-request";
import type { OverviewBriefInput } from "../overview-summary";
import type { ProjectProfile } from "../project-profile";
import { log } from "../logger";
import { normalizeCopyPlanInput } from "../copy-plan";

export type BriefAction = "keywords" | "release" | "trend";
export type BriefCommandKind =
  | "keyword.open"
  | "keyword.track.add"
  | "keyword.pause"
  | "keyword.remove"
  | "keyword.restore"
  | "keyword.resume"
  | "rank.collect"
  | "trend.open"
  | "release.open"
  | "copy-plan.add";

export type BriefActionInput = Record<string, unknown>;

export interface BriefProposedAction {
  id: string;
  kind: BriefCommandKind;
  label: string;
  language: string | null;
  keyword: string | null;
  storefront: string | null;
  input: BriefActionInput;
  requiresConfirmation: boolean;
}

export type EffectiveBriefCommandKind =
  | "keyword.track.add"
  | "keyword.pause"
  | "keyword.remove"
  | "keyword.restore"
  | "keyword.resume"
  | "copy-plan.add";

export interface BriefActionInputSchema {
  type: "object";
  required: string[];
  properties: Record<string, Record<string, unknown>>;
}

export interface BriefActionCapability {
  kind: BriefCommandKind;
  recommendationEligible: boolean;
  execution: "detail" | "confirm" | "task-center";
  appliesTo: "missing" | "active" | "active-or-paused" | "paused" | "removed" | null;
  immediateEffect: string;
  verification: string;
  inputSchema: BriefActionInputSchema;
}

const keywordTargetSchema: BriefActionInputSchema = {
  type: "object",
  required: ["language", "keyword"],
  properties: {
    language: { type: "string", minLength: 1 },
    keyword: { type: "string", minLength: 1 },
  },
};

/**
 * Appilot owns this catalog. AI may select an eligible capability, but cannot
 * invent how it executes or how completion is verified.
 */
export const BRIEF_ACTION_CAPABILITIES: Record<BriefCommandKind, BriefActionCapability> = {
  "keyword.open": {
    kind: "keyword.open",
    recommendationEligible: false,
    execution: "detail",
    appliesTo: null,
    immediateEffect: "只显示关键词信息，不改变任何状态",
    verification: "无需验证",
    inputSchema: keywordTargetSchema,
  },
  "keyword.track.add": {
    kind: "keyword.track.add",
    recommendationEligible: true,
    execution: "confirm",
    appliesTo: "missing",
    immediateEffect: "把新关键词加入跟踪池并纳入后续定时排名采集",
    verification: "关键词出现在活跃跟踪池中，且不存在于已移除记录中",
    inputSchema: {
      type: "object",
      required: ["language", "keyword", "rationale"],
      properties: {
        language: { type: "string", minLength: 1 },
        keyword: { type: "string", minLength: 1 },
        rationale: { type: "string", minLength: 1, maxLength: 500 },
      },
    },
  },
  "keyword.pause": {
    kind: "keyword.pause",
    recommendationEligible: true,
    execution: "confirm",
    appliesTo: "active",
    immediateEffect: "暂停该关键词及其后续定时排名采集",
    verification: "关键词状态变为已暂停，相关排名任务停止调度",
    inputSchema: keywordTargetSchema,
  },
  "keyword.remove": {
    kind: "keyword.remove",
    recommendationEligible: true,
    execution: "confirm",
    appliesTo: "active-or-paused",
    immediateEffect: "从跟踪池移出该关键词，并保留可恢复记录",
    verification: "关键词离开跟踪池并出现在已移除记录中",
    inputSchema: keywordTargetSchema,
  },
  "keyword.restore": {
    kind: "keyword.restore",
    recommendationEligible: true,
    execution: "confirm",
    appliesTo: "removed",
    immediateEffect: "把已移除关键词恢复到跟踪池",
    verification: "关键词重新出现在跟踪池中，排名任务恢复调度",
    inputSchema: keywordTargetSchema,
  },
  "keyword.resume": {
    kind: "keyword.resume",
    recommendationEligible: true,
    execution: "confirm",
    appliesTo: "paused",
    immediateEffect: "恢复已暂停关键词的定时排名采集",
    verification: "关键词状态变为活跃，相关排名任务恢复调度",
    inputSchema: keywordTargetSchema,
  },
  "rank.collect": {
    kind: "rank.collect",
    recommendationEligible: false,
    execution: "task-center",
    appliesTo: null,
    immediateEffect: "更新证据，不改变运营状态",
    verification: "由任务中心记录采集结果",
    inputSchema: {
      type: "object",
      required: ["language"],
      properties: {
        language: { type: "string", minLength: 1 },
        storefront: { type: "string", minLength: 1 },
      },
    },
  },
  "trend.open": {
    kind: "trend.open",
    recommendationEligible: false,
    execution: "detail",
    appliesTo: null,
    immediateEffect: "只显示趋势信息，不改变任何状态",
    verification: "无需验证",
    inputSchema: { type: "object", required: [], properties: {} },
  },
  "release.open": {
    kind: "release.open",
    recommendationEligible: false,
    execution: "detail",
    appliesTo: null,
    immediateEffect: "只显示发布信息，不改变任何状态",
    verification: "无需验证",
    inputSchema: { type: "object", required: [], properties: {} },
  },
  "copy-plan.add": {
    kind: "copy-plan.add",
    recommendationEligible: true,
    execution: "confirm",
    appliesTo: null,
    immediateEffect: "把一条长期文案改进方向加入当前产品的文案计划",
    verification: "文案计划中存在内容一致且可在发布工作台查看的记录",
    inputSchema: {
      type: "object",
      required: ["title", "instruction", "reason", "fields", "languages"],
      properties: {
        title: { type: "string", minLength: 1, maxLength: 80 },
        instruction: { type: "string", minLength: 1, maxLength: 1000 },
        reason: { type: "string", minLength: 1, maxLength: 500 },
        fields: {
          type: "array",
          minItems: 1,
          items: { enum: ["name", "subtitle", "promotionalText", "description", "keywords"] },
        },
        languages: { type: "array", items: { type: "string" } },
      },
    },
  },
};

export function briefActionCapability(kind: BriefCommandKind): BriefActionCapability {
  return BRIEF_ACTION_CAPABILITIES[kind];
}

export function briefRecommendationCapabilities(): BriefActionCapability[] {
  return Object.values(BRIEF_ACTION_CAPABILITIES).filter(
    (capability) => capability.recommendationEligible,
  );
}

export interface BriefSuggestion {
  id: string;
  /** Monotonic, persisted user-facing number. Never reused or renumbered. */
  number?: number;
  generatedAt?: string;
  /** Snapshot that contains the exact evidence/profile used to generate this suggestion. */
  contextId?: string;
  title: string;
  reason: string;
  action: BriefAction;
  target: string | null;
  proposedActions: BriefProposedAction[];
  expectedOutcome?: string;
  successMetric?: string;
  evaluateAfterDays?: number;
  lifecycle?: {
    state: "active" | "withdrawn" | "replaced";
    reason: string;
    changedAt: string;
    replacementSuggestionId?: string | null;
  };
  replacesSuggestionId?: string | null;
}

export type BriefSuggestionDisposition = "keep" | "withdraw" | "replace";

export interface BriefSuggestionDecision {
  disposition: BriefSuggestionDisposition;
  reason: string;
  replacementSuggestionId?: string | null;
}

export interface BriefFollowupExchange {
  suggestionId: string | null;
  question: string;
  answer: string;
  proposedActions?: BriefProposedAction[];
  suggestionDecision?: BriefSuggestionDecision;
}

/**
 * Reconstruct a suggestion conversation without losing its origin:
 * stable project archive -> original generation evidence -> original assistant
 * suggestion -> this suggestion's own exchanges -> current question.
 */
export function buildBriefFollowupMessages(args: {
  profile?: ProjectProfile;
  systemPrompt: string;
  evidenceContext?: string;
  postActionEvidenceContext?: string;
  fallbackBriefContext: string;
  numberedSuggestionContext?: string;
  targetSuggestion?: BriefSuggestion | null;
  targetSuggestionNumber?: number;
  exchanges: BriefFollowupExchange[];
  maxExchanges?: number;
  question: string;
}): ChatMessage[] {
  const targetId = args.targetSuggestion?.id || null;
  const historyIds = new Set([
    targetId,
    args.targetSuggestion?.replacesSuggestionId || null,
  ]);
  const scopedHistory = args.exchanges
    .filter((exchange) => historyIds.has(exchange.suggestionId))
    .slice(-(args.maxExchanges ?? 6));
  const context = args.evidenceContext
    ? `生成当前建议时使用的完整数据快照：\n${args.evidenceContext}`
    : `当前可用的简报摘要：\n${args.fallbackBriefContext}`;
  const messages = buildArchiveMessages(
    args.profile,
    args.systemPrompt,
    [
      context,
      args.numberedSuggestionContext
        ? `界面编号目录：\n${args.numberedSuggestionContext}`
        : "",
    ].filter(Boolean),
  );
  if (args.targetSuggestion) {
    messages.push({
      role: "assistant",
      content: JSON.stringify({
        reference: args.targetSuggestionNumber
          ? `建议 ${args.targetSuggestionNumber}`
          : "当前建议",
        title: args.targetSuggestion.title,
        reason: args.targetSuggestion.reason,
        action: args.targetSuggestion.action,
        target: args.targetSuggestion.target,
        proposedActions: args.targetSuggestion.proposedActions || [],
        expectedOutcome: args.targetSuggestion.expectedOutcome || null,
        successMetric: args.targetSuggestion.successMetric || null,
        evaluateAfterDays: args.targetSuggestion.evaluateAfterDays || null,
        lifecycle: args.targetSuggestion.lifecycle || { state: "active" },
        replacesSuggestionId: args.targetSuggestion.replacesSuggestionId || null,
      }, null, 2),
    });
  }
  for (const exchange of scopedHistory) {
    messages.push({ role: "user", content: exchange.question });
    messages.push({
      role: "assistant",
      content: JSON.stringify({
        answer: exchange.answer,
        proposedActions: exchange.proposedActions || [],
        suggestionDecision: exchange.suggestionDecision || null,
      }, null, 2),
    });
  }
  messages.push({
    role: "user",
    content: args.postActionEvidenceContext
      ? [
          `动作执行后的最新数据快照（用于与原始建议依据对比）：\n${args.postActionEvidenceContext}`,
          `当前问题：${args.question}`,
        ].join("\n\n")
      : args.question,
  });
  return messages;
}

export interface BriefFollowupResponse {
  answer: string;
  proposedActions: BriefProposedAction[];
  suggestionDecision: BriefSuggestionDecision;
  replacementSuggestion: BriefSuggestion | null;
}

export function briefSuggestionId(title: string, action: BriefAction, target: unknown): string {
  let hash = 5381;
  const input = `${title}\u0000${action}\u0000${target ?? ""}`;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return `brief-${hash.toString(36)}`;
}

// `trend` stays in BriefAction only so persisted historical sessions remain readable.
// New model output cannot create a suggestion for the removed top-level module.
const BRIEF_ACTIONS: BriefAction[] = ["keywords", "release"];
const BRIEF_COMMANDS: BriefCommandKind[] = [
  "keyword.open", "keyword.track.add", "keyword.pause", "keyword.remove", "keyword.restore",
  "keyword.resume", "rank.collect", "release.open", "copy-plan.add",
];
function proposedActionId(kind: BriefCommandKind, input: BriefActionInput): string {
  const stableInput = Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)));
  return briefSuggestionId(kind, "keywords", JSON.stringify(stableInput));
}

export function normalizeBriefProposedActions(value: unknown): BriefProposedAction[] {
  if (!Array.isArray(value)) return [];
  const result: BriefProposedAction[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || !BRIEF_COMMANDS.includes((raw as any).kind)) continue;
    const kind = (raw as any).kind as BriefCommandKind;
    const rawInput = (raw as any).input && typeof (raw as any).input === "object"
      ? (raw as any).input as Record<string, unknown>
      : raw as Record<string, unknown>;
    const language = typeof rawInput.language === "string" && rawInput.language.trim()
      ? rawInput.language.trim() : null;
    const keyword = typeof rawInput.keyword === "string" && rawInput.keyword.trim()
      ? rawInput.keyword.trim() : null;
    const storefront = typeof rawInput.storefront === "string" && rawInput.storefront.trim()
      ? rawInput.storefront.trim().toLowerCase() : null;
    if (kind === "keyword.open" && Boolean(language) !== Boolean(keyword)) continue;
    if (kind.startsWith("keyword.") && kind !== "keyword.open" && (!language || !keyword)) continue;
    if (kind === "rank.collect" && !language) continue;
    let input: BriefActionInput = {};
    if (kind === "copy-plan.add") {
      const plan = normalizeCopyPlanInput(rawInput);
      if (!plan || !plan.reason) continue;
      input = { ...plan };
    } else if (kind === "keyword.track.add") {
      const rationale = String(rawInput.rationale || "").trim().slice(0, 500);
      if (!rationale) continue;
      input = { language, keyword, rationale };
    } else {
      input = {
        ...(language ? { language } : {}),
        ...(keyword ? { keyword } : {}),
        ...(storefront ? { storefront } : {}),
      };
    }
    const id = proposedActionId(kind, input);
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
      input,
      requiresConfirmation: briefActionCapability(kind).execution === "confirm",
    });
    if (result.length >= 5) break;
  }
  return result;
}

export function normalizeBriefFollowupResponse(data: any): BriefFollowupResponse {
  const disposition = (["keep", "withdraw", "replace"] as const).includes(
    data?.suggestionDecision?.disposition,
  ) ? data.suggestionDecision.disposition as BriefSuggestionDisposition : "keep";
  const replacementSuggestion = normalizeBriefSuggestions({
    suggestions: data?.replacementSuggestion ? [data.replacementSuggestion] : [],
  })[0] || null;
  return {
    answer: String(data?.answer || "").trim(),
    proposedActions: normalizeBriefProposedActions(data?.proposedActions),
    suggestionDecision: {
      disposition,
      reason: String(data?.suggestionDecision?.reason || "").trim().slice(0, 500),
    },
    replacementSuggestion,
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
      expectedOutcome: String(item.expectedOutcome || "").trim(),
      successMetric: String(item.successMetric || "").trim(),
      evaluateAfterDays: Number.isFinite(Number(item.evaluateAfterDays))
        ? Math.max(1, Math.min(30, Math.round(Number(item.evaluateAfterDays))))
        : undefined,
    });
  }
  return suggestions;
}

type BriefKeywordInventory = NonNullable<OverviewBriefInput["keywordInventory"]>;

function inventoryHas(
  entries: BriefKeywordInventory["active"],
  action: BriefProposedAction,
): boolean {
  return entries.some((entry) =>
    entry.language === action.language && entry.keyword === action.keyword,
  );
}

export function filterSupportedBriefActions(
  actions: BriefProposedAction[],
  inventory?: BriefKeywordInventory,
): BriefProposedAction[] {
  return actions.filter((action) => {
    const capability = briefActionCapability(action.kind);
    if (!capability.recommendationEligible) return false;
    if (!inventory) return true;
    if (capability.appliesTo === "active") return inventoryHas(inventory.active, action);
    if (capability.appliesTo === "active-or-paused") {
      return inventoryHas(inventory.active, action) || inventoryHas(inventory.paused, action);
    }
    if (capability.appliesTo === "removed") return inventoryHas(inventory.removed, action);
    if (capability.appliesTo === "paused") return inventoryHas(inventory.paused, action);
    if (capability.appliesTo === "missing") {
      return !inventoryHas(inventory.active, action)
        && !inventoryHas(inventory.paused, action)
        && !inventoryHas(inventory.removed, action);
    }
    return true;
  });
}

export function filterActionableBriefSuggestions(
  suggestions: BriefSuggestion[],
  input?: Pick<OverviewBriefInput, "keywordInventory">,
): BriefSuggestion[] {
  return suggestions.flatMap((suggestion) => {
    const proposedActions = filterSupportedBriefActions(
      suggestion.proposedActions,
      input?.keywordInventory,
    );
    if (
      proposedActions.length === 0
      || !suggestion.expectedOutcome
      || !suggestion.successMetric
      || !Number.isFinite(suggestion.evaluateAfterDays)
    ) return [];
    return [{ ...suggestion, proposedActions }];
  });
}

export function buildBriefMessages(
  input: OverviewBriefInput,
  actionCatalog: BriefActionCapability[] = briefRecommendationCapabilities(),
): ChatMessage[] {
  const { profile, ...taskData } = input;
  return buildArchiveMessages(
    profile,
    [
      "你是 Appilot 的运营副驾，为独立开发者的 App Store 增长给出简短、可执行的建议。",
      "你只能基于下面给定的真实数据输出建议，reason 必须引用数据，不得编造。",
      "先检查 rankDiagnostic 的覆盖与新鲜度。latestUnrankedCount 只表示最新一次未搜到排名，不能自行解释为掉榜、排名下降或采集失败。数据陈旧、覆盖不足或诊断为 blocking 时，应先指出证据缺口，不能继续推断业务原因，也不能提出改变关键词状态的动作；这不妨碍基于独立发布证据提出发布动作。",
      "rankDiagnostic.facts 是确定性事实；anomalies.interpretation 是允许的解释边界；limitations 必须遵守。",
      "detectedIssues 是确定性规则从现有数据中发现的问题。优先处理 high，其次 medium；不要用低价值建议挤占更高优先级问题。",
      "如果 detectedIssues 为空，不要假装发现缺陷；可基于其余数据给出优化建议，并明确这是机会而非已确认问题。",
      "competitorDeltas 只作为补充依据；竞品更新本身不等于风险。",
      "总览页已经展示关键词数量、排名分布、发布进度、仓库活动和竞品概况。不要复述这些状态，也不要把同一问题拆成多条建议。",
      "keywordInventory 和 keywordRankDetails 是数据库中的关键词级证据。涉及排名时先比较语言、商店和关键词差异；只有确实没有检查记录时，才能判断采集数据缺失。",
      "storefrontCoverage 是每种查询语言应覆盖的完整商店集合。checkedStorefronts 已等于对应集合数量时，覆盖已经完整；rank.collect 只能刷新已有目标商店，不能扩大覆盖，不得把刷新描述为补齐覆盖。",
      "rankDataReadiness 描述任务中心的每日采集状态。排名证据过期时，不要基于它提出关键词改变；等待任务中心按 nextScheduledAt 到 scheduledCoverageCompleteAt 的现有排期更新即可，不要生成额外采集动作。",
      `每条输出都必须从 Appilot 有效动作目录选择 proposedActions：${JSON.stringify(actionCatalog)}。查看页面、刷新数据和跳转不在目录中，不得作为建议动作。`,
      "动作对象的 language 和 keyword 必须与 keywordInventory 中符合 appliesTo 的条目精确匹配。不要根据不充分证据提出删除。",
      "当前有效动作只覆盖关键词跟踪管理；如果证据指向发布、文案或产品修改，但 Appilot 尚无对应执行动作，则不要把它包装成建议。",
      "title 和 reason 必须使用自然中文。不得输出 detectedIssues、high、medium 等内部字段名；涉及具体词时必须明确写出关键词，不要用“该词”或“同一关键词”作为首次指代。",
      "每条建议必须代表一个不同的决策：title 直接写要改变什么；reason 只解释为什么现在值得做，最多引用两个关键证据；expectedOutcome 写预期正向变化；successMetric 写之后如何判断有效；evaluateAfterDays 写复核天数。",
      "如果证据不足以支持改变，返回空 suggestions，不要用查看、检查、观察或刷新凑数。宁可没有建议，也不要输出没有明确收益和验证标准的建议。",
      "输出一个 JSON 对象：{\"suggestions\":[{\"title\":\"一句话动作\",\"reason\":\"引用数据的依据\",\"expectedOutcome\":\"预期变化\",\"successMetric\":\"可验证指标\",\"evaluateAfterDays\":7,\"action\":\"keywords\",\"target\":\"关键词或文案方向\",\"proposedActions\":[{\"kind\":\"keyword.track.add\",\"label\":\"添加跟踪关键词\",\"input\":{\"language\":\"en\",\"keyword\":\"walking light\",\"rationale\":\"与产品核心能力相关\"}}]}]}",
      "最多 3 条，按价值排序。action 只能是 keywords、release 之一。title 用中文。",
    ].join("\n"),
    [JSON.stringify(taskData, null, 2)],
  );
}

export async function generateOverviewBrief(
  provider: AIProvider,
  input: OverviewBriefInput,
  onProgress?: (received: { chars: number; phase: "reasoning" | "content" }) => void,
  actionCatalog: BriefActionCapability[] = briefRecommendationCapabilities(),
): Promise<BriefSuggestion[]> {
  log.info(`Generating overview brief for ${input.name}`);
  const data = await requestJson(provider, buildBriefMessages(input, actionCatalog), {
    temperature: 0.3,
    maxTokens: 2400,
    thinking: "disabled",
    onProgress,
  });
  return filterActionableBriefSuggestions(normalizeBriefSuggestions(data), input);
}
