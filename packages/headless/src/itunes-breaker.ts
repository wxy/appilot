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
  computeItunesSearchBlock,
  formatItunesBlockClock,
  isItunesSearchBlocked,
  itunesSearchBlockStateFromRaw,
} from '@appilot-labs/appilot-core/rank-collector';
import type { AppilotStore } from './store.js';

export { ITUNES_SEARCH_BLOCK_KV_KEY };

/** 熔断解除时刻（ISO）；未熔断返回 null。 */
export function itunesSearchBlockedUntilStore(
  store: AppilotStore,
  nowMs: number = Date.now(),
): string | null {
  return itunesSearchBlockStateFromRaw(store.kv.get(ITUNES_SEARCH_BLOCK_KV_KEY), nowMs)?.untilIso ?? null;
}

/** 共享 store 当前是否处于 iTunes Search 403 熔断（冷却中）。 */
export function isItunesSearchBlockedStore(
  store: AppilotStore,
  nowMs: number = Date.now(),
): boolean {
  return isItunesSearchBlocked(store.kv.get(ITUNES_SEARCH_BLOCK_KV_KEY), nowMs);
}

/**
 * 触发熔断（级别化冷却）：写入 {"until","level"}。解除后复发窗口内（15min）
 * 再次 403 → 级别 +1、冷却翻倍（45→90→180→360min 封顶），打破「解除即全速
 * 重试 → 又 403 → 再延 45 分钟」的滚动延期；已在冷却期内保持原窗口不变。
 * 返回本次写入的冷却信息（newlyArmed=false 表示冷却已在进行、未改动）。
 */
export function armItunesSearchBlockStore(
  store: AppilotStore,
  nowMs: number = Date.now(),
): { newlyArmed: boolean; level: number; untilIso: string; durationMinutes: number } {
  const existing = itunesSearchBlockStateFromRaw(store.kv.get(ITUNES_SEARCH_BLOCK_KV_KEY), nowMs);
  if (existing) {
    return {
      newlyArmed: false,
      level: existing.level,
      untilIso: existing.untilIso,
      durationMinutes: 0,
    };
  }
  const computed = computeItunesSearchBlock(store.kv.get(ITUNES_SEARCH_BLOCK_KV_KEY), nowMs);
  // 与主进程 store.set 的 kv 落盘形态一致（JSON 文本；core 判定兼容两种来源）。
  store.kv.set(ITUNES_SEARCH_BLOCK_KV_KEY, JSON.stringify(computed.state));
  return {
    newlyArmed: true,
    level: computed.state.level,
    untilIso: computed.untilIso,
    durationMinutes: Math.round(computed.durationMs / 60_000),
  };
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
