import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { FeedbackTheme } from "@appilot/core/feedback-inbox";

export function FeedbackThemesCard({ project }: { project: any }) {
  const [themes, setThemes] = useState<FeedbackTheme[]>([]);
  useEffect(() => {
    (window as any).appilot?.feedback?.themes(project.id)
      .then(setThemes)
      .catch(() => setThemes([]));
  }, [project.id]);

  const top3 = themes.slice(0, 3);
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">用户反馈</h3>
        <Link to="/reviews" className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline">查看评论</Link>
      </div>
      {top3.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-zinc-400 dark:text-zinc-500">
          暂无聚类主题
          <Link to="/reviews" className="block mt-1 text-amber-600 dark:text-amber-400">去评论页生成洞察</Link>
        </div>
      ) : (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {top3.map((theme) => (
            <div key={theme.title} className="px-4 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">{theme.title}</span>
                <span className="text-[10px] text-zinc-400 dark:text-zinc-500 shrink-0">{theme.evidenceCount} 条</span>
              </div>
              {theme.suggestedKeywords.length > 0 && (
                <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                  {theme.suggestedKeywords.join(" · ")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
