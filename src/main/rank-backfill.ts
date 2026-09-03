/**
 * rank 快照反向同步（P2b）：共享 DB rank_snapshots → electron-store
 * product.rankSnapshots。
 *
 * Electron 自身执行 rank 时已写 electron-store（runRankTask）；当 **其他执行者**
 * （DSH / daemon includeRank）把采集结果写进共享 DB 后，Electron UI 排名页需要
 * 这份数据——本模块把 DB 中比 electron-store 更新的点按 appendRankSnapshots
 * 语义合并回去（去重 + 90 天窗口 + 每 key 上限）。
 *
 * 幂等：只合并 checkedAt 晚于本地最新点的记录；每 10s hydrate 轮询开销小
 * （rank 采集低频）。不 import electron，纯映射可在 node 下单测。
 */
import type { AppilotStore, RankSnapshotRow } from '@appilot-labs/appilot-headless';
import { appendRankSnapshots, type RankSnapshotLike } from '@appilot-labs/appilot-core/rank-snapshots';

/** electron-store project 的最小形状（含 storeProducts[].rankSnapshots）。 */
export interface ElectronProjectRanked {
  name?: string | null;
  storeProducts?: Array<{
    id?: string | null;
    rankSnapshots?: Array<{
      keyword?: string;
      language?: string;
      storefront?: string;
      rank?: number | null;
      totalResults?: number;
      checkedAt?: string;
    }>;
  }>;
}

/** electron 快照清洗为 RankSnapshotLike（缺必填字段的行丢弃）。 */
function cleanExisting(list: any[]): RankSnapshotLike[] {
  const out: RankSnapshotLike[] = [];
  for (const s of list ?? []) {
    if (
      s &&
      typeof s.keyword === 'string' &&
      typeof s.language === 'string' &&
      typeof s.storefront === 'string' &&
      typeof s.checkedAt === 'string'
    ) {
      out.push({
        keyword: s.keyword,
        language: s.language,
        storefront: s.storefront,
        rank: typeof s.rank === 'number' ? s.rank : null,
        totalResults: typeof s.totalResults === 'number' ? s.totalResults : 0,
        checkedAt: s.checkedAt,
      });
    }
  }
  return out;
}

/** DB 行 → electron snapshot 形状（去 project/product 维度字段）。 */
function toSnapshotLike(row: RankSnapshotRow): {
  keyword: string;
  language: string;
  storefront: string;
  rank: number | null;
  totalResults: number;
  checkedAt: string;
} {
  return {
    keyword: row.keyword,
    language: row.language,
    storefront: row.storefront,
    rank: row.rank,
    totalResults: row.totalResults,
    checkedAt: row.checkedAt,
  };
}

/**
 * 反向同步：把 DB 中新于本地最新点的快照合并回 product.rankSnapshots。
 * 返回被更新的产品数（0 = 无更新）。
 */
export function backfillRankSnapshotsToElectron(
  store: AppilotStore,
  projects: ElectronProjectRanked[],
): number {
  let updated = 0;
  for (const p of projects ?? []) {
    if (!p?.name) continue;
    for (const product of p.storeProducts ?? []) {
      if (!product?.id) continue;
      const existing = Array.isArray(product.rankSnapshots) ? product.rankSnapshots : [];
      const cleanExistingList = cleanExisting(existing);
      // 本地最新点（checkedAt 最大）；无本地数据则全部 DB 点都算新
      let localLatest = '';
      for (const s of cleanExistingList) {
        if (s.checkedAt > localLatest) localLatest = s.checkedAt;
      }
      // DB 最新 N 点（降序）
      const dbRows = store.snapshots.recent(p.name, {
        productId: product.id,
        limit: 200,
      });
      if (dbRows.length === 0) continue;
      if (!localLatest) {
        // 本地完全没有该产品快照 → 全量导入（去重交给 appendRankSnapshots）
        product.rankSnapshots = appendRankSnapshots(cleanExistingList, dbRows.map(toSnapshotLike));
        updated += 1;
        continue;
      }
      const newer = dbRows.filter((r) => r.checkedAt > localLatest);
      if (newer.length === 0) continue;
      product.rankSnapshots = appendRankSnapshots(cleanExistingList, newer.map(toSnapshotLike));
      updated += 1;
    }
  }
  return updated;
}
