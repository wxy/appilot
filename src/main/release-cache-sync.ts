/**
 * Electron 发布页缓存（githubSyncCache）→ 共享 SQLite（M4-A）。
 *
 * Electron githubSyncCache 以 projectId 为 key 存 release material/PR/
 * capabilities；此处按 projectName 双写进共享 DB project_release_cache
 * （UI 数据源迁出 electron-store 的前提；迁移完成前 UI 仍读 electron-store）。
 * 本模块不 import electron，纯映射可在 node 下单测。
 */
import type { AppilotStore } from '@appilot-labs/appilot-headless';

/** electron-store project（含 id 与 name——cache key 是 projectId）。 */
export interface ElectronProjectWithId {
  id?: string | null;
  name?: string | null;
}

/**
 * 把 electron-store githubSyncCache 存量同步进共享 DB。
 * cacheByProjectId: { [projectId]: entry }（githubSyncCache 原样）。
 * 返回同步条数（幂等 upsert，每轮全量覆盖）。
 */
export function syncReleaseCachesToDb(
  store: AppilotStore,
  projects: ElectronProjectWithId[],
  cacheByProjectId: Record<string, Record<string, unknown>> | undefined | null,
): number {
  let n = 0;
  for (const p of projects ?? []) {
    if (!p?.name || !p?.id) continue;
    const entry = cacheByProjectId?.[p.id];
    if (!entry) continue;
    // syncedAt 取条目自带时间（真实同步时刻）——不能用默认 now 覆盖，否则 DB
    // syncedAt 每轮 hydrate 都被刷新成当前时间，导致反向同步（syncedAt 比较）
    // 永远触发、每 10s 无意义 backfill + 日志噪音。
    const entrySyncedAt =
      typeof (entry as any)?.syncedAt === 'string'
        ? ((entry as any).syncedAt as string)
        : undefined;
    store.releaseCache.save(p.name, entry, entrySyncedAt);
    n += 1;
  }
  return n;
}
