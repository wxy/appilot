import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type InputHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";
import { cn } from "../../lib/utils";

type CopyState = "idle" | "copied" | "current";

interface CopyFeedbackValue {
  copiedKeys: Set<string>;
  currentKey: string;
  copy: (key: string, text: string) => Promise<boolean>;
}

const CopyFeedbackContext = createContext<CopyFeedbackValue | null>(null);

export function CopyFeedbackProvider({
  scopeKey,
  children,
}: {
  scopeKey: string;
  children: ReactNode;
}) {
  const [copiedKeys, setCopiedKeys] = useState<Set<string>>(new Set());
  const [currentKey, setCurrentKey] = useState("");

  useEffect(() => {
    setCopiedKeys(new Set());
    setCurrentKey("");
  }, [scopeKey]);

  const copy = useCallback(async (key: string, text: string) => {
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKeys((current) => new Set(current).add(key));
      setCurrentKey(key);
      return true;
    } catch {
      return false;
    }
  }, []);

  const value = useMemo(
    () => ({ copiedKeys, currentKey, copy }),
    [copiedKeys, currentKey, copy],
  );
  return (
    <CopyFeedbackContext.Provider value={value}>
      {children}
    </CopyFeedbackContext.Provider>
  );
}

export function useCopyableField(key: string, text: string) {
  const feedback = useContext(CopyFeedbackContext);
  const state: CopyState = feedback?.currentKey === key
    ? "current"
    : feedback?.copiedKeys.has(key)
      ? "copied"
      : "idle";
  const onDoubleClick = async (
    event: MouseEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    event.preventDefault();
    const copied = await feedback?.copy(key, text);
    if (copied) {
      const control = event.currentTarget;
      control.setSelectionRange?.(control.selectionStart || 0, control.selectionStart || 0);
    }
  };
  return {
    state,
    onDoubleClick,
    title: text ? "双击复制全部内容" : undefined,
    statusLabel: state === "current" ? "当前复制" : state === "copied" ? "已复制" : "双击复制",
    className: cn(
      "transition-[background-color,border-color,box-shadow] duration-150",
      state === "current" &&
        "border-amber-400 bg-amber-50/90 ring-2 ring-amber-500/15 dark:border-amber-500/80 dark:bg-amber-500/10",
      state === "copied" &&
        "border-emerald-300 bg-emerald-50/60 dark:border-emerald-700/80 dark:bg-emerald-500/[0.07]",
    ),
  };
}

export function CopyableTextInput({
  copyKey,
  value,
  className,
  title,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value"> & {
  copyKey: string;
  value: string;
}) {
  const copyable = useCopyableField(copyKey, value);
  const statusTitle = value
    ? [title, copyable.title, copyable.statusLabel].filter(Boolean).join(" · ")
    : title;
  return (
    <input
      {...props}
      value={value}
      onDoubleClick={copyable.onDoubleClick}
      title={statusTitle}
      data-copy-state={copyable.state}
      className={cn(className, copyable.className)}
    />
  );
}
