/**
 * kv rankExecutions → 共享 DB 一次性导入（纯逻辑，无 electron 依赖）。
 *
 * DB 侧 executions.add 使用 (ts, taskId) 唯一约束 INSERT OR IGNORE，重复导入幂等；
 * 完成标记存 app_kv，之后新增由 scheduler 双写覆盖。
 */
import type { AppilotStore } from '@appilot-labs/appilot-headless';

export const RANK_EXEC_IMPORT_MARK = '__kvRankExecutionsImported';

export function syncRankExecutionsToDb(
  store: AppilotStore,
  kvExecutions: any[],
): number {
  let n = 0;
  for (const entry of kvExecutions || []) {
    if (!entry || typeof entry !== 'object') continue;
    try {
      store.executions.add(entry as Record<string, unknown>);
      n += 1;
    } catch {
      // 单条失败跳过（如缺 ts 等）
    }
  }
  return n;
}
