import { useEffect, useRef, useState } from "react";
import { useProject } from "../../stores/project";

const SCOPE_LABELS: Record<string, string> = {
  rank: "排名",
  asc: "App Store 状态",
  competitors: "竞品",
  reviews: "评论",
  feedback: "反馈",
  tasks: "任务",
  releases: "发布",
  projects: "项目",
};

/**
 * 全局数据同步层：监听主进程的数据变更推送，按数据域刷新对应视图，
 * 并显示统一的「已更新」提示。
 */
export function DataSyncLayer() {
  const [toast, setToast] = useState<{ label: string; key: number } | null>(null);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const off = (window as any).appilot?.onDataChanged?.((scope: string) => {
      // 项目/排名/ASC/发布数据变化时重载项目数据（排名矩阵、总览、发布工作台共用）。
      if (["rank", "asc", "releases", "projects"].includes(scope)) {
        // 排名数据按任务高频推送（加速时一轮数十次），合并到一次全量重载。
        if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = setTimeout(() => {
          reloadTimerRef.current = null;
          void useProject.getState().load();
        }, 1200);
      }
      // 页面级组件按需监听此事件（竞品面板、任务中心等）。
      window.dispatchEvent(new CustomEvent("appilot:data-changed", { detail: scope }));

      // 统一更新提示：节流合并短时间内的多次更新。
      if (timerRef.current) clearTimeout(timerRef.current);
      setToast({ label: SCOPE_LABELS[scope] || scope, key: Date.now() });
      setVisible(true);
      timerRef.current = setTimeout(() => setVisible(false), 2000);
    });
    return () => {
      off?.();
      if (timerRef.current) clearTimeout(timerRef.current);
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    };
  }, []);

  return (
    <div
      className="pointer-events-none fixed top-4 left-1/2 z-50 transition-all duration-300"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translate(-50%, 0)" : "translate(-50%, -8px)",
      }}
    >
      {toast && (
        <div
          key={toast.key}
          className="flex items-center gap-2 rounded-full bg-emerald-600 text-white text-xs font-medium px-4 py-2 shadow-lg"
        >
          <span className="w-3 h-3 rounded-full border-2 border-white/70 border-t-transparent animate-spin" />
          {toast.label} 已更新
        </div>
      )}
    </div>
  );
}
