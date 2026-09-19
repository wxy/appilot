/**
 * 数据保留任务（启动时执行一次）：
 * - kv 侧：projects JSON 中 product.rankSnapshots（及项目级遗留副本）按保留期剪除；
 * - DB 侧：rank_snapshots 表删除过期行（与 kv 同口径），量大时 wal_checkpoint。
 *
 * 一致性关键：kv 与 DB 必须同口径剪除——rank-db-sync 的存量回填按
 * 「(project, product) 在 DB 已有任一行则跳过」，只剪一侧会让旧数据被整批灌回。
 */
import { join } from "node:path";
import { app } from "electron";
import { log } from "@appilot-labs/appilot-core/logger";
import {
  deleteExpiredRankSnapshots,
  pruneDatedRows,
  rankRetentionCutoffIso,
} from "@appilot-labs/appilot-core/data-retention";
import type { AppStore } from "./store";

export const RANK_RETENTION_DEFAULT_DAYS = 180;

export function runDataRetention(
  store: AppStore,
  nowMs: number = Date.now(),
): { removedKv: number; removedDb: number; retentionDays: number } {
  const configured = Number(store.get("rankRetentionDays"));
  const retentionDays =
    Number.isFinite(configured) && configured > 0 ? configured : RANK_RETENTION_DEFAULT_DAYS;
  const cutoffIso = rankRetentionCutoffIso(nowMs, retentionDays);

  // kv 侧：projects JSON 剪除（product.rankSnapshots + 项目级遗留副本）
  let removedKv = 0;
  let kvChanged = false;
  const projects = (store.get("projects") as any[]) || [];
  for (const project of projects) {
    if (Array.isArray(project.rankSnapshots)) {
      const { kept, removed } = pruneDatedRows(project.rankSnapshots, cutoffIso);
      if (removed.length) {
        project.rankSnapshots = kept;
        removedKv += removed.length;
        kvChanged = true;
      }
    }
    for (const product of project.storeProducts || []) {
      if (!Array.isArray(product.rankSnapshots)) continue;
      const { kept, removed } = pruneDatedRows(product.rankSnapshots, cutoffIso);
      if (removed.length) {
        product.rankSnapshots = kept;
        removedKv += removed.length;
        kvChanged = true;
      }
    }
  }
  if (kvChanged) store.set("projects", projects);

  // DB 侧：appilot.db 的 rank_snapshots（用户数据目录固定路径）
  let removedDb = 0;
  try {
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const db = new DatabaseSync(join(app.getPath("userData"), "appilot.db"));
    try {
      removedDb = deleteExpiredRankSnapshots(db, cutoffIso);
    } finally {
      db.close();
    }
  } catch (err: any) {
    log.warn(`retention: rank_snapshots 清理失败（下次启动重试）: ${err.message}`);
  }

  log.info(
    `retention: 排名快照保留 ${retentionDays} 天，清理 kv -${removedKv} 条 · DB -${removedDb} 行`,
  );
  return { removedKv, removedDb, retentionDays };
}
