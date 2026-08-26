import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "fs";
import { normalizeLocalPath } from "../util";

let appPageWindow: BrowserWindow | null = null;

export function registerShellHandlers(): void {
  ipcMain.handle("app:getVersion", () => app.getVersion());

  // ── Shell ──
  ipcMain.handle("shell:openExternal", (_event, url: string) => {
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("Only http/https URLs can be opened");
    }
    return shell.openExternal(url);
  });

  // 在应用内的网页窗口中打开 App Store 商品页，避免 macOS 路由到
  // App Store 客户端（未在当地上架时客户端无法显示）。
  ipcMain.handle("shell:openAppPage", (_event, url: string) => {
    if (!/^https:\/\//i.test(url)) {
      throw new Error("Only https URLs can be opened in-app");
    }
    if (appPageWindow && !appPageWindow.isDestroyed()) {
      appPageWindow.loadURL(url);
      appPageWindow.focus();
    } else {
      appPageWindow = new BrowserWindow({
        width: 1024,
        height: 800,
        title: "App Store",
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      appPageWindow.loadURL(url);
      appPageWindow.on("closed", () => {
        appPageWindow = null;
      });
    }
    return true;
  });

  ipcMain.handle("shell:revealInFolder", (_event, localPath: string) => {
    const normalized = normalizeLocalPath(localPath);
    if (!normalized || !fs.existsSync(normalized)) return false;
    shell.showItemInFolder(normalized);
    return true;
  });

  // ── Project selector + local repo folder picker (Phase A) ──
  ipcMain.handle("dialog:selectFolder", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择应用源码目录",
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
}
