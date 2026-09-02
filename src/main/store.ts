import { log } from "@appilot-labs/appilot-core/logger";
import { syncRegistryToDb } from "./registry-sync";

/** Minimal shape of the persisted app store used across main-process modules. */
export interface AppStore {
  get<T = any>(key: string): T;
  set(key: string, value: unknown): void;
}

let store: AppStore | null = null;

// 共享注册表同步（方案 A）：projects 变更后防抖写回共享文件（后写者赢）。
let syncTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRegistrySync(projects: unknown): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    void syncRegistryToDb((projects as any[]) || []);
  }, 300);
}

// electron-store v10+ is ESM-only. Use dynamic import for CJS compat.
export async function getStore(): Promise<AppStore> {
  if (!store) {
    try {
      const mod = await import("electron-store");
      const raw = new mod.default({
        defaults: {
          aiProviderUrl: "https://api.openai.com/v1",
          aiApiKey: "",
          aiModel: "gpt-4o",
          rankRunsPerDay: 1,
        },
      }) as unknown as AppStore;
      // 包装 set：projects 变更时同步共享注册表（fire-and-forget + 防抖）。
      store = new Proxy(raw, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          if (typeof value === "function") {
            if (prop === "set") {
              return (key: string, val: unknown) => {
                value.call(target, key, val);
                if (key === "projects") scheduleRegistrySync(val);
              };
            }
            return value.bind(target);
          }
          return value;
        },
      }) as unknown as AppStore;
    } catch (err: any) {
      log.error(`Failed to load electron-store: ${err.message}`);
      throw err;
    }
  }
  return store;
}
