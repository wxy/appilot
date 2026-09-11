import { memo, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  BriefProposedAction,
  BriefSuggestion,
} from "@appilot-labs/appilot-core/ai/overview-brief";
import { briefActionCapability } from "@appilot-labs/appilot-core/ai/overview-brief";
import { useProject, type StoreProduct } from "../../stores/project";
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
  resultContextId?: string | null;
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

function completedRankRunSummary(run: ActionRun, snapshots: StoreProduct["rankSnapshots"]): string | null {
  if (run.action.kind !== "rank.collect") return null;
  const endedAt = new Date(run.at).getTime();
  const startedAt = endedAt - 20 * 60_000;
  const relevant = snapshots.filter((snapshot) => {
    const checkedAt = new Date(snapshot.checkedAt).getTime();
    return snapshot.language === run.action.language
      && (!run.action.storefront || snapshot.storefront === run.action.storefront)
      && checkedAt >= startedAt
      && checkedAt <= endedAt + 2 * 60_000;
  });
  const latest = new Map<string, (typeof relevant)[number]>();
  for (const snapshot of relevant) {
    const key = `${snapshot.keyword}\u0000${snapshot.storefront}`;
    const previous = latest.get(key);
    if (!previous || new Date(snapshot.checkedAt).getTime() > new Date(previous.checkedAt).getTime()) {
      latest.set(key, snapshot);
    }
  }
  if (latest.size === 0) return "没有找到可归属于本次执行窗口的新快照，不能声称已经验证结果。";
  const values = [...latest.values()];
  const ranked = values.filter((snapshot) => snapshot.rank != null).length;
  const top10 = values.filter((snapshot) => snapshot.rank != null && snapshot.rank <= 10).length;
  const stores = new Set(values.map((snapshot) => snapshot.storefront)).size;
  let comparable = 0;
  let improved = 0;
  let declined = 0;
  let unchanged = 0;
  let newlyRanked = 0;
  let droppedOut = 0;
  const previousByTarget = new Map<string, (typeof snapshots)[number]>();
  for (const snapshot of snapshots) {
    const checkedAt = new Date(snapshot.checkedAt).getTime();
    if (snapshot.language !== run.action.language || checkedAt >= startedAt) continue;
    const key = `${snapshot.keyword}\u0000${snapshot.storefront}`;
    const previous = previousByTarget.get(key);
    if (!previous || checkedAt > new Date(previous.checkedAt).getTime()) {
      previousByTarget.set(key, snapshot);
    }
  }
  for (const current of values) {
    const previous = previousByTarget.get(`${current.keyword}\u0000${current.storefront}`);
    if (!previous) continue;
    comparable += 1;
    if (previous.rank == null && current.rank != null) newlyRanked += 1;
    else if (previous.rank != null && current.rank == null) droppedOut += 1;
    else if (previous.rank != null && current.rank != null) {
      if (current.rank < previous.rank) improved += 1;
      else if (current.rank > previous.rank) declined += 1;
      else unchanged += 1;
    } else {
      unchanged += 1;
    }
  }
  const comparison = comparable > 0
    ? `与执行前可比的 ${comparable} 个目标中，改善 ${improved}、下降 ${declined}、不变 ${unchanged}、新入榜 ${newlyRanked}、掉榜 ${droppedOut}。`
    : "缺少同目标的执行前快照，无法比较变化。";
  return `执行时间窗口内找到 ${values.length} 个关键词×商店快照，覆盖 ${stores} 个商店；${ranked} 个目标有排名，${top10} 个进入前 10。${comparison}旧执行记录没有保存批次标识和失败数，无法证明这些快照都来自本次动作；这次动作本身也没有产生增长效果。`;
}

function actionDescription(action: BriefProposedAction): string {
  const subject = [action.language, action.keyword].filter(Boolean).join(" · ");
  const store = action.storefront ? ` · ${action.storefront.toUpperCase()}` : "";
  if (action.kind === "keyword.remove") return `从跟踪池移除 ${subject}，并保留可恢复记录`;
  if (action.kind === "keyword.pause") return `暂停跟踪 ${subject}`;
  if (action.kind === "keyword.restore") return `恢复已移除关键词 ${subject}`;
  if (action.kind === "keyword.resume") return `恢复已暂停关键词 ${subject}`;
  if (action.kind === "rank.collect") return `${action.language || "当前语言"}${store} 排名由任务中心每日自动更新`;
  if (action.kind === "keyword.open") return `查看 ${subject || "关键词"} 的相关数据`;
  if (action.kind === "trend.open") return "查看与建议有关的趋势信息";
  return "查看与建议有关的发布信息";
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
  } = useProject();
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
  const proposedActions = useMemo(() => {
    const items = [
      ...(selectedSuggestion?.proposedActions || []),
      ...visibleExchanges.flatMap((item) => item.proposedActions || []),
    ].filter((action) =>
      action.kind !== "trend.open" && (
        briefActionCapability(action.kind).recommendationEligible
        || (session?.actionRuns || []).some((run) => run.action.id === action.id)
      ),
    );
    return [...new Map(items.map((item) => [item.id, item])).values()];
  }, [selectedSuggestion, visibleExchanges, session?.actionRuns]);

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
    if (!briefActionCapability(action.kind).recommendationEligible) return;
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
      detail: "请求已提交，正在执行…",
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
      } else {
        throw new Error("动作参数不完整，无法执行");
      }
      setTaskFeedback((current) => current?.actionId === action.id
        ? { ...current, state: "success", detail: "动作已完成" }
        : current);
      let recorded = true;
      try {
        await recordExecution(action, "executed", actionDescription(action));
      } catch {
        recorded = false;
        setTaskFeedback((current) => current?.actionId === action.id
          ? { ...current, state: "success", detail: "动作已完成，但执行记录保存失败" }
          : current);
      }
      if (recorded) {
        await loadSession();
        setTaskFeedback((current) => current?.actionId === action.id ? null : current);
      }
    } catch (err: any) {
      const message = readableActionMessage(err?.message || "执行失败");
      setTaskFeedback((current) => current?.actionId === action.id
        ? { ...current, state: "failed", detail: message }
        : current);
      const recorded = await recordExecution(action, "failed", message)
        .then(() => true)
        .catch(() => false);
      if (recorded) {
        await loadSession().catch(() => undefined);
        setTaskFeedback((current) => current?.actionId === action.id ? null : current);
      }
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
                    <p className="mt-1 text-[10px] text-zinc-400">{completed ? "动作已完成，效果待复核" : dismissed ? "已忽略" : superseded ? "历史建议" : "待决策"}{suggestion.generatedAt ? ` · ${formatHumanTime(suggestion.generatedAt)}生成` : ""}</p>
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
                  {(selectedSuggestion.expectedOutcome || selectedSuggestion.successMetric) && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {selectedSuggestion.expectedOutcome && (
                        <div className="rounded-lg bg-emerald-50/70 px-3 py-2 dark:bg-emerald-500/10">
                          <p className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400">预期正向变化</p>
                          <p className="mt-1 text-xs leading-5 text-emerald-800 dark:text-emerald-300">{selectedSuggestion.expectedOutcome}</p>
                        </div>
                      )}
                      {selectedSuggestion.successMetric && (
                        <div className="rounded-lg bg-sky-50/70 px-3 py-2 dark:bg-sky-500/10">
                          <p className="text-[10px] font-medium text-sky-700 dark:text-sky-400">如何判断有效</p>
                          <p className="mt-1 text-xs leading-5 text-sky-800 dark:text-sky-300">
                            {selectedSuggestion.successMetric}
                            {selectedSuggestion.evaluateAfterDays ? ` · ${selectedSuggestion.evaluateAfterDays} 天后复核` : ""}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {proposedActions.length > 0 && (
                  <div className="mb-5 rounded-xl border border-amber-200/70 dark:border-amber-500/20 bg-amber-50/50 dark:bg-amber-500/5 p-3">
                    <p className="mb-2 text-[11px] font-medium text-amber-700 dark:text-amber-400">可执行动作</p>
                    <div className="space-y-2">
                      {proposedActions.map((action, actionIndex) => {
                        const capability = briefActionCapability(action.kind);
                        const actionRuns = (session?.actionRuns || []).filter((run) => run.action.id === action.id);
                        const executed = !action.kind.endsWith(".open") && actionRuns.some((run) => run.status === "executed");
                        const confirming = pendingAction?.id === action.id;
                        const feedback = taskFeedback?.actionId === action.id ? taskFeedback : null;
                        return (
                          <div key={action.id} className="rounded-lg bg-white/80 dark:bg-zinc-900/70 px-3 py-2.5">
                            <div className="flex items-center gap-3">
                              <div className="min-w-0 flex-1">
                                <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">动作 {selectedSuggestionNumber}.{actionIndex + 1}</p>
                                <p className="text-xs font-medium text-zinc-700 dark:text-zinc-200">{action.label}</p>
                                <p className="mt-0.5 truncate text-[10px] text-zinc-400" title={actionDescription(action)}>{actionDescription(action)}</p>
                                {capability.recommendationEligible && (
                                  <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">执行后验证：{capability.verification}</p>
                                )}
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
                                  disabled={executed || !capability.recommendationEligible || runningActionId === action.id}
                                  className={cn(btnSmSecondary, "disabled:opacity-50")}
                                >
                                  {executed ? "已执行" : !capability.recommendationEligible ? "已停用" : action.requiresConfirmation ? "预览" : "执行"}
                                </button>
                              )}
                            </div>
                            {feedback && (
                              <div className={cn(
                                "mt-2 flex items-start gap-2 border-t pt-2 text-[11px]",
                                feedback.state === "running"
                                  ? "border-amber-100 text-amber-700 dark:border-amber-500/15 dark:text-amber-400"
                                  : feedback.state === "success"
                                    ? "border-emerald-100 text-emerald-700 dark:border-emerald-500/15 dark:text-emerald-400"
                                    : "border-red-100 text-red-600 dark:border-red-500/15 dark:text-red-400",
                              )}>
                                <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", feedback.state === "running" ? "animate-pulse bg-amber-500" : feedback.state === "success" ? "bg-emerald-500" : "bg-red-500")} />
                                <span className="flex-1">{feedback.detail}</span>
                                {feedback.state !== "running" && <button onClick={() => setTaskFeedback(null)} className="opacity-60 hover:opacity-100">关闭</button>}
                              </div>
                            )}
                            {actionRuns.map((run, runIndex) => {
                              const rankResult = completedRankRunSummary(run, product.rankSnapshots || []);
                              return (
                              <div key={run.id} className={cn(
                                "mt-2 border-t pt-2 text-[11px]",
                                run.status === "executed"
                                  ? "border-emerald-100 text-emerald-700 dark:border-emerald-500/15 dark:text-emerald-400"
                                  : "border-red-100 text-red-600 dark:border-red-500/15 dark:text-red-400",
                              )}>
                                <div>
                                  {run.status === "executed" && run.action.kind.endsWith(".open")
                                    ? "已查看"
                                    : run.status === "executed"
                                      ? (isActionVerified(run) ? "动作已完成，效果待复核" : "已执行，等待确认状态")
                                      : "执行失败"}
                                  <> · {readableActionMessage(run.message)} · {formatHumanTime(run.at)}</>
                                </div>
                                {rankResult && <p className="mt-1.5 leading-5 opacity-90">{rankResult}</p>}
                                {runIndex === 0 && run.status === "executed" && (
                                  <button
                                    onClick={() => void ask(
                                      `请比较动作 ${selectedSuggestionNumber}.${actionIndex + 1} 执行前后的数据，说明结果、是否达到预期，以及下一步应该做什么。`,
                                    )}
                                    disabled={asking}
                                    className="mt-1.5 font-medium underline decoration-emerald-300 underline-offset-2 hover:text-emerald-800 disabled:opacity-50 dark:hover:text-emerald-300"
                                  >
                                    {run.resultContextId ? "重新分析执行结果" : "分析执行结果"}
                                  </button>
                                )}
                              </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="mb-5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400">
                {session && pendingCount === 0
                  ? "当前没有证据充分、可直接执行并能复核效果的新建议。副驾驶不会用查看、检查或刷新数据来凑数。"
                  : "这里用于讨论项目整体情况。选择左侧工作项，可以围绕具体证据继续深挖并执行动作。"}
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
    </div>
  );
}
