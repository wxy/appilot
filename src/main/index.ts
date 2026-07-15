import { app, BrowserWindow, shell } from "electron";
import path from "path";
import { registerIpcHandlers } from "./ipc";
import { setupLogger } from "./logger";

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    title: "Appilot",
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
    mainWindow.loadURL("http://localhost:5173");
  }
}

app.whenReady().then(() => {
  setupLogger();
  registerIpcHandlers();
  createWindow();
});

app.on("window-all-closed", () => app.quit());
