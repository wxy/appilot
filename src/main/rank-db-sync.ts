/**
 * Electron → 共享 SQLite 的 rank 快照同步（Phase 4b）。
 *
 * electron-store 的 product.rankSnapshots 仍是 UI 读取的富数据源；此处把
 * rank 采集结果**同步写一份**到共享 DB（DSH / CLI / MCP 可读同一份 rank 历史），
 * 并把历史存量一次性幂等导入：
 * - 幂等：某 (project, product) 在 DB 已有任一行则跳过导入（双写持续增量，不会重复）；
 * - 双写失败只告警，不影响 electron-store 主流程（DB 是尽力而为的共享副本）。
 *
 * 本模块不 import electron —— 纯 headless store + 纯映射，可在 node 下单测。
 */
import type { AppilotStore, RankSnapshotRow } from '@appilot-labs/appilot-headless';

/** electron-store 里 project / product / snapshot 的最小形状。 */
export interface ElectronProjectLike {
  name?: string | null;
  storeProducts?: Array<{
    id?: string | null;
    rankSnapshots?: Array<{
      keyword?: unknown;
      language?: unknown;
      storefront?: unknown;
      rank?: unknown;
      totalResults?: unknown;
      checkedAt?: unknown;
    }>;
  }>;
}

/** electron snapshot 形状 → headless RankSnapshotRow（project/product 维度补全）。 */
export function toRankRows(
  projectName: string,
  productId: string,
  snapshots: NonNullable<NonNullable<ElectronProjectLike['storeProducts']>[number]['rankSnapshots']>,
): RankSnapshotRow[] {
  const rows: RankSnapshotRow[] = [];
  for (const s of snapshots ?? []) {
    if (
      !s ||
      typeof s.keyword !== 'string' ||
      typeof s.language !== 'string' ||
      typeof s.storefront !== 'string' ||
      typeof s.checkedAt !== 'string'
    ) {
      continue; // 跳过畸形行
    }
    rows.push({
      projectName,
      productId,
      keyword: s.keyword,
      language: s.language,
      storefront: s.storefront,
      rank: typeof s.rank === 'number' ? s.rank : null,
      totalResults: typeof s.totalResults === 'number' ? s.totalResults : 0,
      checkedAt: s.checkedAt,
    });
  }
  return rows;
}

/**
 * 幂等导入 electron-store 存量 rank 历史到共享 DB。
 * 返回导入的行数（0 = 无新数据：DB 已含或项目为空）。
 */
export function importRankHistoryToDb(store: AppilotStore, projects: ElectronProjectLike[]): number {
  let imported = 0;
  for (const p of projects ?? []) {
    const projectName = p?.name;
    if (!projectName) continue;
    for (const product of p?.storeProducts ?? []) {
      const productId = product?.id;
      if (!productId) continue;
      const rows = toRankRows(projectName, productId, product?.rankSnapshots ?? []);
      if (rows.length === 0) continue;
      // DB 已有该 (project, product) 数据（双写或之前导入过）→ 跳过，防重复。
      if (store.snapshots.latestByKey(projectName, productId).length > 0) continue;
      store.snapshots.add(rows);
      imported += rows.length;
    }
  }
  return imported;
}

/**
 * 单条 rank 采集结果双写进共享 DB（成功路径调用；失败静默告警由调用方处理）。
 * 返回是否写入成功。
 */
export function recordRankSnapshotToDb(
  store: AppilotStore,
  projectName: string,
  productId: string,
  snapshot: {
    keyword: string;
    language: string;
    storefront: string;
    rank: number | null;
    totalResults: number;
    checkedAt: string;
  },
): boolean {
  try {
    store.snapshots.add([
      {
        projectName,
        productId,
        keyword: snapshot.keyword,
        language: snapshot.language,
        storefront: snapshot.storefront,
        rank: snapshot.rank,
        totalResults: snapshot.totalResults,
        checkedAt: snapshot.checkedAt,
      },
    ]);
    return true;
  } catch {
    return false;
  }
}
