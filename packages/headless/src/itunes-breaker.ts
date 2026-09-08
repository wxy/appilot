/**
 * iTunes Search 403 熔断（headless 侧，与主进程同键、同冷却语义）。
 *
 * 常驻 scheduler daemon / headless scheduler 与主进程 scheduler 打开**同一个**
 * appilot.db（headless openStore 的 app_kv 表），因此熔断状态天然共享：
 * - 键名与 45 分钟冷却常量来自 core（rank-collector）——两处不漂移；
 * - 写键格式与主进程一致（electron 侧经 JSON.stringify 存入带引号的 ISO；
 *   这里也写 JSON.stringify(iso)，core 判定函数两种存法都兼容）；
 * - 任一侧触发 → 所有壳（Electron / daemon / DSH）下一次读取即生效，无需重启。
 */
import {
  ITUNES_SEARCH_BLOCK_KV_KEY,
  formatItunesBlockClock,
  isItunesSearchBlocked,
  itunesSearchBlockUntilIso,
  itunesSearchBlockUntilIsoForNow,
} from '@appilot-labs/appilot-core/rank-collector';
import type { AppilotStore } from './store.js';

export { ITUNES_SEARCH_BLOCK_KV_KEY };

/** 熔断解除时刻（ISO）；未熔断返回 null。 */
export function itunesSearchBlockedUntilStore(
  store: AppilotStore,
  nowMs: number = Date.now(),
): string | null {
  return itunesSearchBlockUntilIso(store.kv.get(ITUNES_SEARCH_BLOCK_KV_KEY), nowMs);
}

/** 共享 store 当前是否处于 iTunes Search 403 熔断（冷却中）。 */
export function isItunesSearchBlockedStore(
  store: AppilotStore,
  nowMs: number = Date.now(),
): boolean {
  return isItunesSearchBlocked(store.kv.get(ITUNES_SEARCH_BLOCK_KV_KEY), nowMs);
}

/**
 * 触发熔断：写入 until = now + 45 分钟（与主进程同键）。已在冷却期内不再
 * 重复顺延（保持首次触发的时间窗口）。返回是否本次**新触发**。
 */
export function armItunesSearchBlockStore(
  store: AppilotStore,
  nowMs: number = Date.now(),
): boolean {
  if (itunesSearchBlockedUntilStore(store, nowMs) !== null) return false;
  // 与主进程 getStore().set 一致：kv 值 JSON.stringify(iso)（核心判定兼容裸 ISO）。
  store.kv.set(ITUNES_SEARCH_BLOCK_KV_KEY, JSON.stringify(itunesSearchBlockUntilIsoForNow(nowMs)));
  return true;
}

/** 熔断中跳过实例的 lastSummary 文案（不改变状态/排期，仅提示）。 */
export function itunesSearchBlockSkipSummary(
  store: AppilotStore,
  nowMs: number = Date.now(),
): string {
  const until = itunesSearchBlockedUntilStore(store, nowMs);
  return until
    ? `iTunes Search 熔断中，跳过采集（冷却至 ${formatItunesBlockClock(until)}，结束自动恢复）`
    : 'iTunes Search 熔断中，跳过采集';
}
