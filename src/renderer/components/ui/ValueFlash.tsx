import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../../lib/utils";

/**
 * 数据局部更新反馈：绑定的 value 变化时，在元素所在位置播放一次动画。
 * mode 按元素类型区分：
 * - "box"：表格格子背景闪烁（排名单元格、竞品跟踪格子）
 * - "text"：数字/标签自身放大变色（状态徽章、指标）
 * - "input"：输入框边框高亮
 */
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
  const prevRef = useRef(value);
  const [flashing, setFlashing] = useState(false);

  useEffect(() => {
    if (value !== prevRef.current) {
      prevRef.current = value;
      setFlashing(true);
      const timer = setTimeout(() => setFlashing(false), 1100);
      return () => clearTimeout(timer);
    }
  }, [value]);

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
