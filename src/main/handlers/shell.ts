import { app, dialog, ipcMain, shell } from "electron";
import fs from "fs";
import { normalizeLocalPath } from "../util";

export function registerShellHandlers(): void {
  ipcMain.handle("app:getVersion", () => app.getVersion());

  // ── Shell ──
  ipcMain.handle("shell:openExternal", (_event, url: string) => {
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("Only http/https URLs can be opened");
    }
    return shell.openExternal(url);
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
