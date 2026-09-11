import { app } from "electron";
import path from "path";
import { log } from "@appilot-labs/appilot-core/logger";
import { sharedStore } from "./registry-sync";
import { migrateConfigJsonIntoKv } from "./kv-migrate";
import { syncProjectToDb } from "./project-write-sync";
import { KV_BLOB_DOMAINS, syncKvBlobMap } from "./kv-blob-mirror";
import { mirrorTasksToDb, electronTasksFromRows, backfillTaskHistoryOnce, purgeOrphanProjectTasks } from "./task-db-sync";
import { buildLightProjects } from "./projects-db-light";

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
// projects 写直连 DB：每次落 kv 同步镜像到 product_records/project_meta/注册表
// （读侧 DB 组装由此即时一致）；kv 仍作为渲染兜底与草稿(storeSubmissionDrafts)
// 的存储，属单库内设计，见 docs。
function syncProjectsToDb(projects: unknown): void {
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
}

// scheduledTasks / githubSyncCache：kv 写入后立即镜像 DB（≤300ms 防抖），
// 替代对 10s 轮询的依赖，为后续引擎源切 DB 与移除轮询铺路。
// 引擎任务写直连 DB：scheduledTasks 每次落 kv 时同步镜像到 DB tasks（无损，
// #219 electronJson/enabled），引擎读仍走 kv 不产生滞后；后续引擎读切 DB 后
// 可去掉 kv 写。轮询 reconcile 仍保留作跨壳兜底。
function syncTasksToDb(tasks: unknown): void {
  try {
    mirrorTasksToDb(sharedStore(), (tasks as any[]) || []);
  } catch (err: any) {
    log.warn(`scheduledTasks → DB 镜像失败: ${err.message}`);
  }
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
    // projects 已切 DB 源（默认开启）：注册表有项目行时删除 kv 遗留 projects 键。
    try {
      const hasProjects = shared.projects.list().length > 0;
      if (process.env.APPILOT_PROJECTS_DB_ON !== "0" && hasProjects && kv.get("projects") !== undefined) {
        kv.delete("projects");
        log.info("appilot: kv projects 已退役（DB 结构化表为项目源）");
      }
    } catch (err: any) {
      log.warn(`kv projects 清理失败: ${err.message}`);
    }
    // rank 执行记录已切 DB（直写 rank_executions）：DB 有记录时删除 kv 遗留键。
    try {
      if (shared.executions.latest(1).length > 0 && kv.get("rankExecutions") !== undefined) {
        kv.delete("rankExecutions");
        log.info("appilot: kv rankExecutions 已退役（rank_executions 为执行记录源）");
      }
    } catch (err: any) {
      log.warn(`kv rankExecutions 清理失败: ${err.message}`);
    }
    // 任务历史回填（一次性，标记守卫）：kv scheduledTasks 退役前未迁移历史；用
    // executions 补无 lastRunAt 的 electron 任务行。必须只跑一次——否则用户
    // 「清除失败」把 lastRunAt 置空后，下次启动会把 rank_executions 里的 failed
    // 历史原样填回（行 error + electronJson failed），清除后重启又复现。
    try {
      const n = backfillTaskHistoryOnce(shared);
      if (n > 0) log.info(`appilot: backfilled task history for ${n} tasks from executions`);
    } catch (err: any) {
      log.warn(`task history backfill failed: ${err.message}`);
    }
    // 孤儿任务兜底清理：删除引用已删除项目/产品的残留任务行（demo 等历史遗留；
    // 删除时的级联清理只覆盖删除之后的动作，这里补删更早残留的行）。
    try {
      const orphaned = purgeOrphanProjectTasks(shared);
      if (orphaned.length > 0) {
        const preview = orphaned.slice(0, 10).join(", ");
        log.info(`appilot: 清理了 ${orphaned.length} 个孤儿任务（引用已删除项目）: ${preview}${orphaned.length > 10 ? " …" : ""}`);
      }
    } catch (err: any) {
      log.warn(`孤儿任务清理失败: ${err.message}`);
    }
    // 引擎任务源已切 DB：DB tasks 存在 electron 行时，删除 kv 遗留 scheduledTasks 键。
    try {
      const hasElectronTasks = shared.tasks.all().some((r) => r.source === "electron");
      if (hasElectronTasks && kv.get("scheduledTasks") !== undefined) {
        kv.delete("scheduledTasks");
        log.info("appilot: kv scheduledTasks 已退役（DB tasks 为引擎任务源）");
      }
    } catch (err: any) {
      log.warn(`kv scheduledTasks 清理失败: ${err.message}`);
    }
    // 发布缓存已切 DB（读写 release_cache）：DB 有任一项目缓存行时删除 kv 遗留键。
    try {
      const anyRelease = shared.projects
        .list()
        .some((p) => {
          try {
            return Boolean(shared.releaseCache.get(p.name));
          } catch {
            return false;
          }
        });
      if (anyRelease && kv.get("githubSyncCache") !== undefined) {
        kv.delete("githubSyncCache");
        log.info("appilot: kv githubSyncCache 已退役（release_cache 为发布缓存源）");
      }
    } catch (err: any) {
      log.warn(`kv githubSyncCache 清理失败: ${err.message}`);
    }
    store = {
      get: (key) => {
        if (key === "projects" && process.env.APPILOT_PROJECTS_DB_ON !== "0") {
          // 写切(2c/2d)：读侧 = DB 轻量视图（kv 兜底），写侧 DB-only（默认开启）。
          try {
            const light = buildLightProjects(shared);
            if (light.length > 0) return light;
          } catch (err: any) {
            log.warn(`projects DB 读取失败，回退 kv: ${err.message}`);
          }
        }
        if (key === "scheduledTasks" && process.env.APPILOT_TASKS_DB_READ !== "0") {
          // 引擎读侧切 DB：从共享 DB tasks（source=electron、无损 electronJson）
          // 重建任务；DB 为空/出错回退 kv。写侧每次落 kv 已同步 DB（#220），
          // 因此两源一致；全部引擎与状态读取点经此单点生效。
          try {
            const rows = shared.tasks.all();
            const rebuilt = electronTasksFromRows(rows);
            if (rebuilt.length > 0) return rebuilt;
          } catch (err: any) {
            log.warn(`scheduledTasks DB 读取失败，回退 kv: ${err.message}`);
          }
        }
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
        // scheduledTasks：引擎任务源已切 DB tasks（读 #221 / 写 #220），
        // 直写 DB（同步无损镜像），不再写 kv（遗留键由启动清理删除）。
        if (key === "scheduledTasks") {
          syncTasksToDb(value);
          return;
        }
        // projects：APPILOT_PROJECTS_DB_ON=1 启用态 → 写直连 DB（不再写 kv）。
        if (key === "projects" && process.env.APPILOT_PROJECTS_DB_ON !== "0") {
          syncProjectsToDb(value);
          return;
        }
        kv.set(key, JSON.stringify(value));
        if (key === "projects") syncProjectsToDb(value);
        const domain = KV_BLOB_DOMAINS[key];
        if (domain) {
          try {
            syncKvBlobMap(shared, domain, (value ?? {}) as Record<string, unknown>);
          } catch (err: any) {
            log.warn(`kv 域 ${key} → project_blobs 镜像失败: ${err.message}`);
          }
        }
      },
    };
  }
  return store;
}
