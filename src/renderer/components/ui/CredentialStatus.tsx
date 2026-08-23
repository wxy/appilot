export function CredentialStatus({
  unlocked,
  source,
}: {
  unlocked: boolean;
  source: string | null;
}) {
  if (!unlocked) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] text-zinc-400 dark:text-zinc-500"
        title="先填写并测试通过，再保存后解锁"
      >
        <span className="text-zinc-300 dark:text-zinc-600">🔒</span> 未解锁
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium"
      title="已通过测试并保存"
    >
      <span>✓</span> 已解锁{source ? ` · ${source}` : ""}
    </span>
  );
}
