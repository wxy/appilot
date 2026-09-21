import { ipcMain } from "electron";
import { log } from "@appilot-labs/appilot-core/logger";
import { getDataSyncHealth } from "../data-sync-health";

/**
 * 渲染层诊断上报：ErrorBoundary / window.onerror / unhandledrejection
 * 统一经 `app:reportError` 写入 electron-log 文件日志。
 *
 * 之所以不用 console-message 转发：实测该事件在数月生产使用中未捕获到任何
 * 渲染错误（白屏事故无记录），渲染侧显式上报更可靠。
 */
export function registerDiagnosticsHandlers(): void {
  ipcMain.handle("app:reportError", (_event, source: unknown, message: unknown, stack: unknown) => {
    const s = typeof source === "string" && source.trim() ? source.trim() : "app";
    const msg = typeof message === "string" ? message : String(message ?? "(unknown)");
    const stackText = typeof stack === "string" && stack.trim() ? `\n${stack.trim()}` : "";
    log.error(`[renderer:${s}] ${msg}${stackText}`);
    return true;
  });

  ipcMain.handle("app:dataSyncHealth", () => getDataSyncHealth());
}
