import { contextBridge, ipcRenderer } from "electron";

export interface AIConfig {
  providerUrl: string;
  apiKey: string;
  model: string;
}

contextBridge.exposeInMainWorld("appilot", {
  platform: process.platform,
  getVersion: (): Promise<string> => ipcRenderer.invoke("app:getVersion"),
  openExternal: (url: string) => ipcRenderer.invoke("shell:openExternal", url),

  menu: {
    onCommand: (callback: (command: any) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, command: any) => callback(command);
      ipcRenderer.on("app:menu-command", listener);
      return () => ipcRenderer.removeListener("app:menu-command", listener);
    },
  },

  dialog: {
    selectFolder: (): Promise<string | null> => ipcRenderer.invoke("dialog:selectFolder"),
  },

  projects: {
    list: (): Promise<any[]> => ipcRenderer.invoke("projects:list"),
    add: (localPath: string): Promise<any> => ipcRenderer.invoke("projects:add", localPath),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke("projects:remove", id),
    generateKeywords: (projectId: string, language: string): Promise<any> => ipcRenderer.invoke("projects:generateKeywords", projectId, language),
    curateKeywords: (projectId: string, language: string): Promise<any> => ipcRenderer.invoke("projects:curateKeywords", projectId, language),
    saveTrackedKeywords: (projectId: string, trackedKeywords: any[]): Promise<any> => ipcRenderer.invoke("projects:saveTrackedKeywords", projectId, trackedKeywords),
    saveSubmissionKeywords: (projectId: string, submissionKeywords: any[]): Promise<any> => ipcRenderer.invoke("projects:saveSubmissionKeywords", projectId, submissionKeywords),
    removeTrackedKeyword: (projectId: string, language: string, keyword: string): Promise<any> =>
      ipcRenderer.invoke("projects:removeTrackedKeyword", projectId, language, keyword),
    restoreTrackedKeyword: (projectId: string, language: string, keyword: string): Promise<any> =>
      ipcRenderer.invoke("projects:restoreTrackedKeyword", projectId, language, keyword),
    resumePausedKeyword: (projectId: string, language: string, keyword: string): Promise<any> =>
      ipcRenderer.invoke("projects:resumePausedKeyword", projectId, language, keyword),
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

  release: {
    list: (projectId: string): Promise<any> => ipcRenderer.invoke("release:list", projectId),
    context: (projectId: string, productId: string, releaseTag: string): Promise<any> =>
      ipcRenderer.invoke("release:context", projectId, productId, releaseTag),
    get: (
      projectId: string,
      productId: string,
      releaseTag: string,
      force = false,
      language?: string,
    ): Promise<any> =>
      ipcRenderer.invoke("release:get", projectId, productId, releaseTag, force, language),
    onGenerateProgress: (callback: (progress: any) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: any) => callback(progress);
      ipcRenderer.on("release:generateProgress", listener);
      return () => ipcRenderer.removeListener("release:generateProgress", listener);
    },
    saveDraft: (projectId: string, draft: any): Promise<any> =>
      ipcRenderer.invoke("release:saveDraft", projectId, draft),
    translate: (
      projectId: string,
      productId: string,
      releaseTag: string,
      targetLanguages: string[],
      sourceLanguage?: string,
    ): Promise<any> =>
      ipcRenderer.invoke(
        "release:translate",
        projectId,
        productId,
        releaseTag,
        targetLanguages,
        sourceLanguage,
      ),
  },

  scheduler: {
    status: (): Promise<any> => ipcRenderer.invoke("scheduler:status"),
    list: (): Promise<any> => ipcRenderer.invoke("scheduler:list"),
    runDue: (): Promise<boolean> => ipcRenderer.invoke("scheduler:runDue"),
  },

  ai: {
    getConfig: (): Promise<AIConfig> => ipcRenderer.invoke("ai:getConfig"),
    saveConfig: (config: AIConfig): Promise<boolean> => ipcRenderer.invoke("ai:saveConfig", config),
    testConnection: (config: AIConfig): Promise<boolean> => ipcRenderer.invoke("ai:testConnection", config),
    listModels: (config: { providerUrl: string; apiKey: string }): Promise<{ models: string[]; error: string }> =>
      ipcRenderer.invoke("ai:listModels", config),
  },

  stats: {
    aiUsage: (): Promise<any> => ipcRenderer.invoke("stats:aiUsage"),
  },
});
