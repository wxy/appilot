import { memo, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  BriefProposedAction,
  BriefSuggestion,
} from "@appilot-labs/appilot-core/ai/overview-brief";
import { useProject, type Project, type StoreProduct } from "../../stores/project";
import { formatHumanTime, platformLabel } from "../../lib/format";
import { cn } from "../../lib/utils";
import { btnSmPrimary, btnSmSecondary } from "../ui/styles";
import { EmptyState } from "../ui/EmptyState";

type Exchange = {
  suggestionId: string | null;
  question: string;
  answer: string;
  proposedActions?: BriefProposedAction[];
  at: string;
};

type ActionRun = {
  id: string;
  suggestionId: string | null;
  action: BriefProposedAction;
  status: "executed" | "failed";
  message: string;
  at: string;
};

type Session = {
  suggestions: BriefSuggestion[];
  generatedAt: string;
  exchanges: Exchange[];
  actionRuns: ActionRun[];
  dismissedSuggestionIds: string[];
  supersededSuggestionIds: string[];
};

type TaskFeedback = {
  actionId: string;
  action: BriefProposedAction;
  label: string;
  state: "running" | "success" | "failed";
  completed: number;
  detail: string;
};

const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="my-1.5 leading-6">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold text-zinc-800 dark:text-zinc-100">{children}</strong>,
        ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
        ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
        li: ({ children }) => <li className="pl-0.5">{children}</li>,
        code: ({ children }) => <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 font-mono text-[0.92em]">{children}</code>,
        a: ({ href, children }) => href && /^https?:\/\//i.test(href) ? (
          <button
            type="button"
            className="text-amber-600 dark:text-amber-400 underline underline-offset-2"
            onClick={() => (window as any).appilot?.openExternal?.(href)}
          >
            {children}
          </button>
        ) : <span>{children}</span>,
      }}
    >
      {children}
    </ReactMarkdown>
  );
});

const CopilotComposer = memo(function CopilotComposer({
  disabled,
  asking,
  placeholder,
  onSubmit,
}: {
  disabled: boolean;
  asking: boolean;
  placeholder: string;
  onSubmit: (question: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  const submit = async () => {
    const question = draft.trim();
    if (disabled || asking || question.length < 2) return;
    if (await onSubmit(question)) setDraft("");
  };
  return (
    <div className="flex items-end gap-2">
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
        disabled={disabled || asking}
        rows={2}
        maxLength={1000}
        placeholder={placeholder}
        className="min-h-16 flex-1 resize-none rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 outline-none placeholder:text-zinc-400 focus:border-amber-400 disabled:opacity-50"
      />
      <button onClick={() => void submit()} disabled={disabled || asking || draft.trim().length < 2} className={cn(btnSmPrimary, "h-9 disabled:opacity-50")}>
        {asking ? "思考中…" : "发送"}
      </button>
    </div>
  );
});

function fallbackActions(suggestion: BriefSuggestion, language: string | null): BriefProposedAction[] {
  if (suggestion.proposedActions?.length) return suggestion.proposedActions;
  if (suggestion.action === "trend" && (!language || !suggestion.target)) return [];
  const kind = suggestion.action === "release"
    ? "release.open"
    : suggestion.action === "trend"
      ? "keyword.open"
      : "keyword.open";
  return [{
    id: `fallback-${suggestion.id}`,
    kind,
    label: suggestion.action === "release" ? "打开发布" : suggestion.action === "trend" ? "查看趋势" : "查看关键词",
    language,
    keyword: kind === "keyword.open" && !language ? null : suggestion.target,
    storefront: null,
    requiresConfirmation: false,
  }];
}

function readableSuggestionReason(suggestion: BriefSuggestion): string {
  const target = suggestion.target?.trim();
  return suggestion.reason
    .replace(
      /detectedIssues\s*两条\s*high\s*都指向同一关键词[：:]/gi,
      target ? `已确认的两项高优先级问题都来自关键词「${target}」：` : "已确认的两项高优先级问题：",
    )
    .replace(/\bdetectedIssues\b/gi, "已确认问题")
    .replace(/\bhigh\b/gi, "高优先级")
    .replace(/\bmedium\b/gi, "中优先级");
}

function readableActionMessage(message: string): string {
  return message.replace(/^Error invoking remote method '[^']+': Error:\s*/i, "");
}

function actionDescription(action: BriefProposedAction): string {
  const subject = [action.language, action.keyword].filter(Boolean).join(" · ");
  const store = action.storefront ? ` · ${action.storefront.toUpperCase()}` : "";
  if (action.kind === "keyword.remove") return `从跟踪池移除 ${subject}，并保留可恢复记录`;
  if (action.kind === "keyword.pause") return `暂停跟踪 ${subject}`;
  if (action.kind === "keyword.restore") return `恢复已移除关键词 ${subject}`;
  if (action.kind === "keyword.resume") return `恢复已暂停关键词 ${subject}`;
  if (action.kind === "rank.collect") return `采集 ${action.language || "当前语言"}${store} 的最新排名`;
  if (action.kind === "keyword.open") return `查看 ${subject || "关键词"} 的相关数据`;
  if (action.kind === "trend.open") return "查看与建议有关的趋势信息";
  return "查看与建议有关的发布信息";
}

function fullActionPath(action: BriefProposedAction): string {
  if (action.kind === "keyword.open") {
    const params = new URLSearchParams();
    if (action.language) params.set("lang", action.language);
    if (action.keyword) params.set("keyword", action.keyword);
    return `/keywords${params.size ? `?${params.toString()}` : ""}`;
  }
  if (action.kind === "trend.open") return "/trend";
  return "/release";
}

function ActionDetailSheet({
  action,
  reference,
  suggestion,
  project,
  product,
  onClose,
  onOpenFull,
}: {
  action: BriefProposedAction;
  reference: string;
  suggestion: BriefSuggestion | null;
  project: Project;
  product: StoreProduct;
  onClose: () => void;
  onOpenFull: () => void;
}) {
  const tracked = project.trackedKeywords.find((item) =>
    item.language === action.language && item.keyword === action.keyword,
  );
  const removed = project.removedKeywords.find((item) =>
    item.language === action.language && item.keyword === action.keyword,
  );
  const rankRows = [...product.rankSnapshots]
    .filter((item) =>
      (!action.language || item.language === action.language)
      && (!action.keyword || item.keyword === action.keyword)
      && (!action.storefront || item.storefront === action.storefront),
    )
    .sort((a, b) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime());
  const latestByStore = rankRows.filter(
    (item, index) => rankRows.findIndex((candidate) => candidate.storefront === item.storefront) === index,
  ).slice(0, 8);
  const isKeyword = action.kind === "keyword.open";

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-zinc-950/25 backdrop-blur-[1px]" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`${reference} 相关信息`}
        className="flex h-full w-full max-w-lg flex-col border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start gap-3 border-b border-zinc-200 dark:border-zinc-800 px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">{reference} · 相关信息</p>
            <h2 className="mt-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">{action.label}</h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{actionDescription(action)}</p>
          </div>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">关闭</button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {suggestion && (
            <div className="mb-5 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 px-4 py-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">建议依据</p>
              <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300"><Markdown>{readableSuggestionReason(suggestion)}</Markdown></div>
            </div>
          )}

          {isKeyword ? (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
                  <p className="text-[10px] text-zinc-400">关键词</p>
                  <p className="mt-1 text-sm font-medium text-zinc-800 dark:text-zinc-100">{action.keyword || "未指定"}</p>
                  <p className="mt-1 text-xs text-zinc-500">{tracked?.translation || removed?.translation || "暂无译文"}</p>
                </div>
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
                  <p className="text-[10px] text-zinc-400">语言与状态</p>
                  <p className="mt-1 text-sm font-medium text-zinc-800 dark:text-zinc-100">{action.language || "未指定语言"}</p>
                  <p className="mt-1 text-xs text-zinc-500">{tracked ? (tracked.status === "paused" ? "已暂停" : "跟踪中") : removed ? "已移除，可恢复" : "当前词库中未找到"}</p>
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-zinc-700 dark:text-zinc-200">最新商店排名</p>
                {latestByStore.length ? (
                  <div className="divide-y divide-zinc-100 dark:divide-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-800">
                    {latestByStore.map((row) => (
                      <div key={row.storefront} className="flex items-center gap-3 px-3 py-2 text-xs">
                        <span className="w-12 font-medium uppercase text-zinc-600 dark:text-zinc-300">{row.storefront}</span>
                        <span className="flex-1 text-zinc-500">{formatHumanTime(row.checkedAt)}采集</span>
                        <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-100">{row.rank ? `#${row.rank}` : "未进入前 200"}</span>
                      </div>
                    ))}
                  </div>
                ) : <p className="rounded-xl border border-dashed border-zinc-200 dark:border-zinc-700 px-3 py-5 text-center text-xs text-zinc-400">没有与该语言和关键词精确匹配的排名快照</p>}
              </div>
              {(tracked?.rationale || removed?.rationale) && (
                <div>
                  <p className="text-xs font-medium text-zinc-700 dark:text-zinc-200">收录依据</p>
                  <p className="mt-1 text-sm leading-6 text-zinc-500 dark:text-zinc-400">{tracked?.rationale || removed?.rationale}</p>
                </div>
              )}
            </div>
          ) : (
            <p className="rounded-xl border border-zinc-200 dark:border-zinc-800 px-4 py-4 text-sm leading-6 text-zinc-500 dark:text-zinc-400">发布包含版本、文案、检查项和商店状态等多个关联区域。这里保留建议依据，具体修改在完整发布工作台中进行。</p>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-zinc-200 dark:border-zinc-800 px-5 py-4">
          <p className="text-[11px] text-zinc-400">详情层只读取当前动作所需数据</p>
          <button onClick={onOpenFull} className={btnSmPrimary}>打开完整页面</button>
        </footer>
      </section>
    </div>
  );
}

export function CopilotPage() {
  const {
    projects,
    currentProjectId,
    currentProductId,
    pauseTrackedKeyword,
    removeTrackedKeyword,
    restoreTrackedKeyword,
    resumePausedKeyword,
    collectRanks,
  } = useProject();
  const navigate = useNavigate();
  const location = useLocation();
  const project = projects.find((item) => item.id === currentProjectId) || null;
  const product = project?.storeProducts.find((item) => item.id === currentProductId)
    || project?.storeProducts[0]
    || null;
  const [session, setSession] = useState<Session | null>(null);
  const [selectedId, setSelectedId] = useState<string>("general");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ chars: number; phase: string } | null>(null);
  const [asking, setAsking] = useState(false);
  const [pendingAction, setPendingAction] = useState<BriefProposedAction | null>(null);
  const [detailAction, setDetailAction] = useState<BriefProposedAction | null>(null);
  const [runningActionId, setRunningActionId] = useState<string | null>(null);
  const [taskFeedback, setTaskFeedback] = useState<TaskFeedback | null>(null);
  const [error, setError] = useState("");

  const loadSession = async () => {
    if (!project || !product) return;
    const value = await (window as any).appilot?.projects?.getBriefSession(project.id, product.id);
    setSession(value ? {
      suggestions: value.suggestions || [],
      generatedAt: value.generatedAt,
      exchanges: value.exchanges || [],
      actionRuns: value.actionRuns || [],
      dismissedSuggestionIds: value.dismissedSuggestionIds || [],
      supersededSuggestionIds: value.supersededSuggestionIds || [],
    } : null);
  };

  useEffect(() => {
    setSession(null);
    setSelectedId(new URLSearchParams(location.search).get("suggestion") || "general");
    setError("");
    void loadSession().catch(() => undefined);
  }, [project?.id, product?.id, location.search]);

  useEffect(() => {
    const off = (window as any).appilot?.projects?.onBriefProgress?.((value: any) => {
      setProgress(value || null);
    });
    return () => off?.();
  }, []);

  useEffect(() => {
    const off = (window as any).appilot?.projects?.onRankProgress?.((value: any) => {
      if (!value?.snapshot) return;
      setTaskFeedback((current) => current?.state === "running"
        && current.action.kind === "rank.collect"
        && current.action.language === value.snapshot.language
        && (!current.action.storefront || current.action.storefront === value.snapshot.storefront)
        ? {
            ...current,
            completed: current.completed + 1,
            detail: `已收到 ${current.completed + 1} 个排名结果，仍在继续采集…`,
          }
        : current);
    });
    return () => off?.();
  }, []);

  const completedSuggestionIds = useMemo(() => new Set(
    (session?.actionRuns || [])
      .filter((run) => run.status === "executed" && run.suggestionId && !run.action.kind.endsWith(".open") && isActionVerified(run))
      .map((run) => run.suggestionId as string),
  ), [session, project]);
  const dismissedSuggestionIds = useMemo(
    () => new Set(session?.dismissedSuggestionIds || []),
    [session],
  );
  const supersededSuggestionIds = useMemo(
    () => new Set(session?.supersededSuggestionIds || []),
    [session],
  );
  const orderedSuggestions = useMemo(() => [...(session?.suggestions || [])]
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const time = new Date(b.item.generatedAt || session?.generatedAt || 0).getTime()
        - new Date(a.item.generatedAt || session?.generatedAt || 0).getTime();
      return time || a.index - b.index;
    })
    .map(({ item }) => item), [session]);
  const suggestionNumberById = useMemo(
    () => new Map(orderedSuggestions.map((item, index) => [item.id, index + 1])),
    [orderedSuggestions],
  );
  const selectedSuggestion = session?.suggestions.find((item) => item.id === selectedId) || null;
  const selectedSuggestionNumber = selectedSuggestion
    ? suggestionNumberById.get(selectedSuggestion.id) || 0
    : 0;
  const visibleExchanges = (session?.exchanges || []).filter(
    (item) => item.suggestionId === (selectedSuggestion?.id || null),
  );
  const matchingKeywords = selectedSuggestion?.target
    ? project?.trackedKeywords.filter((item) => item.keyword === selectedSuggestion.target) || []
    : [];
  const activeKeyword = matchingKeywords.length === 1 ? matchingKeywords[0] : null;
  const proposedActions = useMemo(() => {
    const items = [
      ...(selectedSuggestion ? fallbackActions(selectedSuggestion, activeKeyword?.language || null) : []),
      ...visibleExchanges.flatMap((item) => item.proposedActions || []),
    ].map((action) => action.kind === "trend.open" && activeKeyword && selectedSuggestion?.target
      ? {
          ...action,
          kind: "keyword.open" as const,
          label: "查看关键词排名",
          language: activeKeyword.language,
          keyword: selectedSuggestion.target,
        }
      : action).filter((action) => action.kind !== "trend.open");
    return [...new Map(items.map((item) => [item.id, item])).values()];
  }, [selectedSuggestion, activeKeyword?.language, visibleExchanges]);
  const actionReference = (action: BriefProposedAction) => {
    const index = proposedActions.findIndex((item) => item.id === action.id);
    return selectedSuggestionNumber && index >= 0
      ? `动作 ${selectedSuggestionNumber}.${index + 1}`
      : "建议动作";
  };

  const generate = async () => {
    if (!project || !product || loading) return;
    setLoading(true);
    setProgress(null);
    setError("");
    try {
      const result = await (window as any).appilot?.projects?.generateBrief(project.id, product.id);
      await loadSession();
      const first = result?.suggestions?.[0];
      if (first?.id) setSelectedId(first.id);
    } catch (err: any) {
      setError(err?.message || "分析失败，请稍后重试");
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  const ask = async (question: string): Promise<boolean> => {
    if (!project || !product || question.length < 2 || asking) return false;
    setAsking(true);
    setError("");
    try {
      await (window as any).appilot?.projects?.askBriefQuestion(
        project.id,
        product.id,
        question,
        selectedSuggestion?.id,
      );
      await loadSession();
      return true;
    } catch (err: any) {
      setError(err?.message || "追问失败，请稍后重试");
      return false;
    } finally {
      setAsking(false);
    }
  };

  const recordExecution = async (
    action: BriefProposedAction,
    status: "executed" | "failed",
    message: string,
  ) => {
    if (!project || !product) return;
    await (window as any).appilot?.projects?.recordBriefExecution(project.id, product.id, {
      suggestionId: selectedSuggestion?.id || null,
      action,
      status,
      message,
    });
  };

  const execute = async (action: BriefProposedAction) => {
    if (!project || !product || runningActionId) return;
    if (action.kind.endsWith(".open")) {
      setDetailAction(action);
      return;
    }
    if (action.requiresConfirmation && pendingAction?.id !== action.id) {
      setPendingAction(action);
      return;
    }
    setPendingAction(null);
    setRunningActionId(action.id);
    setTaskFeedback({
      actionId: action.id,
      action,
      label: action.label,
      state: "running",
      completed: 0,
      detail: action.kind === "rank.collect" ? "任务已提交，正在接收排名结果…" : "请求已提交，正在执行…",
    });
    setError("");
    try {
      if (action.kind === "keyword.pause" && action.language && action.keyword) {
        await pauseTrackedKeyword(product.id, action.language, action.keyword);
      } else if (action.kind === "keyword.remove" && action.language && action.keyword) {
        await removeTrackedKeyword(product.id, action.language, action.keyword);
      } else if (action.kind === "keyword.restore" && action.language && action.keyword) {
        await restoreTrackedKeyword(product.id, action.language, action.keyword);
      } else if (action.kind === "keyword.resume" && action.language && action.keyword) {
        await resumePausedKeyword(product.id, action.language, action.keyword);
      } else if (action.kind === "rank.collect" && action.language) {
        await collectRanks(product.id, action.language, action.storefront || "");
      } else {
        throw new Error("动作参数不完整，无法执行");
      }
      try {
        await recordExecution(action, "executed", actionDescription(action));
      } catch {
        setError("动作已完成，但执行记录保存失败");
      }
      await loadSession();
      setTaskFeedback((current) => current?.actionId === action.id
        ? { ...current, state: "success", detail: current.completed ? `已完成，共收到 ${current.completed} 个排名结果` : "动作已完成" }
        : current);
    } catch (err: any) {
      const message = readableActionMessage(err?.message || "执行失败");
      await recordExecution(action, "failed", message).catch(() => undefined);
      setError(message);
      setTaskFeedback((current) => current?.actionId === action.id
        ? { ...current, state: "failed", detail: message }
        : current);
      await loadSession().catch(() => undefined);
    } finally {
      setRunningActionId(null);
    }
  };

  const dismiss = async () => {
    if (!project || !product || !selectedSuggestion) return;
    await (window as any).appilot?.projects?.dismissBriefSuggestion(
      project.id,
      product.id,
      selectedSuggestion.id,
    );
    await loadSession();
    setSelectedId("general");
  };

  if (!project || !product) {
    return <EmptyState title="还没有项目" desc="添加项目后，副驾驶才能读取数据并提出行动。" />;
  }

  const pendingCount = (session?.suggestions || []).filter(
    (item) => !completedSuggestionIds.has(item.id) && !dismissedSuggestionIds.has(item.id) && !supersededSuggestionIds.has(item.id),
  ).length;

  function isActionVerified(run: ActionRun): boolean {
    const action = run.action;
    const tracked = project?.trackedKeywords || [];
    const removed = project?.removedKeywords || [];
    const keyword = tracked.find((item) => item.language === action.language && item.keyword === action.keyword);
    if (action.kind === "keyword.remove") {
      return !keyword && removed.some((item) => item.language === action.language && item.keyword === action.keyword);
    }
    if (action.kind === "keyword.pause") return keyword?.status === "paused";
    if (action.kind === "keyword.restore") return Boolean(keyword);
    if (action.kind === "keyword.resume") return Boolean(keyword && keyword.status !== "paused");
    if (action.kind === "rank.collect") {
      const threshold = new Date(run.at).getTime() - 5 * 60 * 1000;
      return (product?.rankSnapshots || []).some((snapshot) =>
        snapshot.language === action.language
        && (!action.storefront || snapshot.storefront === action.storefront)
        && new Date(snapshot.checkedAt).getTime() >= threshold,
      );
    }
    return false;
  }

  return (
    <div className="mx-auto flex h-full max-w-[1500px] flex-col px-5 py-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">副驾驶</h1>
            <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
              {platformLabel(product.platform)}
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {project.name} · {pendingCount} 项待决策 · {completedSuggestionIds.size} 项已执行
            {session?.generatedAt ? ` · ${formatHumanTime(session.generatedAt)}分析` : ""}
          </p>
        </div>
        <button onClick={() => void generate()} disabled={loading} className={cn(btnSmPrimary, "disabled:opacity-50")}>
          {loading ? `${progress?.phase === "content" ? "生成中" : "分析中"}${progress?.chars ? ` · ${progress.chars} 字` : ""}` : session ? "重新分析" : "开始分析"}
        </button>
      </div>

      {taskFeedback && (
        <div className={cn(
          "mb-4 flex items-center gap-3 rounded-xl border px-4 py-3 text-sm",
          taskFeedback.state === "running"
            ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"
            : taskFeedback.state === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
              : "border-red-200 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300",
        )}>
          <span className={cn(
            "h-2.5 w-2.5 shrink-0 rounded-full",
            taskFeedback.state === "running" ? "animate-pulse bg-amber-500" : taskFeedback.state === "success" ? "bg-emerald-500" : "bg-red-500",
          )} />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{taskFeedback.state === "running" ? `正在执行：${taskFeedback.label}` : taskFeedback.state === "success" ? `已完成：${taskFeedback.label}` : `执行失败：${taskFeedback.label}`}</p>
            <p className="mt-0.5 text-xs opacity-75">{taskFeedback.detail}</p>
          </div>
          {taskFeedback.state !== "running" && <button onClick={() => setTaskFeedback(null)} className="text-xs opacity-60 hover:opacity-100">关闭</button>}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
        <aside className="overflow-y-auto border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/30 p-2">
          <button
            onClick={() => setSelectedId("general")}
            className={cn(
              "mb-1 w-full rounded-xl px-3 py-2.5 text-left",
              selectedId === "general" ? "bg-white dark:bg-zinc-800 shadow-sm" : "hover:bg-white/70 dark:hover:bg-zinc-800/60",
            )}
          >
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">总体分析</p>
            <p className="mt-0.5 text-[11px] text-zinc-400">跨工作项继续讨论</p>
          </button>
          {orderedSuggestions.map((suggestion, suggestionIndex) => {
            const completed = completedSuggestionIds.has(suggestion.id);
            const dismissed = dismissedSuggestionIds.has(suggestion.id);
            const superseded = supersededSuggestionIds.has(suggestion.id);
            return (
              <button
                key={suggestion.id}
                onClick={() => setSelectedId(suggestion.id)}
                className={cn(
                  "mb-1 w-full rounded-xl px-3 py-2.5 text-left transition-colors",
                  selectedId === suggestion.id ? "bg-white dark:bg-zinc-800 shadow-sm" : "hover:bg-white/70 dark:hover:bg-zinc-800/60",
                )}
              >
                <div className="flex items-start gap-2">
                  <span className={cn(
                    "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                    completed ? "bg-emerald-500" : dismissed || superseded ? "bg-zinc-300 dark:bg-zinc-600" : "bg-amber-500",
                  )} />
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">建议 {suggestionIndex + 1}</p>
                    <p className="line-clamp-2 text-xs font-medium leading-5 text-zinc-700 dark:text-zinc-200">{suggestion.title}</p>
                    <p className="mt-1 text-[10px] text-zinc-400">{completed ? "已验证" : dismissed ? "已忽略" : superseded ? "历史建议" : "待决策"}{suggestion.generatedAt ? ` · ${formatHumanTime(suggestion.generatedAt)}生成` : ""}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </aside>

        <main className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {!session && !loading ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500 text-base font-bold text-white">AI</div>
                <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">让副驾驶检查当前项目</h2>
                <p className="mt-1 max-w-md text-sm leading-6 text-zinc-500 dark:text-zinc-400">它会读取排名、关键词状态、发布和反馈数据，形成可追问、可执行的工作项。</p>
              </div>
            ) : selectedSuggestion ? (
              <>
                <div className="mb-5 border-b border-zinc-100 dark:border-zinc-800 pb-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-wider text-amber-600 dark:text-amber-400">建议 {selectedSuggestionNumber}</p>
                      <h2 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{selectedSuggestion.title}</h2>
                    </div>
                    {!completedSuggestionIds.has(selectedSuggestion.id) && !dismissedSuggestionIds.has(selectedSuggestion.id) && (
                      <button onClick={() => void dismiss()} className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">忽略</button>
                    )}
                  </div>
                  <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-300"><Markdown>{readableSuggestionReason(selectedSuggestion)}</Markdown></div>
                </div>
                {proposedActions.length > 0 && (
                  <div className="mb-5 rounded-xl border border-amber-200/70 dark:border-amber-500/20 bg-amber-50/50 dark:bg-amber-500/5 p-3">
                    <p className="mb-2 text-[11px] font-medium text-amber-700 dark:text-amber-400">可执行动作</p>
                    <div className="space-y-2">
                      {proposedActions.map((action, actionIndex) => {
                        const executed = !action.kind.endsWith(".open") && (session?.actionRuns || []).some((run) => run.action.id === action.id && run.status === "executed");
                        const confirming = pendingAction?.id === action.id;
                        return (
                          <div key={action.id} className="flex items-center gap-3 rounded-lg bg-white/80 dark:bg-zinc-900/70 px-3 py-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">动作 {selectedSuggestionNumber}.{actionIndex + 1}</p>
                              <p className="text-xs font-medium text-zinc-700 dark:text-zinc-200">{action.label}</p>
                              <p className="mt-0.5 truncate text-[10px] text-zinc-400" title={actionDescription(action)}>{actionDescription(action)}</p>
                            </div>
                            {runningActionId === action.id ? (
                              <button disabled className={cn(btnSmSecondary, "disabled:opacity-60")}>执行中…</button>
                            ) : confirming ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-amber-700 dark:text-amber-400">确认执行？</span>
                                <button onClick={() => void execute(action)} className={btnSmPrimary}>确认</button>
                                <button onClick={() => setPendingAction(null)} className={btnSmSecondary}>取消</button>
                              </div>
                            ) : (
                              <button
                                onClick={() => void execute(action)}
                                disabled={executed || runningActionId === action.id}
                                className={cn(btnSmSecondary, "disabled:opacity-50")}
                              >
                                {executed ? "已执行" : action.kind.endsWith(".open") ? "查看" : action.requiresConfirmation ? "预览" : "执行"}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="mb-5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400">
                这里用于讨论项目整体情况。选择左侧工作项，可以围绕具体证据继续深挖并执行动作。
              </div>
            )}

            {visibleExchanges.map((entry, index) => (
              <div key={`${entry.at}-${index}`} className="mb-4 space-y-2">
                <div className="ml-auto max-w-[82%] rounded-2xl rounded-br-md bg-zinc-900 dark:bg-zinc-100 px-4 py-2.5 text-sm text-white dark:text-zinc-900">
                  {entry.question}
                </div>
                <div className="max-w-[92%] rounded-2xl rounded-bl-md bg-zinc-50 dark:bg-zinc-800/60 px-4 py-2.5 text-sm text-zinc-600 dark:text-zinc-300">
                  <Markdown>{entry.answer}</Markdown>
                </div>
              </div>
            ))}

            {(session?.actionRuns || [])
              .filter((run) => run.suggestionId === (selectedSuggestion?.id || null))
              .map((run) => (
                <div key={run.id} className={cn(
                  "mb-2 rounded-lg border px-3 py-2 text-xs",
                  run.status === "executed"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/5 dark:text-emerald-400"
                    : "border-red-200 bg-red-50 text-red-600 dark:border-red-500/20 dark:bg-red-500/5 dark:text-red-400",
                )}>
                  {run.status === "executed" && run.action.kind.endsWith(".open")
                    ? "已查看"
                    : run.status === "executed"
                      ? (isActionVerified(run) ? "已执行并验证" : "已执行，等待数据验证")
                      : "执行失败"} · {readableActionMessage(run.message)} · {formatHumanTime(run.at)}
                  <span className="ml-1 opacity-60">({actionReference(run.action)})</span>
                </div>
              ))}
          </div>

          <div className="border-t border-zinc-200 dark:border-zinc-800 p-4">
            {error && <p className="mb-2 text-xs text-red-500 dark:text-red-400">{error}</p>}
            <CopilotComposer
              disabled={!session}
              asking={asking}
              placeholder={selectedSuggestion ? "继续追问证据、方案或执行影响…" : "询问项目整体情况…"}
              onSubmit={ask}
            />
          </div>
        </main>
      </div>
      {detailAction && (
        <ActionDetailSheet
          action={detailAction}
          reference={actionReference(detailAction)}
          suggestion={selectedSuggestion}
          project={project}
          product={product}
          onClose={() => setDetailAction(null)}
          onOpenFull={() => {
            const returnTo = selectedSuggestion
              ? `/copilot?suggestion=${encodeURIComponent(selectedSuggestion.id)}`
              : "/copilot";
            navigate(fullActionPath(detailAction), {
              state: {
                copilotReturn: {
                  to: returnTo,
                  label: selectedSuggestionNumber ? `返回建议 ${selectedSuggestionNumber}` : "返回副驾驶",
                },
              },
            });
          }}
        />
      )}
    </div>
  );
}
