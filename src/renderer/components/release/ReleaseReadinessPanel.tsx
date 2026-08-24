import { useCallback, useEffect, useState } from "react";
import type { ReadinessCheckItem, ReadinessStatus } from "../../../engine/readiness-check";
import { cn } from "../../lib/utils";
import { btnSmPrimary, btnSmSecondary } from "../ui/styles";

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
}: {
  projectId: string;
  productId: string;
  draft: { id: string; releaseTag: string };
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
      const next = await (window as any).appilot?.readiness?.check(projectId, productId, draft.releaseTag);
      setResult(next || null);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
      <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">发布就绪体检</h3>
        <button type="button" onClick={() => void handleCheck()} disabled={checking} className={result ? btnSmSecondary : btnSmPrimary}>
          {checking ? "检查中…" : result ? "重新检查" : "检查就绪"}
        </button>
      </div>
      {result ? (
        <div className="px-5 py-4 space-y-2">
          {result.items.map((item) => {
            const style = STATUS_STYLES[item.status];
            return (
              <div key={item.id} className="flex items-start gap-2.5">
                <span className={cn("mt-1.5 w-2 h-2 rounded-full shrink-0", style.dot)} />
                <div className="min-w-0">
                  <div className={cn("text-sm font-medium", style.text)}>{item.label}</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">{item.detail}</div>
                </div>
              </div>
            );
          })}
          <p className="pt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
            检查于 {new Date(result.checkedAt).toLocaleString()}
          </p>
        </div>
      ) : (
        <div className="px-5 py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">
          尚未检查。需要 ASC 凭据回读版本/构建信息，未配置时相关项显示「未知」。
        </div>
      )}
    </div>
  );
}
