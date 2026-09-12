import type { ReactNode } from "react";

export function FieldBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500 mb-2">{label}</p>
      {children}
    </div>
  );
}

export function FieldHeader({
  label,
  copyStatus,
}: {
  label: string;
  copyStatus?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500">{label}</span>
      {copyStatus ? (
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
          {copyStatus}
        </span>
      ) : null}
    </div>
  );
}
