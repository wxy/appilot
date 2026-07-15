import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("appilot", {
  platform: process.platform,
  version: "0.1.0",
  openExternal: (url: string) => ipcRenderer.invoke("shell:openExternal", url),
});
