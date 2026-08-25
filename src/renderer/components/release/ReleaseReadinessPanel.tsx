import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { ReadinessCheckItem, ReadinessStatus } from "../../../engine/readiness-check";
import { cn } from "../../lib/utils";
import { formatHumanTime } from "../../lib/format";
import { btnSmPrimary, btnSmSecondary } from "../ui/styles";
import { AppleIcon, GithubIcon } from "../ui/Icons";

const STATUS_STYLES: Record<ReadinessStatus, { dot: string; text: string }> = {
  pass: { dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400" },
  fail: { dot: "bg-red-500", text: "text-red-700 dark:text-red-400" },
  warning: { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400" },
  unknown: { dot: "bg-zinc-400", text: "text-zinc-500 dark:text-zinc-400" },
};

export function ReleaseReadinessPanel({
  projectId,
  productId,
  draft,
  githubNode,
  copyNode,
  storeNode,
  alerts,
  onAscRefresh,
  ascRefreshing,
  ascInfo,
}: {
  projectId: string;
  productId: string;
  draft: { id: string; releaseTag: string };
  /** GitHub 发布节点内容。 */
  githubNode?: ReactNode;
  /** 本地文案草案节点内容。 */
  copyNode?: ReactNode;
  /** 商店版本节点内容。 */
  storeNode?: ReactNode;
  /** 动态提醒与警告（未创建版本、上架提醒等）。 */
  alerts?: ReactNode;
  onAscRefresh?: () => Promise<void>;
  ascRefreshing?: boolean;
  ascInfo?: { fetchedAt?: string } | null;
}) {
  const [result, setResult] = useState<{ checkedAt: string; items: ReadinessCheckItem[] } | null>(null);
  const [checking, setChecking] = useState(false);

  const loadCached = useCallback(() => {
    (window as any).appilot?.readiness?.get(projectId, draft.id)
      .then(setResult)
      .catch(() => setResult(null));
  }, [projectId, draft.id]);

  useEffect(() => { loadCached(); }, [loadCached]);

  const handleCheck = async () => {
    setChecking(true);
    try {
      // 检查 ASC 发布前先刷新 ASC 缓存，保证基于最新外部状态。
      if (onAscRefresh) await onAscRefresh();
      const next = await (window as any).appilot?.readiness?.check(projectId, productId, draft.releaseTag);
      setResult(next || null);
    } finally {
      setChecking(false);
    }
  };

  const FlowNode = ({
    title,
    icon,
    children,
  }: {
    title: string;
    icon?: ReactNode;
    children: ReactNode;
  }) => (
    <div className="flex-1 min-w-0 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-zinc-400 dark:text-zinc-500 mb-2">
        {icon}
        {title}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
      <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">发布 → 文案 → 商店</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleCheck()}
            disabled={checking || ascRefreshing}
            className={cn("inline-flex items-center gap-1.5", result ? btnSmSecondary : btnSmPrimary)}
          >
            <AppleIcon className="w-3 h-3" />
            {checking ? "检查中…" : "检查 ASC 发布"}
          </button>
          {onAscRefresh && (
            <button
              type="button"
              onClick={() => void onAscRefresh()}
              disabled={ascRefreshing}
              className="text-[11px] text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              {ascRefreshing
                ? "刷新中…"
                : ascInfo?.fetchedAt
                  ? `ASC ${formatHumanTime(ascInfo.fetchedAt)}`
                  : "刷新 ASC"}
            </button>
          )}
        </div>
      </div>
      <div className="px-5 py-4">
        <div className="flex items-stretch gap-2">
          <FlowNode title="GitHub 发布" icon={<GithubIcon className="w-3 h-3" />}>
            {githubNode || <span className="text-[11px] text-zinc-400 dark:text-zinc-500">—</span>}
          </FlowNode>
          <div className="flex items-center text-zinc-300 dark:text-zinc-600 text-sm shrink-0" aria-hidden="true">
            →
          </div>
          <FlowNode title="文案草案">
            {copyNode || <span className="text-[11px] text-zinc-400 dark:text-zinc-500">—</span>}
          </FlowNode>
          <div className="flex items-center text-zinc-300 dark:text-zinc-600 text-sm shrink-0" aria-hidden="true">
            →
          </div>
          <FlowNode title="商店版本" icon={<AppleIcon className="w-3 h-3" />}>
            {storeNode || <span className="text-[11px] text-zinc-400 dark:text-zinc-500">—</span>}
          </FlowNode>
        </div>
        {alerts && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-zinc-100 dark:border-zinc-800 pt-2.5">
            {alerts}
          </div>
        )}
        {result && (
          (() => {
            const issues = result.items.filter((item) => item.status !== "pass");
            if (issues.length === 0) return null;
            return (
              <div className="mt-3 border-t border-zinc-100 dark:border-zinc-800 pt-2.5 space-y-1.5">
                {issues.map((item) => {
                  const style = STATUS_STYLES[item.status];
                  return (
                    <div key={item.id} className="flex items-start gap-2">
                      <span className={cn("mt-1.5 w-2 h-2 rounded-full shrink-0", style.dot)} />
                      <div className="min-w-0">
                        <span className={cn("text-xs font-medium", style.text)}>{item.label}：</span>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">{item.detail}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()
        )}
      </div>
    </div>
  );
}
