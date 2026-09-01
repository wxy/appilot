import { app, BrowserWindow, Menu, shell } from "electron";
import path from "path";
import log from "electron-log";
import { getStore } from "./store";
import { registerIpcHandlers } from "./ipc";
import { startRegistrySync } from "./registry-sync";
import { startTaskScheduler } from "./scheduler";
import { setMenuStoreProvider, startMenuAutoRefresh } from "./menu";
import { setupLogger } from "./logger";

let mainWindow: BrowserWindow | null = null;

app.setName("Appilot");
if (process.platform === "win32") {
  app.setAppUserModelId("com.appilot.app");
}

function createWindow() {
  const iconPath = path.join(__dirname, "../../resources/icon_1024.png");
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    title: "Appilot",
    autoHideMenuBar: true,
    icon: process.platform === "darwin" ? iconPath : path.join(__dirname, "../../resources/icon_512.png"),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Open external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // 渲染进程错误转发到主日志，便于排查界面问题。
  mainWindow.webContents.on("console-message", (_event, ...args: any[]) => {
    try {
      const details = args[0];
      const isObject = typeof details === "object" && details !== null;
      const level = isObject ? details.level : args[1];
      const message = isObject ? details.message : args[2];
      if (level === "error" || level === 3) {
        log.error(`[renderer] ${message}`);
      } else if (level === "warning" || level === 2) {
        log.warn(`[renderer] ${message}`);
      }
    } catch {
      // 忽略日志转发自身的异常
    }
  });

  // Dev: Vite dev server. Prod: built files
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  setupLogger();
  registerIpcHandlers();
  startTaskScheduler();
  // 共享注册表（方案 A）：启动 hydrate + 初始写回 + watch 对侧变更。
  startRegistrySync(getStore);
  Menu.setApplicationMenu(Menu.buildFromTemplate([]));
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(path.join(__dirname, "../../resources/icon_1024.png"));
  }
  createWindow();
  setMenuStoreProvider(() => getStore());
  startMenuAutoRefresh();
});

app.on("window-all-closed", () => app.quit());
