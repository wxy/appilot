import { useEffect, useRef } from "react";
import { useProject } from "../../stores/project";

/**
 * 全局数据同步层：监听主进程的数据变更推送，按数据域刷新对应视图。
 * 不显示全局“已更新”悬浮提示——排名等任务更新密集，且可能在别的界面
 * 工作；相应界面按组件更新（ValueFlash 等）即可。
 */
export function DataSyncLayer() {
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
    });
    return () => {
      off?.();
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    };
  }, []);

  return null;
}
