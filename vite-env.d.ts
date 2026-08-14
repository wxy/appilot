/// <reference types="vite/client" />

interface AppilotAPI {
  platform: string;
  version: string;
  openExternal: (url: string) => Promise<void>;
  dialog: {
    selectFolder: () => Promise<string | null>;
  };
  projects: {
    list: () => Promise<any[]>;
    add: (localPath: string) => Promise<any>;
    remove: (id: string) => Promise<boolean>;
  };
  ai: {
    getConfig: () => Promise<any>;
    saveConfig: (config: any) => Promise<boolean>;
    testConnection: (config: any) => Promise<boolean>;
  };
  stats: {
    aiUsage: () => Promise<any>;
  };
}

declare global { interface Window { appilot: AppilotAPI; } }
export {};
