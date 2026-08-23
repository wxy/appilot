export function EmptyState({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="p-10 max-w-2xl mx-auto">
      <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl bg-white dark:bg-zinc-900/50">
        <div className="w-12 h-12 rounded-full bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center mb-3">
          <span className="text-amber-500 text-lg">⌖</span>
        </div>
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">{title}</h3>
        <p className="text-sm text-zinc-400 dark:text-zinc-500">{desc}</p>
      </div>
    </div>
  );
}
