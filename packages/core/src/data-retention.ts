/**
 * 数据保留（retention）纯函数层：排名快照按 checkedAt 剪除的口径与 SQL 执行。
 *
 * 纯函数、无 Electron 依赖——Electron 侧启动任务（src/main/data-retention.ts）
 * 与单测共用同一实现，保证 kv 与 DB 剪除口径一致。
 */

export interface DatedRowLike {
  checkedAt?: string | null;
}

/** 保留期截止时间（ISO）：nowMs 往前推 retentionDays 天。 */
export function rankRetentionCutoffIso(nowMs: number, retentionDays: number): string {
  const days = Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : 0;
  return new Date(nowMs - days * 86400000).toISOString();
}

/**
 * 按 cutoffIso 剪除过期行（checkedAt < cutoff）。
 * checkedAt 缺失/不可解析的行视为「未过期」保留（宁多留勿误删）。
 */
export function pruneDatedRows<T extends DatedRowLike>(
  rows: T[] | null | undefined,
  cutoffIso: string,
): { kept: T[]; removed: T[] } {
  const cutoffMs = Date.parse(cutoffIso);
  const kept: T[] = [];
  const removed: T[] = [];
  for (const row of rows ?? []) {
    const checkedMs = Date.parse(row?.checkedAt || "");
    if (Number.isFinite(checkedMs) && checkedMs < cutoffMs) removed.push(row);
    else kept.push(row);
  }
  return { kept, removed };
}

/** node:sqlite DatabaseSync 的最小结构接口（便于测试注入与类型约束）。 */
export interface RetentionDb {
  prepare(sql: string): { run(...args: unknown[]): { changes: number | bigint } };
  exec(sql: string): void;
}

/**
 * 删除 rank_snapshots 中过期行；删除量达到阈值时执行 wal_checkpoint，
 * 让空间实际归还操作系统（VACUUM 由维护任务另行触发，避免启动卡顿）。
 */
export function deleteExpiredRankSnapshots(
  db: RetentionDb,
  cutoffIso: string,
  checkpointThresholdRows = 20_000,
): number {
  const result = db.prepare("DELETE FROM rank_snapshots WHERE checkedAt < ?").run(cutoffIso);
  const changes = Number(result?.changes ?? 0) || 0;
  if (changes >= checkpointThresholdRows) db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  return changes;
}
