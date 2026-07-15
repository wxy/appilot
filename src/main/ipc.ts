import { ipcMain, shell } from "electron";

export function registerIpcHandlers() {
  ipcMain.handle("shell:openExternal", (_event, url: string) => {
    return shell.openExternal(url);
  });

  // Placeholder — Task 0.2 will implement
  ipcMain.handle("db:query", async (_event, _sql: string, ..._params: unknown[]) => {
    throw new Error("Database not yet implemented");
  });

  // Placeholder — Task 0.5 will implement
  ipcMain.handle("ai:chat", async (_event, _messages: unknown[]) => {
    throw new Error("AI not yet implemented");
  });
}
