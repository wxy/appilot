import { useEffect, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import type { FeedbackTheme } from "@appilot-labs/appilot-core/feedback-inbox";

type FeedbackLink = ComponentType<{ to: string; className?: string; children?: ReactNode; [k: string]: any }>;

export function FeedbackThemesCard({
  project,
  themes: themesProp,
  LinkComponent = ({ className, children }: any) => (
    <span className={className}>{children}</span>
  ),
}: {
  project: any;
  /** 可选注入：聚类主题（DSH 客户端等无 window.appilot 的宿主传入）。缺省时内部经 IPC 取数。 */
  themes?: FeedbackTheme[];
  /** Link 注入：Electron 用 react-router；DSH 用占位 span。 */
  LinkComponent?: FeedbackLink;
}) {
  const [themes, setThemes] = useState<FeedbackTheme[]>([]);
  useEffect(() => {
    if (themesProp !== undefined) {
      setThemes(themesProp);
      return;
    }
    let cancelled = false;
    // 无 window.appilot 的宿主（DSH）：整条链为 undefined，安全跳过。
    const p: any = (window as any).appilot?.feedback?.themes(project.id);
    if (p && typeof p.then === "function") {
      p.then((data: FeedbackTheme[]) => {
        if (!cancelled) setThemes(data || []);
      }).catch(() => { if (!cancelled) setThemes([]); });
    }
    return () => { cancelled = true; };
  }, [project.id, themesProp]);

  const effectiveThemes = themesProp !== undefined ? themesProp : themes;
  const top3 = effectiveThemes.slice(0, 3);
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">用户反馈</h3>
        <LinkComponent to="/reviews" className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline">查看评论</LinkComponent>
      </div>
      {top3.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-zinc-400 dark:text-zinc-500">
          暂无聚类主题
          <LinkComponent to="/reviews" className="block mt-1 text-amber-600 dark:text-amber-400">去评论页生成洞察</LinkComponent>
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
