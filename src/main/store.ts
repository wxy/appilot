import { log } from "@appilot/core/logger";

/** Minimal shape of the persisted app store used across main-process modules. */
export interface AppStore {
  get<T = any>(key: string): T;
  set(key: string, value: unknown): void;
}

let store: AppStore | null = null;

// electron-store v10+ is ESM-only. Use dynamic import for CJS compat.
export async function getStore(): Promise<AppStore> {
  if (!store) {
    try {
      const mod = await import("electron-store");
      store = new mod.default({
        defaults: {
          aiProviderUrl: "https://api.openai.com/v1",
          aiApiKey: "",
          aiModel: "gpt-4o",
          rankRunsPerDay: 1,
        },
      }) as unknown as AppStore;
    } catch (err: any) {
      log.error(`Failed to load electron-store: ${err.message}`);
      throw err;
    }
  }
  return store;
}
