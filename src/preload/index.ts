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
  openAppPage: (url: string) => ipcRenderer.invoke("shell:openAppPage", url),
  onDataChanged: (callback: (scope: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, scope: string) => callback(scope);
    ipcRenderer.on("data:changed", listener);
    return () => ipcRenderer.removeListener("data:changed", listener);
  },
  revealInFolder: (localPath: string): Promise<boolean> =>
    ipcRenderer.invoke("shell:revealInFolder", localPath),

  menu: {
    onCommand: (callback: (command: any) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, command: any) => callback(command);
      ipcRenderer.on("app:menu-command", listener);
      return () => ipcRenderer.removeListener("app:menu-command", listener);
    },
  },

  competitors: {
    list: (projectId: string): Promise<any[]> => ipcRenderer.invoke("competitors:list", projectId),
    save: (projectId: string, competitor: any): Promise<{ list: any[]; merged: boolean }> =>
      ipcRenderer.invoke("competitors:save", projectId, competitor),
    remove: (projectId: string, competitorId: string): Promise<boolean> =>
      ipcRenderer.invoke("competitors:remove", projectId, competitorId),
    search: (opts: {
      term: string;
      country?: string;
      countries?: string[];
      platform?: string;
      excludeTrackIds?: string[];
      excludeBundleIds?: string[];
    }): Promise<any[]> =>
      ipcRenderer.invoke("competitors:search", opts),
    snapshots: (projectId: string, competitorId: string): Promise<any[]> =>
      ipcRenderer.invoke("competitors:snapshots", projectId, competitorId),
    rankSnapshots: (projectId: string, competitorId: string): Promise<any[]> =>
      ipcRenderer.invoke("competitors:rankSnapshots", projectId, competitorId),
    refreshRanks: (projectId: string): Promise<boolean> =>
      ipcRenderer.invoke("competitors:refreshRanks", projectId),
    sync: (projectId: string): Promise<boolean> => ipcRenderer.invoke("competitors:sync", projectId),
  },

  feedback: {
    list: (projectId: string): Promise<any[]> => ipcRenderer.invoke("feedback:list", projectId),
    themes: (projectId: string): Promise<any[]> => ipcRenderer.invoke("feedback:themes", projectId),
    sync: (projectId: string): Promise<boolean> => ipcRenderer.invoke("feedback:sync", projectId),
    cluster: (projectId: string, productId: string): Promise<any[]> =>
      ipcRenderer.invoke("feedback:cluster", projectId, productId),
    onClusterProgress: (callback: (progress: any) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: any) => callback(progress);
      ipcRenderer.on("feedback:clusterProgress", listener);
      return () => ipcRenderer.removeListener("feedback:clusterProgress", listener);
    },
  },

  reviews: {
    list: (productId: string): Promise<any> => ipcRenderer.invoke("reviews:list", productId),
    sync: (productId: string): Promise<boolean> => ipcRenderer.invoke("reviews:sync", productId),
  },

  traffic: {
    snapshots: (projectId: string): Promise<any[]> => ipcRenderer.invoke("traffic:snapshots", projectId),
    sync: (projectId: string): Promise<boolean> => ipcRenderer.invoke("traffic:sync", projectId),
  },

  asc: {
    sync: (productId: string): Promise<boolean> => ipcRenderer.invoke("asc:sync", productId),
    status: (productId: string): Promise<any> => ipcRenderer.invoke("asc:status", productId),
  },

  store: {
    currentVersion: (productId: string): Promise<{ version: string; currentVersionReleaseDate: string | null } | null> =>
      ipcRenderer.invoke("store:currentVersion", productId),
  },

  readiness: {
    get: (projectId: string, draftId: string): Promise<any> =>
      ipcRenderer.invoke("readiness:get", projectId, draftId),
    check: (projectId: string, productId: string, releaseTag: string): Promise<any> =>
      ipcRenderer.invoke("readiness:check", projectId, productId, releaseTag),
  },
  alignment: {
    check: (projectId: string, productId: string, releaseTag: string): Promise<any> =>
      ipcRenderer.invoke("alignment:check", projectId, productId, releaseTag),
    apply: (projectId: string, productId: string, releaseTag: string): Promise<any> =>
      ipcRenderer.invoke("alignment:apply", projectId, productId, releaseTag),
  },

  dialog: {
    selectFolder: (): Promise<string | null> => ipcRenderer.invoke("dialog:selectFolder"),
  },

  projects: {
    list: (): Promise<any[]> => ipcRenderer.invoke("projects:list"),
    add: (localPath: string): Promise<any> => ipcRenderer.invoke("projects:add", localPath),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke("projects:remove", id),
    updateSettings: (projectId: string, settings: { name?: string; localPath?: string; githubUrl?: string | null }): Promise<any> =>
      ipcRenderer.invoke("projects:updateSettings", projectId, settings),
    getCredentials: (projectId: string): Promise<any> =>
      ipcRenderer.invoke("projects:getCredentials", projectId),
    saveCredentials: (
      projectId: string,
      creds: { scope?: "global" | "project"; githubToken?: string; githubExpiresAt?: string; ascIssuerId?: string; ascKeyId?: string; ascPrivateKeyPath?: string },
    ): Promise<boolean> => ipcRenderer.invoke("projects:saveCredentials", projectId, creds),
    clearCredentials: (projectId: string, scope: "global" | "project"): Promise<boolean> =>
      ipcRenderer.invoke("projects:clearCredentials", projectId, scope),
    testGithubToken: (projectId: string, token?: string): Promise<any> =>
      ipcRenderer.invoke("projects:testGithubToken", projectId, token),
    testAscKey: (projectId: string, params?: { issuerId?: string; keyId?: string; privateKeyPath?: string }): Promise<any> =>
      ipcRenderer.invoke("projects:testAscKey", projectId, params),
    selectAscKeyFile: (): Promise<string | null> => ipcRenderer.invoke("projects:selectAscKeyFile"),
    generateKeywords: (projectId: string, language: string): Promise<any> => ipcRenderer.invoke("projects:generateKeywords", projectId, language),
    curateKeywords: (projectId: string, language: string): Promise<any> => ipcRenderer.invoke("projects:curateKeywords", projectId, language),
    getSubmissionReference: (projectId: string, language: string): Promise<any> => ipcRenderer.invoke("projects:getSubmissionReference", projectId, language),
    extractSubmissionCandidates: (projectId: string, language: string): Promise<any> => ipcRenderer.invoke("projects:extractSubmissionCandidates", projectId, language),
    saveTrackedKeywords: (projectId: string, trackedKeywords: any[]): Promise<any> => ipcRenderer.invoke("projects:saveTrackedKeywords", projectId, trackedKeywords),
    saveSubmissionKeywords: (projectId: string, submissionKeywords: any[]): Promise<any> => ipcRenderer.invoke("projects:saveSubmissionKeywords", projectId, submissionKeywords),
    removeTrackedKeyword: (projectId: string, language: string, keyword: string): Promise<any> =>
      ipcRenderer.invoke("projects:removeTrackedKeyword", projectId, language, keyword),
    pendingPauseList: (projectId: string): Promise<any[]> =>
      ipcRenderer.invoke("projects:pendingPauseList", projectId),
    translateKeyword: (
      productId: string,
      language: string,
      keyword: string,
    ): Promise<{ translation: string }> =>
      ipcRenderer.invoke("projects:translateKeyword", productId, language, keyword),
    translateKeywords: (projectId: string): Promise<{ total: number; translated: number }> =>
      ipcRenderer.invoke("projects:translateKeywords", projectId),
    generateNameSubtitleSuggestions: (productId: string): Promise<any[]> =>
      ipcRenderer.invoke("projects:generateNameSubtitleSuggestions", productId),
    dismissNameSuggestion: (projectId: string, language: string): Promise<boolean> =>
      ipcRenderer.invoke("projects:dismissNameSuggestion", projectId, language),
    onTranslateKeywordsProgress: (callback: (progress: any) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: any) =>
        callback(progress);
      ipcRenderer.on("projects:translateKeywordsProgress", listener);
      return () =>
        ipcRenderer.removeListener("projects:translateKeywordsProgress", listener);
    },
    reviewPendingPause: (
      productId: string,
      language: string,
      keyword: string,
      platform: string,
      action: "resume" | "pause" | "remove" | "copy-gap",
    ): Promise<any> =>
      ipcRenderer.invoke(
        "projects:reviewPendingPause",
        productId,
        language,
        keyword,
        platform,
        action,
      ),
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
    onKeywordProgress: (callback: (progress: any) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: any) => callback(progress);
      ipcRenderer.on("projects:keywordProgress", listener);
      return () => ipcRenderer.removeListener("projects:keywordProgress", listener);
    },
    onSubmissionProgress: (callback: (progress: any) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: any) => callback(progress);
      ipcRenderer.on("projects:submissionProgress", listener);
      return () => ipcRenderer.removeListener("projects:submissionProgress", listener);
    },
    generateBrief: (projectId: string, productId: string): Promise<any> =>
      ipcRenderer.invoke("projects:generateBrief", projectId, productId),
    recordBriefAction: (projectId: string, payload: any): Promise<any> =>
      ipcRenderer.invoke("projects:recordBriefAction", projectId, payload),
    onBriefProgress: (callback: (progress: any) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: any) => callback(progress);
      ipcRenderer.on("projects:briefProgress", listener);
      return () => ipcRenderer.removeListener("projects:briefProgress", listener);
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
      includeShas?: string[],
      appVersion?: string,
      includedChanges?: string[],
    ): Promise<any> =>
      ipcRenderer.invoke(
        "release:get",
        projectId,
        productId,
        releaseTag,
        force,
        language,
        includeShas,
        appVersion,
        includedChanges,
      ),
    onGenerateProgress: (callback: (progress: any) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: any) => callback(progress);
      ipcRenderer.on("release:generateProgress", listener);
      return () => ipcRenderer.removeListener("release:generateProgress", listener);
    },
    saveDraft: (projectId: string, draft: any): Promise<any> =>
      ipcRenderer.invoke("release:saveDraft", projectId, draft),
    deleteDraft: (projectId: string, draftId: string): Promise<boolean> =>
      ipcRenderer.invoke("release:deleteDraft", projectId, draftId),
    rebuildFromStore: (projectId: string, productId: string, releaseTag: string): Promise<any> =>
      ipcRenderer.invoke("release:rebuildFromStore", projectId, productId, releaseTag),
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
    setAccel: (enabled: boolean): Promise<boolean> =>
      ipcRenderer.invoke("scheduler:setAccel", enabled),
    overview: (): Promise<any> => ipcRenderer.invoke("scheduler:overview"),
    timeline: (): Promise<any> => ipcRenderer.invoke("scheduler:timeline"),
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
