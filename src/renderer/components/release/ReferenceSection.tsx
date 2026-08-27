import { useState, type ReactNode } from "react";
import { cn } from "../../lib/utils";

export function ReferenceSection({
  title,
  meta,
  checked = false,
  defaultOpen = false,
  action,
  children,
}: {
  title: string;
  meta?: string;
  checked?: boolean;
  defaultOpen?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div className="w-full flex items-center justify-between gap-3 px-5 py-3.5">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2.5 min-w-0 text-left"
          title={open ? "折叠" : "展开"}
        >
          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{title}</span>
          {checked ? <span className="text-xs text-emerald-500 shrink-0">✓</span> : null}
          {meta ? (
            <span className="text-xs text-zinc-400 dark:text-zinc-500 truncate">{meta}</span>
          ) : null}
        </button>
        <span className="flex items-center gap-1.5 shrink-0">
          {action}
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="p-1 -m-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            title={open ? "折叠" : "展开"}
            aria-label={open ? "折叠" : "展开"}
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              className={cn(
                "w-4 h-4 text-zinc-400 dark:text-zinc-500 shrink-0 transition-transform duration-200",
                open && "rotate-180",
              )}
            >
              <path
                d="M4 6l4 4 4-4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </span>
      </div>
      {open ? <div className="px-5 pb-5">{children}</div> : null}
    </div>
  );
}
