/**
 * kv 的 Record<id, 数据> 类域 → project_blobs 镜像（纯逻辑，无 electron 依赖）。
 *
 * 镜像域：ascCache / competitors / competitorSnapshots /
 * competitorRankSnapshots / readinessChecks / feedback。kv 里这些 key 的值是
 * { 项目或产品 id: 数据 } 映射；每次整值写入后整体镜像到 project_blobs
 * （含陈旧 key 清理），双写期读侧仍走 kv。
 */
import type { AppilotStore } from '@appilot-labs/appilot-headless';

/** 需镜像的 kv 顶层 key → project_blobs domain。 */
export const KV_BLOB_IMPORT_MARK = '__kvBlobsImported';

export const KV_BLOB_DOMAINS: Record<string, string> = {
  ascCache: 'ascCache',
  competitors: 'competitors',
  competitorSnapshots: 'competitorSnapshots',
  competitorRankSnapshots: 'competitorRankSnapshots',
  readinessChecks: 'readinessChecks',
  feedback: 'feedback',
};

/** 同步一个域：整体覆盖式镜像（先写后清陈旧 key）。 */
export function syncKvBlobMap(
  store: AppilotStore,
  domain: string,
  map: Record<string, unknown> | null | undefined,
): number {
  const entries = map && typeof map === 'object' ? map : {};
  let n = 0;
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined) continue;
    try {
      store.blobs.put(domain, key, value);
      n += 1;
    } catch {
      // 单条失败跳过
    }
  }
  store.blobs.pruneKeys(domain, Object.keys(entries));
  return n;
}
