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
import { join } from 'node:path';
import {
  openStore,
  importLegacyRegistry,
  type AppilotStore,
} from '@appilot-labs/appilot-headless';
import { log } from '@appilot-labs/appilot-core/logger';
import { importRankHistoryToDb } from './rank-db-sync';
import { mirrorTasksToDb } from './task-db-sync';
import { syncReleaseCachesToDb } from './release-cache-sync';
import { backfillRankSnapshotsToElectron } from './rank-backfill';
import { syncRichDataToDb } from './rich-data-sync';
import { hydrateFromDbCore, syncRegistryCore } from './registry-sync-core';
export { registryRecordOf } from './registry-sync-core';

let store: AppilotStore | null = null;

export function sharedStore(): AppilotStore {
  if (!store) {
    const path = join(app.getPath('userData'), 'appilot.db');
    store = openStore(path);
    // 旧版 registry.json 一次性迁移（幂等）。
    const legacy = join(app.getPath('userData'), 'registry.json');
    try {
      const n = importLegacyRegistry(store, legacy);
      if (n > 0) log.info(`appilot: migrated ${n} legacy registry records to SQLite`);
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
  // 富数据规模签名（meta/products 计数）——仅变化时打日志去噪。
  let lastRichSig: string | null = null;
  // 发布缓存条数签名——仅变化时打日志去噪。
  let lastReleaseCacheCount: number | null = null;
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
      // Phase 4b：Electron 调度任务状态镜像进共享 DB tasks 表（DSH/CLI/MCP
      // 可读同一任务状态；镜像行不会被 headless dueJobs 误触发执行）。
      try {
        mirrorTasksToDb(sharedStore(), (s.get('scheduledTasks') || []) as any[]);
      } catch (err: any) {
        log.warn(`task mirror to shared db failed: ${err.message}`);
      }
      // Phase M3：Electron 富数据（storeProducts / repo 状态）双写共享 DB——
      // product_records / project_meta（rank 等富数据任务实例化与跨壳读的前提）。
      // 仅在规模有变化时记录（避免每 10s 全量 upsert 的同步噪音）。
      try {
        const { meta, products } = syncRichDataToDb(sharedStore(), projects as any[]);
        const sig = `${meta}/${products}`;
        if (sig !== lastRichSig) {
          lastRichSig = sig;
          log.info(`appilot: synced rich data to shared db (${meta} meta, ${products} products)`);
        }
      } catch (err: any) {
        log.warn(`rich data sync failed: ${err.message}`);
      }
      // Phase M4-A：发布页缓存（githubSyncCache）双写共享 DB（UI 迁出前提）。
      try {
        const cache = (s.get('githubSyncCache') || {}) as Record<string, Record<string, unknown>>;
        const n = syncReleaseCachesToDb(sharedStore(), projects as any[], cache);
        if (n !== lastReleaseCacheCount) {
          lastReleaseCacheCount = n;
          log.info(`appilot: synced release caches to shared db (${n} projects)`);
        }
        // P1 反向同步：共享 DB release_cache（任何执行者写入）→ electron-store
        // githubSyncCache——Electron 从者（DSH/daemon 持主执行）时发布页仍新鲜。
        const dbStore = sharedStore();
        const localCache = cache;
        let backfilled = 0;
        for (const p of (projects as any[]) || []) {
          if (!p?.id || !p?.name) continue;
          const row = dbStore.releaseCache.get(p.name);
          if (!row) continue;
          const existing = localCache[p.id] as any;
          if (!existing || (existing as any)?.syncedAt < row.syncedAt) {
            localCache[p.id] = row.cache;
            backfilled += 1;
          }
        }
        if (backfilled > 0) {
          s.set('githubSyncCache', localCache);
          log.info(`appilot: backfilled ${backfilled} release caches from shared db`);
        }
      } catch (err: any) {
        log.warn(`release cache sync failed: ${err.message}`);
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
