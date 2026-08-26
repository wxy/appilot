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
    // 去掉 iTunes 的 ?uo=4 打开参数（可能导致跳转/打开客户端）。
    const cleanUrl = url.replace(/\?uo=\d+$/, "");
    if (appPageWindow && !appPageWindow.isDestroyed()) {
      appPageWindow.loadURL(cleanUrl);
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
      // 标准桌面 UA：避免苹果对含 Electron 的 UA 返回降级/移动页面。
      appPageWindow.webContents.setUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      );
      appPageWindow.loadURL(cleanUrl);
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
