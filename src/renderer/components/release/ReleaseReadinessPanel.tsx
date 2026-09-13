import type { ReactNode } from "react";
import { formatHumanTime } from "../../lib/format";
import { AppleIcon, GithubIcon } from "../ui/Icons";
import { btnSmSecondary } from "../ui/styles";

export function ReleaseReadinessPanel({
  githubNode,
  githubPrimaryAction,
  copyNode,
  copyPrimaryAction,
  copyActions,
  storeNode,
  storePrimaryAction,
  alerts,
  onAscRefresh,
  ascRefreshing,
  ascInfo,
  onCheckGithub,
  checkingGithub,
  githubLastCheckedAt,
  githubWarning,
  onToggleChecklist,
  checklistOpen,
}: {
  /** GitHub 发布节点内容。 */
  githubNode?: ReactNode;
  /** GitHub 节点的主要打开动作。 */
  githubPrimaryAction?: ReactNode;
  /** 本地文案草案节点内容。 */
  copyNode?: ReactNode;
  /** 发布文案节点的主要打开动作。 */
  copyPrimaryAction?: ReactNode;
  /** 发布文案节点中的查看、创建与维护动作。 */
  copyActions?: ReactNode;
  /** 商店版本节点内容。 */
  storeNode?: ReactNode;
  /** 商店节点的主要打开动作。 */
  storePrimaryAction?: ReactNode;
  /** 动态提醒与警告（未创建版本、上架提醒等）。 */
  alerts?: ReactNode;
  onAscRefresh?: () => Promise<void>;
  ascRefreshing?: boolean;
  ascInfo?: { fetchedAt?: string } | null;
  onCheckGithub?: () => void;
  checkingGithub?: boolean;
  githubLastCheckedAt?: string | null;
  /** 权限等导致发布草案不可见时的提示（与当前发布节点是否已加载无关）。 */
  githubWarning?: ReactNode;
  /** 切换统一的发布检查面板。 */
  onToggleChecklist?: () => void;
  /** 发布检查面板当前是否打开（用于按钮文案）。 */
  checklistOpen?: boolean;
}) {
  const actionButtonClass = `${btnSmSecondary} disabled:cursor-not-allowed disabled:opacity-50`;

  const FlowNode = ({
    title,
    icon,
    children,
    primaryAction,
    actions,
  }: {
    title: string;
    icon?: ReactNode;
    children: ReactNode;
    primaryAction?: ReactNode;
    actions?: ReactNode;
  }) => (
    <div className="flex-1 min-w-0 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-zinc-400 dark:text-zinc-500 mb-2">
        {icon}
        {title}
      </div>
      {primaryAction && <div className="mb-2.5">{primaryAction}</div>}
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
      {actions && (
        <div className="mt-2.5 pt-2.5 border-t border-zinc-100 dark:border-zinc-800 flex flex-wrap gap-1.5">
          {actions}
        </div>
      )}
    </div>
  );

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
      <div className="p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">发布流程</h3>
            <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
              GitHub 发布、发布文案与商店状态
            </p>
          </div>
          {onToggleChecklist && (
            <button
              type="button"
              onClick={onToggleChecklist}
              className={actionButtonClass}
              title="检查代码、文案、目标版本、语言覆盖和构建挂载"
            >
              <AppleIcon className="w-3 h-3" />
              {checklistOpen ? "返回发布流程" : "发布检查"}
            </button>
          )}
        </div>
        <div className="flex flex-col items-stretch gap-2 lg:flex-row">
          <FlowNode
            title="GitHub 发布"
            icon={<GithubIcon className="w-3 h-3" />}
            primaryAction={githubPrimaryAction}
            actions={
              <>
                {onCheckGithub && (
                  <button
                    type="button"
                    onClick={onCheckGithub}
                    disabled={checkingGithub}
                    className={actionButtonClass}
                    title="从 GitHub 检测新的发布草案、已发布或提交变化"
                  >
                    <GithubIcon className="w-3 h-3" />
                    {checkingGithub ? "检查中…" : "检查 GitHub 发布"}
                  </button>
                )}
                <span
                  className="self-center text-[10px] text-zinc-400 dark:text-zinc-500"
                  title={githubLastCheckedAt ? new Date(githubLastCheckedAt).toLocaleString() : undefined}
                >
                  上次检查：{githubLastCheckedAt ? formatHumanTime(githubLastCheckedAt) : "尚未检查"}
                </span>
              </>
            }
          >
            {githubNode || <span className="text-[11px] text-zinc-400 dark:text-zinc-500">—</span>}
            {githubWarning && (
              <span className="w-full text-[10px] text-amber-600 dark:text-amber-400">
                {githubWarning}
              </span>
            )}
          </FlowNode>
          <div className="flex rotate-90 items-center justify-center text-zinc-300 dark:text-zinc-600 text-sm shrink-0 lg:rotate-0" aria-hidden="true">
            →
          </div>
          <FlowNode
            title="发布文案"
            primaryAction={copyPrimaryAction}
            actions={copyActions}
          >
            {copyNode || <span className="text-[11px] text-zinc-400 dark:text-zinc-500">—</span>}
          </FlowNode>
          <div className="flex rotate-90 items-center justify-center text-zinc-300 dark:text-zinc-600 text-sm shrink-0 lg:rotate-0" aria-hidden="true">
            →
          </div>
          <FlowNode
            title="商店版本"
            icon={<AppleIcon className="w-3 h-3" />}
            primaryAction={storePrimaryAction}
            actions={
              <>
                {onAscRefresh && (
                  <button
                    type="button"
                    onClick={() => void onAscRefresh()}
                    disabled={ascRefreshing}
                    className={actionButtonClass}
                  >
                    <AppleIcon className="w-3 h-3" />
                    {ascRefreshing ? "检查中…" : "检查商店状态"}
                  </button>
                )}
                {ascInfo?.fetchedAt && (
                  <span className="self-center text-[10px] text-zinc-400 dark:text-zinc-500">
                    更新于 {formatHumanTime(ascInfo.fetchedAt)}
                  </span>
                )}
              </>
            }
          >
            {storeNode || <span className="text-[11px] text-zinc-400 dark:text-zinc-500">—</span>}
          </FlowNode>
        </div>
        {/* 固定站位：切换视图/发布时提醒内容变化，但占位高度不变，
            避免流程图下方布局抖动。 */}
        <div className="mt-3 flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1 border-t border-zinc-100 dark:border-zinc-800 pt-2.5">
          {alerts || <span className="text-[11px] text-zinc-400/60">暂无提醒</span>}
        </div>
      </div>
    </div>
  );
}
