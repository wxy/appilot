/**
 * Appilot headless SQLite Store（node:sqlite DatabaseSync + WAL）。
 *
 * - 一个进程一个连接（DatabaseSync 同步 API）；多进程打开同一文件：WAL 多读一写，
 *   busy_timeout 等待写锁；
 * - 所有写操作走事务（BEGIN/COMMIT），失败回滚；
 * - 对外暴露类型化操作（projects / snapshots / tasks / lease），行类型即契约。
 */
import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { migrate, type ProjectRow, type RankSnapshotRow, type TaskRow } from './schema.js';

/** 等待写锁的毫秒数（并发进程写竞争时避免立刻报 busy）。 */
const BUSY_TIMEOUT_MS = 5000;

export interface AppilotStore {
  readonly path: string;
  projects: {
    save(row: ProjectRow): void;
    list(): ProjectRow[];
    get(name: string): ProjectRow | undefined;
    remove(name: string): boolean;
  };
  snapshots: {
    /** 批量追加快照（保留历史）。 */
    add(rows: RankSnapshotRow[]): void;
    /** 每个 (project[, productId], keyword, language, storefront) 的最新一条。 */
    latestByKey(projectName: string, productId?: string | null): RankSnapshotRow[];
    /**
     * 最近的时间序列点（checkedAt 降序，最新在前），可按 productId/keyword 过滤。
     * productId 缺省 = 只看该项目的 DSH 维度（productId NULL）；显式传值看对应产品。
     */
    recent(
      projectName: string,
      opts?: { productId?: string | null; keyword?: string; limit?: number },
    ): RankSnapshotRow[];
    /** 清理某项目早于 checkedAt 的旧快照（保留最近 N 天）。 */
    pruneOlderThan(projectName: string, beforeIso: string): number;
  };
  tasks: {
    upsert(row: TaskRow): void;
    all(): TaskRow[];
    get(id: string): TaskRow | undefined;
  };
  lease: {
    /** 尝试获取租约：当前无主或主心跳过期则成为主。返回是否成功。 */
    acquire(leaderId: string, ttlMs: number): boolean;
    /** 续租：仅当前主可续；主已换人则失败。 */
    heartbeat(leaderId: string): boolean;
    /** 当前主是谁（无主返回 null）。 */
    leader(): string | null;
    /** 租约详情（leader + 最近心跳时间）；无主返回 null。 */
    info(): { leaderId: string; heartbeatAt: string } | null;
  };
  close(): void;
}

function parseLanguages(raw: unknown): string[] {
  try {
    const v = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function openStore(dbPath: string): AppilotStore {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);

  /** 事务包装。 */
  function tx<T>(fn: () => T): T {
    db.exec('BEGIN');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  return {
    path: dbPath,

    projects: {
      save(row) {
        tx(() => {
          db.prepare(
            `INSERT INTO projects (name, path, githubUrl, platform, languages, lastResolvedAt, artworkUrl, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(name) DO UPDATE SET
               path = excluded.path,
               githubUrl = excluded.githubUrl,
               platform = excluded.platform,
               languages = excluded.languages,
               lastResolvedAt = excluded.lastResolvedAt,
               artworkUrl = excluded.artworkUrl,
               updatedAt = excluded.updatedAt`,
          ).run(
            row.name,
            row.path,
            row.githubUrl,
            row.platform,
            JSON.stringify(row.languages),
            row.lastResolvedAt,
            row.artworkUrl,
            row.updatedAt,
          );
        });
      },
      list() {
        const rows = db
          .prepare('SELECT * FROM projects ORDER BY name')
          .all() as any[];
        return rows.map((r) => ({
          name: r.name,
          path: r.path,
          githubUrl: r.githubUrl,
          platform: r.platform,
          languages: parseLanguages(r.languages),
          lastResolvedAt: r.lastResolvedAt,
          artworkUrl: r.artworkUrl,
          updatedAt: r.updatedAt,
        }));
      },
      get(name) {
        const r = db.prepare('SELECT * FROM projects WHERE name = ?').get(name) as any;
        if (!r) return undefined;
        return {
          name: r.name,
          path: r.path,
          githubUrl: r.githubUrl,
          platform: r.platform,
          languages: parseLanguages(r.languages),
          lastResolvedAt: r.lastResolvedAt,
          artworkUrl: r.artworkUrl,
          updatedAt: r.updatedAt,
        };
      },
      remove(name) {
        const res = db.prepare('DELETE FROM projects WHERE name = ?').run(name);
        return Number(res.changes) > 0;
      },
    },

    snapshots: {
      add(rows) {
        if (rows.length === 0) return;
        tx(() => {
          const stmt = db.prepare(
            `INSERT INTO rank_snapshots (projectName, productId, keyword, language, storefront, rank, totalResults, checkedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          );
          for (const row of rows) {
            stmt.run(row.projectName, row.productId ?? null, row.keyword, row.language, row.storefront, row.rank, row.totalResults, row.checkedAt);
          }
        });
      },
      latestByKey(projectName: string, productId?: string | null) {
        // 每组 (keyword, language, storefront) 取最新（checkedAt 降序，同刻按 id 兜底）
        const rows = db
          .prepare(
            `SELECT s.* FROM rank_snapshots s
             WHERE s.projectName = ? AND s.productId IS ?
               AND s.id = (
                 SELECT s2.id FROM rank_snapshots s2
                 WHERE s2.projectName = s.projectName
                   AND s2.productId IS s.productId
                   AND s2.keyword = s.keyword
                   AND s2.language = s.language
                   AND s2.storefront = s.storefront
                 ORDER BY s2.checkedAt DESC, s2.id DESC LIMIT 1)
             ORDER BY s.keyword, s.language, s.storefront`,
          )
          .all(projectName, productId ?? null) as any[];
        return rows.map(stripId);
      },
      pruneOlderThan(projectName, beforeIso) {
        const res = db
          .prepare('DELETE FROM rank_snapshots WHERE projectName = ? AND checkedAt < ?')
          .run(projectName, beforeIso);
        return Number(res.changes);
      },
      recent(projectName, opts = {}) {
        const limit = Math.min(Math.max(opts.limit ?? 200, 1), 2000);
        const productId = opts.productId ?? null;
        const rows = opts.keyword
          ? (db
              .prepare(
                `SELECT * FROM rank_snapshots
                 WHERE projectName = ? AND productId IS ? AND keyword = ?
                 ORDER BY checkedAt DESC, id DESC LIMIT ?`,
              )
              .all(projectName, productId, opts.keyword, limit) as any[])
          : (db
              .prepare(
                `SELECT * FROM rank_snapshots
                 WHERE projectName = ? AND productId IS ?
                 ORDER BY checkedAt DESC, id DESC LIMIT ?`,
              )
              .all(projectName, productId, limit) as any[]);
        return rows.map(stripId);
      },
    },

    tasks: {
      upsert(row) {
        tx(() => {
          db.prepare(
            `INSERT INTO tasks (id, title, intervalMinutes, lastRunAt, nextRunAt, lastStatus, lastSummary, runCount)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               title = excluded.title,
               intervalMinutes = excluded.intervalMinutes,
               lastRunAt = excluded.lastRunAt,
               nextRunAt = excluded.nextRunAt,
               lastStatus = excluded.lastStatus,
               lastSummary = excluded.lastSummary,
               runCount = excluded.runCount`,
          ).run(
            row.id,
            row.title,
            row.intervalMinutes,
            row.lastRunAt,
            row.nextRunAt,
            row.lastStatus,
            row.lastSummary,
            row.runCount,
          );
        });
      },
      all() {
        const rows = db.prepare('SELECT * FROM tasks ORDER BY id').all() as any[];
        return rows.map((r) => ({
          id: r.id,
          title: r.title,
          intervalMinutes: r.intervalMinutes,
          lastRunAt: r.lastRunAt,
          nextRunAt: r.nextRunAt,
          lastStatus: r.lastStatus,
          lastSummary: r.lastSummary,
          runCount: r.runCount,
        }));
      },
      get(id) {
        const r = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any;
        if (!r) return undefined;
        return {
          id: r.id,
          title: r.title,
          intervalMinutes: r.intervalMinutes,
          lastRunAt: r.lastRunAt,
          nextRunAt: r.nextRunAt,
          lastStatus: r.lastStatus,
          lastSummary: r.lastSummary,
          runCount: r.runCount,
        };
      },
    },

    lease: {
      acquire(leaderId, ttlMs) {
        return tx(() => {
          const existing = db.prepare('SELECT * FROM lease WHERE id = 1').get() as any;
          const now = Date.now();
          if (existing) {
            const heartbeat = new Date(existing.heartbeatAt).getTime();
            if (existing.leaderId !== leaderId && now - heartbeat < ttlMs) {
              return false; // 还有活主
            }
            db.prepare('UPDATE lease SET leaderId = ?, heartbeatAt = ? WHERE id = 1').run(
              leaderId,
              new Date(now).toISOString(),
            );
          } else {
            db.prepare('INSERT INTO lease (id, leaderId, heartbeatAt) VALUES (1, ?, ?)').run(
              leaderId,
              new Date(now).toISOString(),
            );
          }
          return true;
        });
      },
      heartbeat(leaderId) {
        return tx(() => {
          const existing = db.prepare('SELECT * FROM lease WHERE id = 1').get() as any;
          if (!existing || existing.leaderId !== leaderId) return false;
          db.prepare('UPDATE lease SET heartbeatAt = ? WHERE id = 1').run(
            new Date().toISOString(),
          );
          return true;
        });
      },
      leader() {
        const r = db.prepare('SELECT leaderId FROM lease WHERE id = 1').get() as any;
        return r ? r.leaderId : null;
      },
      info() {
        const r = db.prepare('SELECT leaderId, heartbeatAt FROM lease WHERE id = 1').get() as any;
        return r ? { leaderId: r.leaderId, heartbeatAt: r.heartbeatAt } : null;
      },
    },

    close() {
      db.close();
    },
  };
}

function stripId(r: any): RankSnapshotRow {
  return {
    projectName: r.projectName,
    productId: r.productId ?? null,
    keyword: r.keyword,
    language: r.language,
    storefront: r.storefront,
    rank: r.rank,
    totalResults: r.totalResults,
    checkedAt: r.checkedAt,
  };
}
