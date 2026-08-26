import { BrowserWindow } from "electron";

/**
 * 主进程 → 渲染进程的数据变更推送。后台任务或 IPC 保存写入持久化数据后
 * 调用，渲染进程按 scope 自动刷新对应视图并显示统一的更新提示。
 */
export function notifyDataChanged(scope: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("data:changed", scope);
    }
  }
}
