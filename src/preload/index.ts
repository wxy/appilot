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

  draft: {
    save: (content: string): Promise<boolean> => ipcRenderer.invoke("draft:save", content),
    load: (): Promise<{ content: string; savedAt: string } | null> => ipcRenderer.invoke("draft:load"),
  },

  stats: {
    save: (entry: any): Promise<any[]> => ipcRenderer.invoke("stats:save", entry),
    list: (): Promise<any[]> => ipcRenderer.invoke("stats:list"),
    aiUsage: (): Promise<any> => ipcRenderer.invoke("stats:aiUsage"),
  },
});
