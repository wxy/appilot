import { app } from "electron";
import path from "path";
import { log } from "@appilot-labs/appilot-core/logger";
import { sharedStore } from "./registry-sync";
import { migrateConfigJsonIntoKv } from "./kv-migrate";
import { syncProjectToDb } from "./project-write-sync";

/** Minimal shape of the persisted app store used across main-process modules. */
export interface AppStore {
  get<T = any>(key: string): T;
  set(key: string, value: unknown): void;
}

/** electron-store 时期的默认值（键未写入时 get 的取值，语义与旧 electron-store defaults 一致）。 */
const DEFAULTS: Record<string, unknown> = {
  aiProviderUrl: "https://api.openai.com/v1",
  aiApiKey: "",
  aiModel: "gpt-4o",
  rankRunsPerDay: 1,
};

let store: AppStore | null = null;

// 共享 DB 镜像（方案 A→写侧接线）：projects 变更后防抖 300ms 全量镜像到共享 DB——
// 注册表(含 id) + project_meta + product_records(含扩展列)。此前仅同步注册表且靠
// 10s 轮询补富数据，读侧（DB 组装）会有可见滞后；现在任何写 handler 经
// s.set('projects', …) 落盘后 ≤300ms DB 即最新。删除项目的 DB 清理仍在删除处理器。
let syncTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleProjectsToDb(projects: unknown): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const list = (projects as any[]) || [];
    try {
      const shared = sharedStore();
      for (const project of list) {
        try {
          syncProjectToDb(shared, project);
        } catch (err: any) {
          log.warn(`projects → DB 镜像失败（${project?.name ?? "?"}）: ${err.message}`);
        }
      }
    } catch (err: any) {
      log.warn(`projects → DB 镜像失败: ${err.message}`);
    }
  }, 300);
}

/**
 * 应用持久化存储：全部业务数据落地到共享 SQLite（appilot.db 的 app_kv 表），
 * 不再使用 electron-store / config.json。所有消费方仍走 get(key)/set(key, value)，
 * 接口与旧 electron-store 完全一致（JSON 值序列化到 app_kv）。
 */
export async function getStore(): Promise<AppStore> {
  if (!store) {
    const shared = sharedStore(); // 打开 appilot.db（headless store，含 kv）
    const configPath = path.join(app.getPath("userData"), "config.json");
    try {
      const outcome = migrateConfigJsonIntoKv(shared.kv, configPath);
      if (outcome.imported > 0) {
        log.info(`appilot: 已把 config.json 的 ${outcome.imported} 个键导入 SQLite app_kv，旧文件归档为 ${outcome.archivedTo}`);
      }
    } catch (err: any) {
      log.error(`config.json → SQLite app_kv 迁移失败（下次启动重试）: ${err.message}`);
    }
    const kv = shared.kv;
    store = {
      get: (key) => {
        const raw = kv.get(key);
        if (raw === undefined) return DEFAULTS[key]; // 无默认值时即 undefined
        try {
          return JSON.parse(raw);
        } catch {
          log.warn(`app_kv 键 ${key} 不是合法 JSON，按原字符串返回`);
          return raw;
        }
      },
      set: (key, value) => {
        kv.set(key, JSON.stringify(value));
        if (key === "projects") scheduleProjectsToDb(value);
      },
    };
  }
  return store;
}
