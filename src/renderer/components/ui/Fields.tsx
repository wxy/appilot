import type { ReactNode } from "react";
import { CopyButton } from "./CopyButton";

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
  text,
  copy = true,
}: {
  label: string;
  text: string;
  copy?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500">{label}</span>
      {copy ? <CopyButton text={text} /> : null}
    </div>
  );
}
