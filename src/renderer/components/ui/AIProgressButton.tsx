import { useEffect, useState } from "react";
import { cn } from "../../lib/utils";
import { formatElapsed, formatKilo } from "../../lib/format";

export function AIProgressButton({
  onClick,
  disabled = false,
  idleLabel,
  loading,
  progress,
}: {
  onClick: () => void;
  disabled?: boolean;
  idleLabel: string;
  loading: boolean;
  progress: { chars: number; phase: "reasoning" | "content" } | null;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!loading) return;
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [loading]);
  const chars = progress?.chars || 0;
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-4 text-white font-medium shadow-sm transition-colors hover:bg-violet-700 disabled:opacity-50",
        "min-h-10 min-w-36 whitespace-nowrap",
      )}
    >
      {loading ? (
        <span className="flex flex-col items-center py-0.5 text-[11px] leading-tight">
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
            {progress?.phase === "content" ? "生成中" : "思考中"}
          </span>
          <span className="mt-0.5 font-mono">{formatKilo(chars)} · {formatElapsed(elapsed)}</span>
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true">✦</span>
          <span>{idleLabel}</span>
        </span>
      )}
    </button>
  );
}
