import { app, BrowserWindow, Menu, powerMonitor, shell } from "electron";
import path from "path";
import log from "electron-log";
import { getStore } from "./store";
import { registerIpcHandlers } from "./ipc";
import { startRegistrySync, releaseElectronLease } from "./registry-sync";
import { isTaskCenterStopped, startElectronOnlyScheduler } from "./scheduler";
import { stopSchedulerForAppExit, notifyDaemonPowerState } from "./handlers/scheduler";
import { ensureSchedulerDaemon, startSchedulerWatchdog } from "./daemon-manager";
import { registerHeadlessReadIpc } from "./headless-ipc";
import { registerDbAdminHandlers } from "./db-admin";
import { setMenuStoreProvider, startMenuAutoRefresh } from "./menu";
import { setupLogger } from "./logger";
import { isAllowedRendererNavigation, safeHttpUrl } from "./url-policy";

let mainWindow: BrowserWindow | null = null;
/** 调度 daemon 周期重试 watchdog 的停止函数（应用退出时清理）。 */
let stopSchedulerWatchdog: (() => void) | null = null;
let stopElectronOnlyScheduler: (() => void) | null = null;

app.setName("Appilot");
if (process.platform === "win32") {
  app.setAppUserModelId("com.appilot.app");
}

function createWindow() {
  const iconPath = path.join(__dirname, "../../resources/icon_1024.png");
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 620,
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
    const target = safeHttpUrl(url);
    if (target) void shell.openExternal(target.toString());
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isAllowedRendererNavigation(url, process.env.ELECTRON_RENDERER_URL)) return;
    event.preventDefault();
    const target = safeHttpUrl(url);
    if (target) void shell.openExternal(target.toString());
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

app.whenReady().then(async () => {
  setupLogger();
  registerIpcHandlers();
  registerHeadlessReadIpc();
  registerDbAdminHandlers();
  // 架构收敛 A：Electron 壳不再作为调度执行体。
  // 冷启动：await 确保常驻调度 daemon ——
  // - 成功 → 不启动任何壳内调度（daemon 是唯一自动调度者）；
  // - 失败 → 不启用壳内调度兜底，失败原因记入调度器状态（UI「调度器异常/
  //   未运行」，scheduler:status 读取），并启动 watchdog 周期重试拉起
  //   （20s 一次；daemon 恢复即转运行；用户「暂停」后停）。
  await ensureSchedulerDaemon({
    timeoutMs: 4000,
    log: (m) => log.info(`appilot: ${m}`),
  });
  stopSchedulerWatchdog = startSchedulerWatchdog({
    intervalMs: 20_000,
    timeoutMs: 5000,
    paused: () => isTaskCenterStopped(),
    log: (m) => log.info(`appilot: ${m}`),
  });
  // 系统休眠感知（实测：Mac 空闲时每小时一轮 Maintenance Sleep，每轮仅 ~45s
  // DarkWake 窗口；窗口末尾被入睡打断的请求醒来才超时失败）。休眠前通知 daemon
  // 暂停派发，唤醒后恢复（daemon 侧另有 tick 间隔自检兜底，即使此事件不触发也
  // 能在窗口末尾停止派发、并把唤醒后的瞬时错误判为休眠打断）。
  powerMonitor.on("suspend", () => {
    log.info("appilot: 系统休眠 → 通知 daemon 暂停派发");
    void notifyDaemonPowerState(true);
  });
  powerMonitor.on("resume", () => {
    log.info("appilot: 系统唤醒 → 通知 daemon 恢复调度");
    void notifyDaemonPowerState(false);
  });
  // 共享注册表（方案 A）：启动 hydrate + 初始写回 + watch 对侧变更。
  startRegistrySync(getStore);
  stopElectronOnlyScheduler = startElectronOnlyScheduler();
  Menu.setApplicationMenu(Menu.buildFromTemplate([]));
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(path.join(__dirname, "../../resources/icon_1024.png"));
  }
  createWindow();
  setMenuStoreProvider(() => getStore());
  startMenuAutoRefresh();
});

app.on("window-all-closed", () => app.quit());
// 设置「应用退出时同时退出后台调度器」时，退出前关掉 daemon（默认不关，常驻继续采集）。
let schedulerExitCleanup = false;
app.on("before-quit", (event) => {
  if (schedulerExitCleanup) return;
  event.preventDefault();
  (async () => {
    try {
      const s = await getStore();
      if (s.get("schedulerExitWithDaemon") === true) {
        await stopSchedulerForAppExit();
      }
      try {
        releaseElectronLease();
      } catch {
        /* 退出路径静默 */
      }
    } catch {
      // 读取偏好失败也照常退出
    } finally {
      schedulerExitCleanup = true;
      app.quit();
    }
  })();
});
app.on("will-quit", () => {
  try {
    stopSchedulerWatchdog?.();
    stopSchedulerWatchdog = null;
    stopElectronOnlyScheduler?.();
    stopElectronOnlyScheduler = null;
  } catch {
    /* 退出路径静默 */
  }
  try {
    releaseElectronLease();
  } catch {
    /* 退出路径静默 */
  }
});
