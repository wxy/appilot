/**
 * 共享注册表（Phase 2：单一 SQLite DB，取代 registry.json 双向同步）。
 *
 * Electron 与 DSH 打开**同一个 appilot.db**（headless 的 openStore，WAL/事务）。
 * - 本侧项目变更 → syncRegistryToDb（identity upsert 进 DB）；
 * - DSH 侧注册的新项目 → hydrateFromDb（启动 + 每 10s 轮询，补进 electron-store
 *   的富数据副本——electron-store 仍持有富数据，DB 是注册表单一事实源）；
 * - 首次打开时把旧版 registry.json 一次性导入（headless.importLegacyRegistry）。
 *
 * 双向同步的纯逻辑（映射/比较/合并）在 registry-sync-core.ts（无 electron，
 * node 单测覆盖）；本文件只做 electron 绑定（userData 路径、租约门、轮询）。
 */
import { app } from 'electron';
import fs from 'node:fs';
import { join } from 'node:path';
import {
  openStore,
  importLegacyRegistry,
  type AppilotStore,
} from '@appilot-labs/appilot-headless';
import { log } from '@appilot-labs/appilot-core/logger';
import { importRankHistoryToDb } from './rank-db-sync';
import { backfillRankSnapshotsToElectron } from './rank-backfill';
import { syncRichDataToDb } from './rich-data-sync';
import { hydrateFromDbCore, syncRegistryCore } from './registry-sync-core';
import {
  syncRankExecutionsToDb,
  RANK_EXEC_IMPORT_MARK,
} from './sync-rank-executions';
import {
  KV_BLOB_DOMAINS,
  KV_BLOB_IMPORT_MARK,
  syncKvBlobMap,
} from './kv-blob-mirror';
export { registryRecordOf } from './registry-sync-core';

let store: AppilotStore | null = null;

export function sharedStore(): AppilotStore {
  if (!store) {
    const path = join(app.getPath('userData'), 'appilot.db');
    store = openStore(path);
    // 旧版 registry.json 一次性迁移（幂等）：DB 已有项目时不再重复导入。
    const legacy = join(app.getPath('userData'), 'registry.json');
    try {
      const n = importLegacyRegistry(store, legacy);
      if (n > 0) log.info(`appilot: migrated ${n} legacy registry records to SQLite`);
      // 注册表已收口到 SQLite（本次导入或既有数据），删除遗留文件，不再每次启动空读。
      try {
        if (fs.existsSync(legacy) && store.projects.list().length > 0) {
          fs.unlinkSync(legacy);
          log.info('appilot: removed legacy registry.json (已并入 SQLite 注册表)');
        }
      } catch (err: any) {
        log.warn(`appilot: registry.json 清理失败（忽略）: ${err.message}`);
      }
    } catch (err: any) {
      log.warn(`appilot: legacy registry migration failed: ${err.message}`);
    }
  }
  return store;
}

let electronLeader = false;
let gateTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 调度租约门（Phase 3）：Electron 与 DSH 共享 lease 表，仅租约主执行定时任务。
 * - 已是主 → 续租并返回 true；
 * - 非主 → 尝试抢占（主心跳过期后接管）→ 抢到返回 true，否则返回 false（本 tick 跳过调度）。
 * 另起 10s 心跳保持主的租约（即使 schedulerTick 间隔较长也不掉租）。
 */
export function scheduleGate(): boolean {
  try {
    const s = sharedStore();
    if (electronLeader) {
      if (!s.lease.heartbeat("electron")) {
        electronLeader = false;
        return false;
      }
      return true;
    }
    if (s.lease.acquire("electron", 60_000)) {
      electronLeader = true;
      return true;
    }
    return false;
  } catch (err: any) {
    log.warn(`schedule gate failed: ${err.message}`);
    return false;
  }
}

function startLeaderHeartbeat(): void {
  if (gateTimer) return;
  gateTimer = setInterval(() => {
    if (electronLeader) {
      try {
        if (!sharedStore().lease.heartbeat("electron")) electronLeader = false;
      } catch {
        /* 下轮再试 */
      }
    }
  }, 10_000);
}

/** 本侧项目变更 → 写共享 DB（identity upsert）。 */
export async function syncRegistryToDb(projects: any[]): Promise<void> {
  try {
    syncRegistryCore(sharedStore(), projects);
  } catch (err: any) {
    log.warn(`registry sync to db failed: ${err.message}`);
  }
}

/** 共享 DB 里本侧缺失/更新的项目 → 补进 electron-store 富数据副本。 */
export async function hydrateFromDb(
  projects: any[],
): Promise<{ projects: any[]; changed: boolean }> {
  try {
    return hydrateFromDbCore(sharedStore(), projects);
  } catch (err: any) {
    log.warn(`registry hydrate failed: ${err.message}`);
    return { projects: projects || [], changed: false };
  }
}

/**
 * 启动：立即 hydrate 一次 + 初始写回 + 每 10 秒轮询 DB（对侧 DSH 注册/变更）。
 * 返回清理函数。
 */
export function startRegistrySync(
  getStore: () => Promise<{ get<T = any>(k: string): T; set(k: string, v: unknown): void }>,
): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;

  // rank 反向同步日志节流（聚合窗口 ≥60s；rank 恢复期高频命中时不刷屏）。
  let backfillAccum = 0;
  let lastBackfillLogAt = 0;

  const hydrateOnce = async () => {
    try {
      const s = await getStore();
      const { projects, changed } = await hydrateFromDb((s.get('projects') || []) as any[]);
      if (changed) s.set('projects', projects);
      await syncRegistryToDb(projects as any[]);
      // Phase 4b：electron-store 存量 rank 历史一次性幂等导入共享 DB（此后由
      // scheduler 双写增量）。失败不影响注册表同步。
      try {
        const n = importRankHistoryToDb(sharedStore(), projects as any[]);
        if (n > 0) log.info(`appilot: imported ${n} rank snapshots to shared db`);
      } catch (err: any) {
        log.warn(`rank history import failed: ${err.message}`);
      }
      // 阶段三：kv rankExecutions 一次性导入共享 DB（此后 scheduler 双写增量；
      // add 用 (ts,taskId) INSERT OR IGNORE，重复启动幂等）。
      try {
        const shared = sharedStore();
        if (!shared.kv.get(RANK_EXEC_IMPORT_MARK)) {
          const list = (s.get('rankExecutions') || []) as any[];
          const n = syncRankExecutionsToDb(shared, list);
          shared.kv.set(RANK_EXEC_IMPORT_MARK, new Date().toISOString());
          if (n > 0) log.info(`appilot: imported ${n} rank executions to shared db`);
        }
      } catch (err: any) {
        log.warn(`rank executions import failed: ${err.message}`);
      }
      // 阶段三：kv 的 Record<id,数据> 域一次性导入 project_blobs（此后写由适配器镜像）。
      try {
        const sharedDb = sharedStore();
        if (!sharedDb.kv.get(KV_BLOB_IMPORT_MARK)) {
          let n = 0;
          for (const [key, domain] of Object.entries(KV_BLOB_DOMAINS)) {
            const val = (s.get(key) || {}) as Record<string, unknown>;
            n += syncKvBlobMap(sharedDb, domain, val);
          }
          sharedDb.kv.set(KV_BLOB_IMPORT_MARK, new Date().toISOString());
          if (n > 0) log.info(`appilot: imported ${n} kv blob entries to shared db`);
        }
      } catch (err: any) {
        log.warn(`kv blob import failed: ${err.message}`);
      }
      // Phase M3：Electron 富数据（storeProducts / repo 状态）双写共享 DB——
      // product_records / project_meta（rank 等富数据任务实例化与跨壳读的前提）。
      try {
        syncRichDataToDb(sharedStore(), projects as any[]);
      } catch (err: any) {
        log.warn(`rich data sync failed: ${err.message}`);
      }
      // P2b：rank 快照反向同步（DB → electron-store 排名页）——DSH/daemon
      // 持主执行的 rank 结果同步回 Electron UI；仅 DB 新于本地才写。
      // 日志节流：rank 恢复期 daemon 持续产出时每 10s 轮询都会命中，
      // 聚合到 ≥60s 才记一条（避免每 10s 噪音）。
      try {
        const n = backfillRankSnapshotsToElectron(sharedStore(), projects as any[]);
        if (n > 0) {
          s.set('projects', projects);
          backfillAccum += n;
          const nowMs = Date.now();
          if (nowMs - lastBackfillLogAt >= 60_000) {
            log.info(
              `appilot: backfilled rank snapshots (${backfillAccum} products since last log)`,
            );
            backfillAccum = 0;
            lastBackfillLogAt = nowMs;
          }
        }
      } catch (err: any) {
        log.warn(`rank backfill failed: ${err.message}`);
      }
    } catch (err: any) {
      log.warn(`registry sync failed: ${err.message}`);
    }
  };

  void hydrateOnce();
  timer = setInterval(hydrateOnce, 10_000);
  startLeaderHeartbeat();

  return () => {
    if (timer) clearInterval(timer);
    if (gateTimer) clearInterval(gateTimer);
    gateTimer = null;
  };
}

/**
 * 退出时释放 Electron 调度租约（架构收敛）：应用正常退出即让位，
 * 重启/后续 daemon 无需等 TTL（60s）即可接管，避免「明明清了后台，
 * 新 daemon 启动却因旧心跳被拒」的时序问题。
 */
export function releaseElectronLease(): void {
  try {
    const s = sharedStore();
    if (s.lease.leader() === 'electron') {
      s.lease.release('electron');
    }
  } catch {
    /* 退出路径静默 */
  }
}
