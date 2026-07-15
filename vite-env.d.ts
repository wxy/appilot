/// <reference types="vite/client" />
interface AppilotAPI { platform: string; version: string; openExternal: (url: string) => Promise<void>; }
declare global { interface Window { appilot: AppilotAPI; } }
export {};
