import { app, BrowserWindow, Menu, shell } from "electron";
import path from "path";
import { registerIpcHandlers, startTaskScheduler } from "./ipc";
import { setupLogger } from "./logger";

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  const iconPath = path.join(__dirname, "../../resources/icon.icns");
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    title: "Appilot",
    icon: process.platform === "darwin" ? iconPath : path.join(__dirname, "../../resources/icon_512.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
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
  Menu.setApplicationMenu(null);
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(path.join(__dirname, "../../resources/icon.icns"));
  }
  createWindow();
});

app.on("window-all-closed", () => app.quit());
