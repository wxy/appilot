import { cn } from "../../lib/utils";

export function StatusChip({
  label,
  tone,
}: {
  label: string;
  tone: "muted" | "amber" | "emerald" | "red" | "blue";
}) {
  const tones: Record<string, string> = {
    muted: "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400",
    amber: "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400",
    emerald: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    red: "bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400",
    blue: "bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-400",
  };
  return (
    <span
      className={cn(
        "shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium",
        tones[tone],
      )}
    >
      {label}
    </span>
  );
}
