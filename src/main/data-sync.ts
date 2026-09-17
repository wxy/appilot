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

/**
 * AI 记账专用直连推送：把累计用量 payload 直接推给所有窗口。
 * 不走 data:changed → 窗口 CustomEvent → 再 invoke 的三跳中转，
 * 保证顶部「AI 用量」胶囊在每次请求记账后确定性地收到最新值。
 */
export function notifyAiUsage(usage: {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  totalTokens: number;
  estimatedCost: number;
}): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("ai:usageUpdated", usage);
    }
  }
}
