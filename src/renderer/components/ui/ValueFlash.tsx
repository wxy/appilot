import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "../../lib/utils";

/**
 * 数据局部更新反馈：绑定的 value 相对上一次渲染**确实变化**时，在元素所在位置播放一次动画。
 * mode 按元素类型区分：
 * - "box"：表格格子背景闪烁（排名单元格、竞品跟踪格子）
 * - "text"：数字/标签自身放大变色（状态徽章、指标）
 * - "input"：输入框边框高亮
 *
 * 变化判定用归一化键而不是引用比较：null/字符串/数字/布尔按内容比较，
 * 对象/数组先 JSON 序列化再比较——每次 render 产生的新对象引用若内容相同
 * 视为未变化，不播放，规避“相同值刷新反复闪烁”的误判。首次挂载只记录
 * 基线不播放（避免整页初次加载时全表格子集体闪烁）。
 */
function stableKey(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    try {
      return `json:${JSON.stringify(value)}`;
    } catch {
      // 循环引用等不可序列化对象：退回引用级比较（退化为旧行为）。
      return `obj:${Object.prototype.toString.call(value)}`;
    }
  }
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "number" && Number.isNaN(value)) return "NaN";
  return `${typeof value}:${String(value)}`;
}

export function ValueFlash({
  value,
  mode = "text",
  className,
  children,
}: {
  value: unknown;
  mode?: "box" | "text" | "input";
  className?: string;
  children: ReactNode;
}) {
  // 归一化键：value 内容没变（即使是新对象引用）时键稳定，effect 不会重跑。
  const valueKey = useMemo(() => stableKey(value), [value]);
  const prevKeyRef = useRef<string | null>(null);
  const mountedRef = useRef(false);
  const [flashing, setFlashing] = useState(false);

  useEffect(() => {
    // 首次挂载只记录基线，不播放动画（整页初次加载不应整表闪烁）。
    if (!mountedRef.current) {
      mountedRef.current = true;
      prevKeyRef.current = valueKey;
      return;
    }
    // 与上一次渲染内容相同（相同值刷新 / 对象内容未变的新引用）→ 不播。
    if (valueKey === prevKeyRef.current) return;
    prevKeyRef.current = valueKey;
    setFlashing(true);
    const timer = setTimeout(() => setFlashing(false), 1100);
    return () => clearTimeout(timer);
  }, [valueKey]);

  const flashClass = flashing
    ? mode === "box"
      ? "flash-bg"
      : mode === "input"
        ? "flash-input"
        : "flash-text"
    : undefined;

  if (mode === "input") {
    return <span className={cn("block", flashClass, className)}>{children}</span>;
  }
  return (
    <span className={cn("inline-flex items-baseline", flashClass, className)}>
      {children}
    </span>
  );
}
