import { cn } from "../../lib/utils";
import { formatHumanTime } from "../../lib/format";
import { btnSmPrimary } from "../ui/styles";

type CheckStatus = "pass" | "fail" | "warn" | "warning" | "unknown";

interface CheckRow {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  items?: Array<{ label: string; kind?: string }>;
}

function CheckList({ checks, empty }: { checks: CheckRow[]; empty: string }) {
  if (checks.length === 0) {
    return <p className="py-2 text-xs text-zinc-500 dark:text-zinc-400">{empty}</p>;
  }

  return (
    <div className="space-y-2">
      {checks.map((check) => {
        const tone =
          check.status === "pass"
            ? "bg-emerald-500"
            : check.status === "fail"
              ? "bg-red-500"
              : check.status === "warn" || check.status === "warning"
                ? "bg-amber-500"
                : "bg-zinc-400";
        const statusLabel =
          check.status === "pass"
            ? "通过"
            : check.status === "fail"
              ? "不通过"
              : check.status === "warn" || check.status === "warning"
                ? "提醒"
                : "未知";
        return (
          <div
            key={check.id}
            className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-700"
          >
            <div className="flex items-start gap-2">
              <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", tone)} />
              <div className="min-w-0 flex-1">
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  {check.label}
                </span>
                <span className="ml-1.5 text-[10px] text-zinc-400">
                  [{statusLabel}]
                </span>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {check.detail}
                </p>
                {(check.items || []).length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {(check.items || []).map((item, index) => (
                      <span
                        key={`${item.kind}:${item.label}:${index}`}
                        className={cn(
                          "rounded-md px-1.5 py-0.5 text-[10px]",
                          item.kind === "capability"
                            ? "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400"
                            : "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400",
                        )}
                      >
                        {item.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function PreReleaseChecklistPanel({
  checklist,
  readiness,
  running,
  onRun,
}: {
  checklist: { updatedAt?: string; checks?: CheckRow[] } | null;
  readiness: { checkedAt?: string; items?: CheckRow[] } | null;
  running: boolean;
  onRun: () => void;
}) {
  const projectChecks = checklist?.checks || [];
  const storeChecks = readiness?.items || [];
  const allChecks = [...projectChecks, ...storeChecks];
  const failed = allChecks.filter((item) => item.status === "fail").length;
  const warnings = allChecks.filter(
    (item) => item.status === "warn" || item.status === "warning" || item.status === "unknown",
  ).length;
  const passed = allChecks.filter((item) => item.status === "pass").length;
  const lastCheckedAt = readiness?.checkedAt || checklist?.updatedAt;

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-100 bg-zinc-50/50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              发布检查
            </h4>
            {allChecks.length > 0 && (
              <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                {passed} 通过 · {warnings} 提醒 · {failed} 不通过
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
            {lastCheckedAt
              ? `上次检查于 ${formatHumanTime(lastCheckedAt)}`
              : "检查代码、发布文案和 App Store 提交条件"}
          </p>
        </div>
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className={cn(btnSmPrimary, "disabled:cursor-not-allowed disabled:opacity-50")}
        >
          {running
            ? "检查中…"
            : projectChecks.length > 0 && storeChecks.length > 0
              ? "重新检查"
              : "运行全部检查"}
        </button>
      </div>
      <div className="grid gap-5 p-4 lg:grid-cols-2">
        <section>
          <div className="mb-2">
            <h5 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">项目与构建</h5>
            <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
              代码版本、构建产物、权限声明与待处理文案缺口
            </p>
          </div>
          <CheckList checks={projectChecks} empty="尚未运行项目检查。" />
        </section>
        <section>
          <div className="mb-2">
            <h5 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">商店提交条件</h5>
            <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
              语言覆盖、字段限制、目标版本与构建挂载
            </p>
          </div>
          <CheckList
            checks={storeChecks}
            empty="生成或恢复发布文案后，可检查商店提交条件。"
          />
        </section>
      </div>
    </div>
  );
}
