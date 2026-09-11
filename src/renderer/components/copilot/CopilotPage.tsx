import { memo, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  BriefProposedAction,
  BriefSuggestion,
} from "@appilot-labs/appilot-core/ai/overview-brief";
import { useProject } from "../../stores/project";
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
  const kind = suggestion.action === "release"
    ? "release.open"
    : suggestion.action === "trend"
      ? "trend.open"
      : "keyword.open";
  return [{
    id: `fallback-${suggestion.id}`,
    kind,
    label: suggestion.action === "release" ? "打开发布" : suggestion.action === "trend" ? "查看趋势" : "查看关键词",
    language,
    keyword: suggestion.target,
    storefront: null,
    requiresConfirmation: false,
  }];
}

function actionDescription(action: BriefProposedAction): string {
  const subject = [action.language, action.keyword].filter(Boolean).join(" · ");
  const store = action.storefront ? ` · ${action.storefront.toUpperCase()}` : "";
  if (action.kind === "keyword.remove") return `从跟踪池移除 ${subject}，并保留可恢复记录`;
  if (action.kind === "keyword.pause") return `暂停跟踪 ${subject}`;
  if (action.kind === "keyword.restore") return `恢复已移除关键词 ${subject}`;
  if (action.kind === "keyword.resume") return `恢复已暂停关键词 ${subject}`;
  if (action.kind === "rank.collect") return `采集 ${action.language || "当前语言"}${store} 的最新排名`;
  if (action.kind === "keyword.open") return `打开并定位 ${subject || "关键词页面"}`;
  if (action.kind === "trend.open") return "打开长期效果页面";
  return "打开发布工作台";
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
    setSelectedId("general");
    setError("");
    void loadSession().catch(() => undefined);
  }, [project?.id, product?.id]);

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
  const selectedSuggestion = session?.suggestions.find((item) => item.id === selectedId) || null;
  const visibleExchanges = (session?.exchanges || []).filter(
    (item) => item.suggestionId === (selectedSuggestion?.id || null),
  );
  const activeKeyword = selectedSuggestion?.target
    ? project?.trackedKeywords.find((item) => item.keyword === selectedSuggestion.target)
    : null;
  const proposedActions = useMemo(() => {
    const items = [
      ...(selectedSuggestion ? fallbackActions(selectedSuggestion, activeKeyword?.language || null) : []),
      ...visibleExchanges.flatMap((item) => item.proposedActions || []),
    ];
    return [...new Map(items.map((item) => [item.id, item])).values()];
  }, [selectedSuggestion, activeKeyword?.language, visibleExchanges]);

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
    if (action.requiresConfirmation && pendingAction?.id !== action.id) {
      setPendingAction(action);
      return;
    }
    setRunningActionId(action.id);
    setError("");
    try {
      if (action.kind === "keyword.open") {
        navigate(action.keyword ? `/keywords?keyword=${encodeURIComponent(action.keyword)}` : "/keywords");
      } else if (action.kind === "trend.open") {
        navigate("/trend");
      } else if (action.kind === "release.open") {
        navigate("/release");
      } else if (action.kind === "keyword.pause" && action.language && action.keyword) {
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
      setPendingAction(null);
      try {
        await recordExecution(action, "executed", actionDescription(action));
      } catch {
        setError("动作已完成，但执行记录保存失败");
      }
      await loadSession();
    } catch (err: any) {
      const message = err?.message || "执行失败";
      await recordExecution(action, "failed", message).catch(() => undefined);
      setError(message);
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
          {(session?.suggestions || []).map((suggestion) => {
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
                    <p className="line-clamp-2 text-xs font-medium leading-5 text-zinc-700 dark:text-zinc-200">{suggestion.title}</p>
                    <p className="mt-1 text-[10px] text-zinc-400">{completed ? "已验证" : dismissed ? "已忽略" : superseded ? "历史建议" : "待决策"}</p>
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
                      <p className="text-[10px] font-medium uppercase tracking-wider text-amber-600 dark:text-amber-400">工作项</p>
                      <h2 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{selectedSuggestion.title}</h2>
                    </div>
                    {!completedSuggestionIds.has(selectedSuggestion.id) && !dismissedSuggestionIds.has(selectedSuggestion.id) && (
                      <button onClick={() => void dismiss()} className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">忽略</button>
                    )}
                  </div>
                  <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-300"><Markdown>{selectedSuggestion.reason}</Markdown></div>
                </div>
                {proposedActions.length > 0 && (
                  <div className="mb-5 rounded-xl border border-amber-200/70 dark:border-amber-500/20 bg-amber-50/50 dark:bg-amber-500/5 p-3">
                    <p className="mb-2 text-[11px] font-medium text-amber-700 dark:text-amber-400">可执行动作</p>
                    <div className="space-y-2">
                      {proposedActions.map((action) => {
                        const executed = !action.kind.endsWith(".open") && (session?.actionRuns || []).some((run) => run.action.id === action.id && run.status === "executed");
                        const confirming = pendingAction?.id === action.id;
                        return (
                          <div key={action.id} className="flex items-center gap-3 rounded-lg bg-white/80 dark:bg-zinc-900/70 px-3 py-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-zinc-700 dark:text-zinc-200">{action.label}</p>
                              <p className="mt-0.5 truncate text-[10px] text-zinc-400" title={actionDescription(action)}>{actionDescription(action)}</p>
                            </div>
                            {confirming ? (
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
                                {executed ? "已执行" : runningActionId === action.id ? "执行中…" : action.requiresConfirmation ? "预览" : "执行"}
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
                  {run.status === "executed" ? (isActionVerified(run) ? "已执行并验证" : "已执行，等待数据验证") : "执行失败"} · {run.message} · {formatHumanTime(run.at)}
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
