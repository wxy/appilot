/**
 * 竞品排名快照的行式存储（迁移 Phase C）：competitorRankSnapshots 从
 * kv JSON 整体读改写迁移为 competitor_rank_snapshots 行表——
 * - 写：行级 INSERT OR IGNORE（唯一键去重），不再整块读改写；
 * - 读：latest-wins（同 keyword+storefront+platform 取最新）重建映射，
 *   每竞品保留最近 300 条，shape 与旧 kv 映射一致；
 * - 迁移：kv JSON → 行（幂等），成功后由启动任务退役 kv 键。
 *
 * 纯 SQL 函数接受注入的 db（可单测）；*ForApp 封装负责打开应用库。
 */
import { app } from "electron";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface CompetitorRankRow {
  projectId: string;
  competitorId: string;
  keyword: string;
  language: string;
  storefront: string;
  /** 旧 kv 数据可能缺 platform；空串表示未知/旧数据。 */
  platform: string;
  rank: number | null;
  checkedAt: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS competitor_rank_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  projectId TEXT NOT NULL,
  competitorId TEXT NOT NULL,
  keyword TEXT NOT NULL,
  language TEXT,
  storefront TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  rank INTEGER,
  checkedAt TEXT NOT NULL
)`;
const UNIQUE_INDEX =
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_competitor_rank_unique ON competitor_rank_snapshots (projectId, competitorId, keyword, storefront, platform, checkedAt)";

function defaultDbPath(): string {
  return join(app.getPath("userData"), "appilot.db");
}

export function openCompetitorDb(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  db.exec(UNIQUE_INDEX);
  return db;
}

/** 行级 upsert（唯一键去重），返回实际新插入行数。 */
export function saveCompetitorRankRows(db: DatabaseSync, rows: CompetitorRankRow[]): number {
  if (rows.length === 0) return 0;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO competitor_rank_snapshots
     (projectId, competitorId, keyword, language, storefront, platform, rank, checkedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let saved = 0;
  for (const row of rows) {
    const result = insert.run(
      row.projectId,
      row.competitorId,
      row.keyword,
      row.language,
      row.storefront,
      row.platform,
      row.rank,
      row.checkedAt,
    );
    saved += Number(result?.changes ?? 0);
  }
  return saved;
}

/** 读侧重建映射：同 (keyword, storefront, platform) 仅保留最新条目、每竞品上限 cap。 */
export function loadCompetitorRankMap(
  db: DatabaseSync,
  projectId: string,
  capPerCompetitor = 300,
): Record<string, any[]> {
  const rows = db
    .prepare(
      `SELECT competitorId, keyword, language, storefront, platform, rank, checkedAt
       FROM competitor_rank_snapshots WHERE projectId = ? ORDER BY checkedAt ASC, id ASC`,
    )
    .all(projectId) as any[];
  const rowsByCompetitor: Record<string, any[]> = {};
  for (const row of rows) {
    const list = (rowsByCompetitor[row.competitorId] ??= []);
    list.push({
      keyword: row.keyword,
      language: row.language,
      storefront: row.storefront,
      platform: row.platform || undefined,
      rank: row.rank,
      checkedAt: row.checkedAt,
    });
  }
  const out: Record<string, any[]> = {};
  for (const [competitorId, entries] of Object.entries(rowsByCompetitor)) {
    const byCombo = new Map<string, any>();
    for (const entry of entries) {
      byCombo.set(`${entry.keyword}\u0000${entry.storefront}\u0000${entry.platform ?? ""}`, entry);
    }
    out[competitorId] = [...byCombo.values()].slice(-capPerCompetitor);
  }
  return out;
}

/** 保留策略：删除早于 cutoffIso 的行，返回删除行数。 */
export function pruneCompetitorRankRowsOlderThan(db: DatabaseSync, cutoffIso: string): number {
  const result = db
    .prepare("DELETE FROM competitor_rank_snapshots WHERE checkedAt < ?")
    .run(cutoffIso);
  return Number(result?.changes ?? 0) || 0;
}

/** 旧 kv 形状（{ [projectId]: { [competitorId]: entries[] } }）→ 行数组（纯函数，迁移用）。 */
export function competitorKvToRows(
  blob: Record<string, Record<string, any[]>> | null | undefined,
): CompetitorRankRow[] {
  const rows: CompetitorRankRow[] = [];
  for (const [projectId, byCompetitor] of Object.entries(blob || {})) {
    for (const [competitorId, entries] of Object.entries(byCompetitor || {})) {
      for (const entry of entries || []) {
        if (!entry || typeof entry.keyword !== "string" || !entry.storefront) continue;
        rows.push({
          projectId,
          competitorId,
          keyword: entry.keyword,
          language: entry.language ?? "",
          storefront: entry.storefront,
          platform: entry.platform ?? "",
          rank: typeof entry.rank === "number" ? entry.rank : null,
          checkedAt: entry.checkedAt,
        });
      }
    }
  }
  return rows;
}

// ── Electron 侧封装（打开应用库 + 自动关闭）──

export function saveCompetitorRankRowsForApp(rows: CompetitorRankRow[]): number {
  const db = openCompetitorDb(defaultDbPath());
  try {
    return saveCompetitorRankRows(db, rows);
  } finally {
    db.close();
  }
}

export function loadCompetitorRankMapForApp(
  projectId: string,
): Record<string, any[]> {
  const db = openCompetitorDb(defaultDbPath());
  try {
    return loadCompetitorRankMap(db, projectId);
  } finally {
    db.close();
  }
}

export function pruneCompetitorRankRowsOlderThanForApp(cutoffIso: string): number {
  const db = openCompetitorDb(defaultDbPath());
  try {
    return pruneCompetitorRankRowsOlderThan(db, cutoffIso);
  } finally {
    db.close();
  }
}

/** 一次性迁移：kv JSON → 行表（INSERT OR IGNORE 幂等）。返回导入行数。 */
export function migrateCompetitorRankSnapshotsFromKv(
  store: { get(key: string): any },
): number {
  const blob = store.get("competitorRankSnapshots");
  if (!blob || typeof blob !== "object") return 0;
  const rows = competitorKvToRows(blob);
  const db = openCompetitorDb(defaultDbPath());
  try {
    return saveCompetitorRankRows(db, rows);
  } finally {
    db.close();
  }
}

/** 迁移完成后退役 kv 键（数据已在行表，唯一索引保证幂等）。 */
export function retireCompetitorRankSnapshotsKv(store: { kv: { delete(key: string): void } }): void {
  try {
    store.kv.delete("competitorRankSnapshots");
  } catch {
    /* 忽略：下次启动重试 */
  }
}
