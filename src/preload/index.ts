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

  repo: {
    checkRelease: (projectId: string): Promise<any> => ipcRenderer.invoke("repo:checkRelease", projectId),
    setReleaseStatus: (projectId: string, tag: string, status: "accepted" | "ignored"): Promise<any> =>
      ipcRenderer.invoke("repo:setReleaseStatus", projectId, tag, status),
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
    applyKeywordDeltas: (projectId: string, productId: string, releaseTag: string): Promise<any> =>
      ipcRenderer.invoke("release:applyKeywordDeltas", projectId, productId, releaseTag),
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
    setStoreStatus: (
      projectId: string,
      productId: string,
      releaseTag: string,
      storeStatus: string,
      reviewFeedback?: string,
    ): Promise<any> =>
      ipcRenderer.invoke("release:setStoreStatus", projectId, productId, releaseTag, storeStatus, reviewFeedback),
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
