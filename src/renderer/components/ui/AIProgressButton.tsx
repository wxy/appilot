import { useEffect, useState } from "react";
import { cn } from "../../lib/utils";
import { formatElapsed, formatKilo } from "../../lib/format";

/**
 * AI 操作按钮（播放/停止状态机）：
 * - 空闲：▶ 播放图标 + 动作文案，点击开始；
 * - 运行中：同一按钮变为 ■ 停止，点击取消本次请求（主进程经 operationId 中止）；
 * - 失败后：回到播放态，文案显示「重试」。
 * 进度与耗时在运行中实时显示，配合顶部的 AI 用量组件同步更新。
 */
export function AIProgressButton({
  onStart,
  onStop,
  disabled = false,
  idleLabel,
  loading,
  progress,
  stopAvailable = true,
  retry = false,
}: {
  onStart: () => void;
  onStop: () => void;
  disabled?: boolean;
  idleLabel: string;
  loading: boolean;
  progress: { chars: number; phase: "reasoning" | "content" } | null;
  /** 运行中是否可停止（有取消通道的操作才显示停止）。 */
  stopAvailable?: boolean;
  /** 上一次运行失败：空闲文案显示「重试」。 */
  retry?: boolean;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [peakChars, setPeakChars] = useState(0);
  const chars = progress?.chars || 0;
  useEffect(() => {
    if (!loading) return;
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [loading]);
  // 重试/修复会重新发起请求导致 chars 回跳；显示峰值让进度单调递增。
  useEffect(() => {
    if (loading) setPeakChars((peak) => Math.max(peak, chars));
    else setPeakChars(0);
  }, [loading, chars]);
  const shownChars = Math.max(chars, peakChars);

  if (loading) {
    return (
      <button
        type="button"
        onClick={stopAvailable ? onStop : undefined}
        disabled={!stopAvailable}
        title={stopAvailable ? "停止并放弃本次生成" : undefined}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-4 text-white font-medium shadow-sm transition-colors hover:bg-violet-700 disabled:opacity-60 disabled:cursor-not-allowed",
          "min-h-10 min-w-36 whitespace-nowrap",
        )}
      >
          <span className="flex flex-col items-center py-0.5 text-[11px] leading-tight">
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="text-yellow-300">■</span>
              {progress?.phase === "content" ? "生成中" : "思考中"}
            </span>
            <span className="mt-0.5 font-mono">{formatKilo(shownChars)} · {formatElapsed(elapsed)}</span>
          </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onStart}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-4 text-white font-medium shadow-sm transition-colors hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed",
        "min-h-10 min-w-36 whitespace-nowrap",
      )}
    >
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true">▶</span>
        <span>{retry ? "重试" : idleLabel}</span>
      </span>
    </button>
  );
}
