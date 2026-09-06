/** 从共享 DB project_blobs 读取某域某 key（失败返回 undefined，供 kv 兜底）。 */
import type { AppilotStore } from '@appilot-labs/appilot-headless';

export function blobGet(
  store: AppilotStore | null | undefined,
  domain: string,
  key: string,
): unknown {
  if (!store) return undefined;
  try {
    return store.blobs.get(domain, key);
  } catch {
    return undefined;
  }
}
