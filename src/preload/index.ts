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

  dialog: {
    selectFolder: (): Promise<string | null> => ipcRenderer.invoke("dialog:selectFolder"),
  },

  projects: {
    list: (): Promise<any[]> => ipcRenderer.invoke("projects:list"),
    add: (localPath: string): Promise<any> => ipcRenderer.invoke("projects:add", localPath),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke("projects:remove", id),
    generateKeywords: (projectId: string, language: string): Promise<any> => ipcRenderer.invoke("projects:generateKeywords", projectId, language),
    saveTrackedKeywords: (projectId: string, trackedKeywords: any[]): Promise<any> => ipcRenderer.invoke("projects:saveTrackedKeywords", projectId, trackedKeywords),
    saveSubmissionKeywords: (projectId: string, submissionKeywords: any[]): Promise<any> => ipcRenderer.invoke("projects:saveSubmissionKeywords", projectId, submissionKeywords),
    removeTrackedKeyword: (projectId: string, language: string, keyword: string): Promise<any> =>
      ipcRenderer.invoke("projects:removeTrackedKeyword", projectId, language, keyword),
    restoreTrackedKeyword: (projectId: string, language: string, keyword: string): Promise<any> =>
      ipcRenderer.invoke("projects:restoreTrackedKeyword", projectId, language, keyword),
    clearRemovedKeywords: (projectId: string, languages: string[]): Promise<any> =>
      ipcRenderer.invoke("projects:clearRemovedKeywords", projectId, languages),
    collectRanks: (projectId: string, language: string, storefront: string): Promise<any> =>
      ipcRenderer.invoke("projects:collectRanks", projectId, language, storefront),
    onRankProgress: (callback: (progress: any) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: any) => callback(progress);
      ipcRenderer.on("projects:collectRanksProgress", listener);
      return () => ipcRenderer.removeListener("projects:collectRanksProgress", listener);
    },
  },

  scheduler: {
    status: (): Promise<any> => ipcRenderer.invoke("scheduler:status"),
    runDue: (): Promise<boolean> => ipcRenderer.invoke("scheduler:runDue"),
  },

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
