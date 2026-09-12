import {
  BRIEF_ACTION_CAPABILITIES,
  normalizeBriefProposedActions,
  type BriefActionCapability,
  type BriefActionInput,
  type EffectiveBriefCommandKind,
} from "@appilot-labs/appilot-core/ai/overview-brief";
import { normalizeTrackedKeyword } from "@appilot-labs/appilot-core/rank-keywords";
import {
  copyPlanDuplicateKey,
  copyPlansForProduct,
  createCopyPlanItem,
  normalizeCopyPlanInput,
  upsertCopyPlan,
} from "@appilot-labs/appilot-core/copy-plan";
import type { AppStore } from "./store";
import {
  findProductContext,
  syncKeywordPoolToProducts,
  updateProjectInProjects,
} from "./project-state";

const ACTION_EXECUTIONS_STORE_KEY = "appActionExecutions";
const ACTION_EXECUTIONS_LIMIT = 500;

export type AppActionSource = "copilot" | "ui" | "internal";

export interface AppActionRequest {
  actionId: EffectiveBriefCommandKind;
  projectId: string;
  productId: string;
  input: BriefActionInput;
  source: AppActionSource;
  suggestionId?: string | null;
}

export interface AppActionDescriptor extends BriefActionCapability {
  version: 1;
  title: string;
  description: string;
  risk: "low" | "medium";
}

export interface AppActionPreview {
  actionId: EffectiveBriefCommandKind;
  title: string;
  target: string;
  immediateEffect: string;
  verification: string;
  risk: "low" | "medium";
  execution: "confirm";
  available: boolean;
  unavailableReason: string | null;
}

export interface AppActionExecution {
  id: string;
  actionId: EffectiveBriefCommandKind;
  version: 1;
  projectId: string;
  productId: string;
  input: AppActionRequest["input"];
  source: AppActionSource;
  suggestionId: string | null;
  status: "verified" | "failed";
  message: string;
  verification: string;
  startedAt: string;
  finishedAt: string;
}

export interface AppActionExecutionResult {
  execution: AppActionExecution;
  updatedProject: any | null;
}

type RegisteredAction = {
  descriptor: AppActionDescriptor;
  mutate: (
    project: any,
    product: any,
    input: AppActionRequest["input"],
    now: string,
    request: AppActionRequest,
  ) => any;
  verify: (project: any, product: any, input: AppActionRequest["input"]) => boolean;
};

function descriptor(
  actionId: EffectiveBriefCommandKind,
  title: string,
  description: string,
  risk: "low" | "medium",
): AppActionDescriptor {
  return {
    ...BRIEF_ACTION_CAPABILITIES[actionId],
    version: 1,
    title,
    description,
    risk,
  } as AppActionDescriptor;
}

function matches(item: any, input: AppActionRequest["input"]): boolean {
  return item?.language === input.language && item?.keyword === input.keyword;
}

const registeredActions: Record<EffectiveBriefCommandKind, RegisteredAction> = {
  "keyword.track.add": {
    descriptor: descriptor("keyword.track.add", "添加跟踪关键词", "把新关键词加入跟踪池并开始后续排名采集", "low"),
    mutate: (project, _product, input, now) => syncKeywordPoolToProducts({
      ...project,
      trackedKeywords: [
        ...(project.trackedKeywords || []),
        normalizeTrackedKeyword({
          language: input.language,
          keyword: input.keyword,
          rationale: input.rationale,
          translation: "",
          status: "active",
          source: "ai",
          addedAt: now,
        }),
      ],
    }),
    verify: (project, _product, input) =>
      (project.trackedKeywords || []).some((item: any) => matches(item, input))
      && !(project.removedKeywords || []).some((item: any) => matches(item, input)),
  },
  "keyword.pause": {
    descriptor: descriptor("keyword.pause", "暂停关键词", "暂停关键词的后续定时排名采集", "low"),
    mutate: (project, _product, input, now) => syncKeywordPoolToProducts({
      ...project,
      trackedKeywords: (project.trackedKeywords || []).map((item: any) =>
        matches(item, input)
          ? {
              ...item,
              status: "paused",
              pausedAt: now,
              pausedReason: "由用户确认的应用动作暂停",
            }
          : item,
      ),
    }),
    verify: (project, _product, input) => (project.trackedKeywords || []).some(
      (item: any) => matches(item, input) && item.status === "paused",
    ),
  },
  "keyword.remove": {
    descriptor: descriptor("keyword.remove", "移除关键词", "从跟踪池移出关键词并保留恢复记录", "medium"),
    mutate: (project, _product, input, now) => {
      const removedKeyword = (project.trackedKeywords || []).find((item: any) => matches(item, input));
      const removedKeywords = [...(project.removedKeywords || [])];
      if (!removedKeywords.some((item: any) => matches(item, input))) {
        removedKeywords.push({
          ...input,
          rationale: removedKeyword?.rationale || "",
          translation: removedKeyword?.translation || "",
          removedAt: now,
        });
      }
      return syncKeywordPoolToProducts({
        ...project,
        trackedKeywords: (project.trackedKeywords || []).filter((item: any) => !matches(item, input)),
        removedKeywords,
      });
    },
    verify: (project, _product, input) =>
      !(project.trackedKeywords || []).some((item: any) => matches(item, input))
      && (project.removedKeywords || []).some((item: any) => matches(item, input)),
  },
  "keyword.restore": {
    descriptor: descriptor("keyword.restore", "恢复已移除关键词", "把已移除关键词恢复到跟踪池", "low"),
    mutate: (project, _product, input) => {
      const removedItem = (project.removedKeywords || []).find((item: any) => matches(item, input));
      const trackedKeywords = [...(project.trackedKeywords || [])];
      if (!trackedKeywords.some((item: any) => matches(item, input))) {
        trackedKeywords.push({
          ...input,
          rationale: removedItem?.rationale || "",
          translation: removedItem?.translation || "",
        });
      }
      return syncKeywordPoolToProducts({
        ...project,
        trackedKeywords,
        removedKeywords: (project.removedKeywords || []).filter((item: any) => !matches(item, input)),
      });
    },
    verify: (project, _product, input) =>
      (project.trackedKeywords || []).some((item: any) => matches(item, input))
      && !(project.removedKeywords || []).some((item: any) => matches(item, input)),
  },
  "keyword.resume": {
    descriptor: descriptor("keyword.resume", "恢复关键词", "恢复已暂停关键词的定时排名采集", "low"),
    mutate: (project, product, input) => {
      const paused = (project.trackedKeywords || []).find((item: any) => matches(item, input));
      const platformKey = product.platform || "unknown";
      const pausedPlatforms = Array.isArray(paused?.pausedPlatforms)
        ? paused.pausedPlatforms.filter((item: string) => item !== platformKey)
        : [];
      const manualPause = paused?.status === "paused";
      return syncKeywordPoolToProducts({
        ...project,
        trackedKeywords: (project.trackedKeywords || []).map((item: any) =>
          matches(item, input)
            ? {
                ...item,
                status: manualPause ? "active" : item.status,
                pausedAt: manualPause ? null : item.pausedAt,
                pausedReason: manualPause || pausedPlatforms.length === 0 ? null : item.pausedReason,
                pausedPlatforms,
              }
            : item,
        ),
      });
    },
    verify: (project, _product, input) => (project.trackedKeywords || []).some(
      (item: any) => matches(item, input) && item.status !== "paused",
    ),
  },
  "copy-plan.add": {
    descriptor: descriptor("copy-plan.add", "添加文案计划", "记录一条供之后发布文案生成参考的长期改进方向", "low"),
    mutate: (project, product, input, now, request) => {
      const normalized = normalizeCopyPlanInput(
        input,
        (product.supportedLanguages || []).map((item: any) => String(item.code || "")),
      );
      if (!normalized) throw new Error("文案计划参数不完整");
      const item = createCopyPlanItem({
        projectId: project.id,
        productId: product.id,
        input: normalized,
        source: request.source === "copilot" ? "copilot" : "manual",
        sourceSuggestionId: request.suggestionId,
        now,
      });
      upsertCopyPlan(project, item);
      return { ...project };
    },
    verify: (project, product, input) => {
      const normalized = normalizeCopyPlanInput(
        input,
        (product.supportedLanguages || []).map((item: any) => String(item.code || "")),
      );
      return Boolean(normalized && copyPlansForProduct(project, product.id).some(
        (item) => copyPlanDuplicateKey(item) === copyPlanDuplicateKey(normalized),
      ));
    },
  },
};

function normalizedRequest(request: AppActionRequest): AppActionRequest {
  const action = registeredActions[request?.actionId];
  if (!action) throw new Error("该动作未在 Appilot 注册");
  const projectId = String(request?.projectId || "").trim();
  const productId = String(request?.productId || "").trim();
  const normalizedAction = normalizeBriefProposedActions([{
    kind: request?.actionId,
    label: action.descriptor.title,
    input: request?.input,
  }])[0];
  if (!projectId || !productId || !normalizedAction) throw new Error("动作参数不完整");
  return {
    ...request,
    projectId,
    productId,
    input: normalizedAction.input,
    source: ["copilot", "ui", "internal"].includes(request.source) ? request.source : "internal",
    suggestionId: typeof request.suggestionId === "string" ? request.suggestionId : null,
  };
}

function actionContext(store: AppStore, request: AppActionRequest): { projects: any[]; project: any; product: any } {
  const projects: any[] = store.get("projects") || [];
  const context = findProductContext(projects, request.productId);
  if (!context || context.project.id !== request.projectId) {
    throw new Error("动作目标不属于当前项目");
  }
  return { projects, ...context };
}

function availability(
  action: RegisteredAction,
  project: any,
  product: any,
  input: AppActionRequest["input"],
): string | null {
  const tracked = (project.trackedKeywords || []).find((item: any) => matches(item, input));
  const removed = (project.removedKeywords || []).find((item: any) => matches(item, input));
  if (action.descriptor.appliesTo === "active" && (!tracked || tracked.status === "paused")) {
    return "关键词当前不在活跃跟踪池中";
  }
  if (action.descriptor.appliesTo === "active-or-paused" && !tracked) {
    return "关键词当前不在跟踪池中";
  }
  if (action.descriptor.appliesTo === "paused" && (!tracked || tracked.status !== "paused")) {
    return "关键词当前不是已暂停状态";
  }
  if (action.descriptor.appliesTo === "removed" && !removed) {
    return "关键词当前不在已移除记录中";
  }
  if (action.descriptor.appliesTo === "missing") {
    if (tracked) return "关键词已经在跟踪池中";
    if (removed) return "关键词位于已移除记录中，请使用恢复动作";
    const supported = (product.supportedLanguages || []).map((item: any) => String(item.code || ""));
    if (supported.length > 0 && !supported.includes(String(input.language || ""))) {
      return "关键词语言不属于当前产品支持的语言";
    }
  }
  if (action.descriptor.kind === "copy-plan.add") {
    const supported = (product.supportedLanguages || []).map((item: any) => String(item.code || ""));
    const normalized = normalizeCopyPlanInput(input, supported);
    if (!normalized) return "文案计划字段或语言无效";
    if (copyPlansForProduct(project, product.id).some(
      (item) => copyPlanDuplicateKey(item) === copyPlanDuplicateKey(normalized),
    )) return "相同的文案计划已经存在";
  }
  return null;
}

function appendExecution(store: AppStore, execution: AppActionExecution): void {
  const previous = store.get<AppActionExecution[]>(ACTION_EXECUTIONS_STORE_KEY);
  store.set(ACTION_EXECUTIONS_STORE_KEY, [execution, ...(Array.isArray(previous) ? previous : [])]
    .slice(0, ACTION_EXECUTIONS_LIMIT));
}

export function listRegisteredActions(): AppActionDescriptor[] {
  return Object.values(registeredActions).map((action) => action.descriptor);
}

export function recommendationActionCatalog(): BriefActionCapability[] {
  return listRegisteredActions().map(({ kind, recommendationEligible, execution, appliesTo, immediateEffect, verification, inputSchema }) => ({
    kind,
    recommendationEligible,
    execution,
    appliesTo,
    immediateEffect,
    verification,
    inputSchema,
  }));
}

export function findRecordedActionExecution(
  store: AppStore,
  executionId: string,
): AppActionExecution | null {
  const executions = store.get<AppActionExecution[]>(ACTION_EXECUTIONS_STORE_KEY);
  if (!Array.isArray(executions)) return null;
  return executions.find((execution) => execution.id === executionId) || null;
}

export function previewRegisteredAction(store: AppStore, rawRequest: AppActionRequest): AppActionPreview {
  const request = normalizedRequest(rawRequest);
  const action = registeredActions[request.actionId];
  const { project, product } = actionContext(store, request);
  const unavailableReason = availability(action, project, product, request.input);
  const target = action.descriptor.kind === "copy-plan.add"
    ? String(request.input.title || "文案计划")
    : `${String(request.input.language || "")} · ${String(request.input.keyword || "")}`;
  return {
    actionId: request.actionId,
    title: action.descriptor.title,
    target,
    immediateEffect: action.descriptor.immediateEffect,
    verification: action.descriptor.verification,
    risk: action.descriptor.risk,
    execution: "confirm",
    available: !unavailableReason,
    unavailableReason,
  };
}

export function executeRegisteredAction(
  store: AppStore,
  rawRequest: AppActionRequest,
): AppActionExecutionResult {
  const request = normalizedRequest(rawRequest);
  const action = registeredActions[request.actionId];
  const startedAt = new Date().toISOString();
  const executionBase = {
    id: `action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    actionId: request.actionId,
    version: 1 as const,
    projectId: request.projectId,
    productId: request.productId,
    input: request.input,
    source: request.source,
    suggestionId: request.suggestionId || null,
    startedAt,
  };
  try {
    const { projects, project, product } = actionContext(store, request);
    const unavailableReason = availability(action, project, product, request.input);
    if (unavailableReason) throw new Error(unavailableReason);
    const changedProject = action.mutate(project, product, request.input, startedAt, request);
    const nextProjects = updateProjectInProjects(projects, project.id, () => changedProject);
    store.set("projects", nextProjects);
    const persistedProjects: any[] = store.get("projects") || [];
    const savedContext = findProductContext(persistedProjects, request.productId);
    const savedProject = savedContext?.project;
    if (!savedProject || !savedContext || !action.verify(savedProject, savedContext.product, request.input)) {
      throw new Error("动作已提交，但状态校验未通过");
    }
    const execution: AppActionExecution = {
      ...executionBase,
      status: "verified",
      message: `${action.descriptor.title}已完成`,
      verification: action.descriptor.verification,
      finishedAt: new Date().toISOString(),
    };
    appendExecution(store, execution);
    return { execution, updatedProject: savedProject };
  } catch (error: any) {
    const execution: AppActionExecution = {
      ...executionBase,
      status: "failed",
      message: String(error?.message || "动作执行失败").slice(0, 500),
      verification: action.descriptor.verification,
      finishedAt: new Date().toISOString(),
    };
    appendExecution(store, execution);
    throw Object.assign(new Error(execution.message), { execution });
  }
}

export function registeredActionIds(): EffectiveBriefCommandKind[] {
  return Object.keys(registeredActions) as EffectiveBriefCommandKind[];
}
