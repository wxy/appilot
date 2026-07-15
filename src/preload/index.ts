import { contextBridge, ipcRenderer } from "electron";

export interface AIConfig {
  providerUrl: string;
  apiKey: string;
  model: string;
}

contextBridge.exposeInMainWorld("appilot", {
  platform: process.platform,
  version: "0.1.0",
  openExternal: (url: string) => ipcRenderer.invoke("shell:openExternal", url),

  ai: {
    getConfig: (): Promise<AIConfig> => ipcRenderer.invoke("ai:getConfig"),
    saveConfig: (config: AIConfig): Promise<boolean> => ipcRenderer.invoke("ai:saveConfig", config),
    testConnection: (config: AIConfig): Promise<boolean> => ipcRenderer.invoke("ai:testConnection", config),
    analyzeProduct: (repoUrl: string): Promise<any> => ipcRenderer.invoke("ai:analyzeProduct", repoUrl),
    generateTweet: (repoUrl: string, stage: string): Promise<any> => ipcRenderer.invoke("ai:generateTweet", repoUrl, stage),
  },
});
