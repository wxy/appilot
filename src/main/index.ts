import { app, BrowserWindow, Menu, shell } from "electron";
import path from "path";
import { getStore, registerIpcHandlers, startTaskScheduler } from "./ipc";
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
  Menu.setApplicationMenu(Menu.buildFromTemplate([]));
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(path.join(__dirname, "../../resources/icon_1024.png"));
  }
  createWindow();
  setMenuStoreProvider(() => getStore());
  startMenuAutoRefresh();
});

app.on("window-all-closed", () => app.quit());
