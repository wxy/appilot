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
import { randomUUID } from 'node:crypto';
import { migrate, type ProjectRow, type RankSnapshotRow, type TaskRow, type TaskSchedule, type ProjectMetaRow, type ProductRecordRow, type ReleaseCacheRow } from './schema.js';

/** 等待写锁的毫秒数（并发进程写竞争时避免立刻报 busy）。 */
const BUSY_TIMEOUT_MS = 5000;

export interface AppilotStore {
  readonly path: string;
  projects: {
    save(row: ProjectRow): void;
    list(): ProjectRow[];
    get(name: string): ProjectRow | undefined;
    remove(name: string): boolean;
    /**
     * 级联删除某项目在共享 DB 的全部痕迹（注册表 + 产品注册 / repo 元数据 /
     * 排名快照 / 发布缓存）。供「删除项目」使用——否则下一轮 hydration 会
     * 把共享 DB 里残留的注册表行重新水合回 electron-store（项目“复活”）。
     */
    removeDeep(name: string): boolean;
    /** v14：只修改展示名；所有关联关系均由稳定 id 维持。 */
    rename(oldName: string, newName: string): boolean;
  };
  /** 通用键值（v7）：electron-store 全量迁入 SQLite 的落地表；值为原始字符串（JSON 文本）。 */
  kv: {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    delete(key: string): boolean;
  };
  /** 通用 per-key JSON（v11）：kv 里 Record<项目/产品 id, 数据> 类域的结构化落点。 */
  blobs: {
    put(domain: string, projectKey: string, value: unknown): void;
    get(domain: string, projectKey: string): unknown | undefined;
    all(domain: string): Record<string, unknown>;
    /** 删除某 domain 下不在 keepKeys 中的行（镜像时清理陈旧 key）。 */
    pruneKeys(domain: string, keepKeys: string[]): number;
  };
  /** rank 执行记录（v9）：electron kv rankExecutions 的结构化落点（双写期读仍走 kv）。 */
  executions: {
    /** 追加一条执行记录（entryJson 原样保留，ts/taskId/status/durationMs 提列索引）。 */
    add(entry: Record<string, unknown>): void;
    /** 返回 ts >= sinceIso 的记录（按 ts/id 升序），limit 上限默认 20000。 */
    since(sinceIso: string, limit?: number): Record<string, unknown>[];
    /** 最近 limit 条（按 ts/id 升序返回；镜像 kv slice(-20000) 语义）。 */
    latest(limit?: number): Record<string, unknown>[];
    /** 按任务聚合完整历史，不解析 entryJson；供任务中心恢复运行事实。 */
    summaryByTask(): { taskId: string; firstRunAt: string; lastRunAt: string; count: number }[];
    /** 清理早于 beforeIso 的记录，返回删除行数。 */
    pruneBefore(beforeIso: string): number;
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
    /**
     * 某产品的时间序列（读侧项目视图用）：90 天窗口内、每个
     * (keyword, language, storefront) 保留最近最多 120 条，按 checkedAt 升序返回——
     * 与 electron kv 侧 appendRankSnapshots 的裁剪语义一致，避免 recent() 的全产品
     * 2000 行上限把早期历史挤掉。
     */
    history(
      projectName: string,
      opts?: { productId?: string | null; keyword?: string },
    ): RankSnapshotRow[];
    /** 清理某项目早于 checkedAt 的旧快照（保留最近 N 天）。 */
    pruneOlderThan(projectName: string, beforeIso: string): number;
    /** 全库清理早于 checkedAt 的旧快照（数据管理/保留策略用）。返回删除行数。 */
    pruneAllOlderThan(beforeIso: string): number;
    /**
     * 每个 (productId, keyword, language, storefront) 的最新快照时间表
     * （覆盖热力图等全局聚合用）。key = `productId|keyword|language|storefront`。
     */
    latestCheckedAtByKey(): Record<string, string>;
  };
  tasks: {
    /**
     * upsert 任务行。默认（无 opts）UPDATE 分支不覆盖 kind/instance/source
     * （调度状态写回不应改身份）；opts.setIdentity=true 时同时更新身份字段
     * （reconcile 参数/身份刷新用，例如把镜像先建的 kind=null 行升级为实例行）。
     */
    upsert(row: TaskRow, opts?: { setIdentity?: boolean; schedule?: TaskSchedule | null }): void;
    /** Atomic compare-and-set: never overwrite an intervening manual edit. */
    advance(row: TaskRow, target: string, at: string): boolean;
    all(): TaskRow[];
    get(id: string): TaskRow | undefined;
    /** 删除任务行（镜像清理：源里已不存在的 Electron 任务）。 */
    remove(id: string): boolean;
  };
  /** v5 富数据：repo 状态（github-sync 边界 / UI 展示）。 */
  meta: {
    save(row: ProjectMetaRow): void;
    get(projectName: string): ProjectMetaRow | undefined;
  };
  /** v5 富数据：产品注册（rank 等富数据任务实例化 / UI 读取）。 */
  products: {
    upsert(row: ProductRecordRow): void;
    listByProject(projectName: string): ProductRecordRow[];
  };
  /** v6 富数据：发布页数据缓存（githubSyncCache 条目；UI 迁出 electron-store 前提）。 */
  releaseCache: {
    save(projectName: string, cache: Record<string, unknown>, syncedAt?: string): void;
    get(projectName: string): ReleaseCacheRow | undefined;
  };
  lease: {
    /**
     * 尝试获取租约：无主或主心跳过期则成为主。返回是否成功。
     * ⚠️ TTL 语义：过期判定用**调用方传入的 ttlMs** 作窗口（心跳距今 > ttlMs
     * 视为主已崩溃）。所有壳必须使用一致的 TTL（如 60s），否则窗口不一致会
     * 导致接管判断失真（详见 tests/multiprocess.test.ts 第 4 步）。
     * ⚠️ 同 id 语义：同 id 且心跳新鲜 = 已有同 id 活主（双进程并存）→ 拒绝
     * （防双 daemon 并跑）；心跳过期 → 允许接管崩溃主的班。续租请用 heartbeat。
     */
    acquire(leaderId: string, ttlMs: number): boolean;
    /** 续租：仅当前主可续；主已换人则失败。 */
    heartbeat(leaderId: string): boolean;
    /** 当前主是谁（无主返回 null）。 */
    leader(): string | null;
    /** 租约详情（leader + 最近心跳时间）；无主返回 null。 */
    info(): { leaderId: string; heartbeatAt: string } | null;
    /**
     * 显式让位（自更新重启/升级用）：仅当前主可释放，立即删除租约行，
     * 让继任者无需等 TTL 即可接管。非当前主调用返回 false（无副作用）。
     */
    release(leaderId: string): boolean;
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

  function projectIdentity(ref: string): { id: string; name: string; path: string } | undefined {
    const row = db
      .prepare('SELECT id, name, path FROM projects WHERE name = ? OR id = ? ORDER BY name = ? DESC LIMIT 1')
      .get(ref, ref, ref) as { id?: string; name?: string; path?: string } | undefined;
    return row?.id && row?.name ? { id: row.id, name: row.name, path: row.path ?? '' } : undefined;
  }

  function requireProjectIdentity(ref: string): { id: string; name: string; path: string } {
    const identity = projectIdentity(ref);
    if (!identity) throw new Error(`项目不存在：${ref}`);
    return identity;
  }

  return {
    path: dbPath,

    projects: {
      save(row) {
        tx(() => {
          const existingByName = projectIdentity(row.name);
          const id = String(row.id ?? '').trim() || existingByName?.id || randomUUID();
          db.prepare(
            `INSERT INTO projects (name, id, path, githubUrl, platform, languages, lastResolvedAt, artworkUrl, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               path = excluded.path,
               githubUrl = excluded.githubUrl,
               platform = excluded.platform,
               languages = excluded.languages,
               lastResolvedAt = excluded.lastResolvedAt,
               artworkUrl = excluded.artworkUrl,
               updatedAt = excluded.updatedAt`,
          ).run(
            row.name,
            id,
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
          id: r.id ?? null,
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
        const r = db.prepare('SELECT * FROM projects WHERE name = ? OR id = ? ORDER BY name = ? DESC LIMIT 1').get(name, name, name) as any;
        if (!r) return undefined;
        return {
          name: r.name,
          id: r.id ?? null,
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
        const identity = projectIdentity(name);
        if (!identity) return false;
        const res = db.prepare('DELETE FROM projects WHERE id = ?').run(identity.id);
        return Number(res.changes) > 0;
      },
      removeDeep(name) {
        return tx(() => {
          const identity = projectIdentity(name);
          if (!identity) return false;
          db.prepare("DELETE FROM project_blobs WHERE domain IN ('storeSubmissionDrafts', 'copyPlans', 'preReleaseChecklist') AND projectKey = ?").run(identity.id);
          // 关联表由 FK ON DELETE CASCADE 清理；任务表是跨来源队列，按实例身份清理。
          const productIds = new Set(
            (db.prepare('SELECT productId FROM product_records WHERE projectId = ?').all(identity.id) as any[])
              .map((row) => String(row.productId)),
          );
          for (const task of db.prepare('SELECT id, instance, electronJson FROM tasks').all() as any[]) {
            const parseObject = (raw: unknown): Record<string, unknown> => {
              try {
                const parsed = JSON.parse(String(raw ?? '{}'));
                return parsed && typeof parsed === 'object' ? parsed : {};
              } catch {
                return {};
              }
            };
            const instance = parseObject(task.instance);
            const mirror = parseObject(task.electronJson);
            const taskId = String(task.id ?? '');
            const matchesProject =
              instance.projectId === identity.id ||
              mirror.projectId === identity.id ||
              taskId === `github-sync:${identity.id}` ||
              // v13 及更早的兼容清理。
              instance.projectName === identity.name ||
              mirror.projectName === identity.name ||
              taskId === `github-sync:${identity.name}` ||
              (identity.path && (instance.path === identity.path || mirror.path === identity.path));
            const matchesProduct = [...productIds].some(
              (productId) =>
                instance.productId === productId ||
                mirror.productId === productId ||
                taskId.startsWith(`${productId}:`),
            );
            if (matchesProject || matchesProduct) {
              db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
            }
          }
          const res = db.prepare('DELETE FROM projects WHERE id = ?').run(identity.id);
          return Number(res.changes) > 0;
        });
      },
      rename(oldName, newName) {
        const from = oldName.trim();
        const to = newName.trim();
        if (!from || !to) throw new Error('项目名不能为空');
        if (from === to) return Boolean(db.prepare('SELECT 1 FROM projects WHERE name = ?').get(from));
        return tx(() => {
          const existing = projectIdentity(from);
          if (!existing) return false;
          if (db.prepare('SELECT 1 FROM projects WHERE name = ?').get(to)) {
            throw new Error(`项目名已存在：${to}`);
          }
          db.prepare('UPDATE projects SET name = ?, updatedAt = ? WHERE name = ?')
            .run(to, new Date().toISOString(), from);
          return true;
        });
      },
    },

    kv: {
      get(key) {
        const r = db.prepare('SELECT value FROM app_kv WHERE key = ?').get(key) as
          | { value?: string }
          | undefined;
        return r ? r.value : undefined;
      },
      set(key, value) {
        tx(() => {
          db.prepare(
            `INSERT INTO app_kv (key, value, updatedAt) VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
          ).run(key, value, new Date().toISOString());
        });
      },
      delete(key) {
        const res = db.prepare('DELETE FROM app_kv WHERE key = ?').run(key);
        return Number(res.changes) > 0;
      },
    },

    blobs: {
      put(domain, projectKey, value) {
        tx(() => {
          db.prepare(
            `INSERT INTO project_blobs (domain, projectKey, json, updatedAt) VALUES (?, ?, ?, ?)
             ON CONFLICT(domain, projectKey) DO UPDATE SET json = excluded.json, updatedAt = excluded.updatedAt`,
          ).run(domain, projectKey, JSON.stringify(value), new Date().toISOString());
        });
      },
      get(domain, projectKey) {
        const r = db.prepare('SELECT json FROM project_blobs WHERE domain = ? AND projectKey = ?').get(domain, projectKey) as { json?: string } | undefined;
        return r ? JSON.parse(r.json as string) : undefined;
      },
      all(domain) {
        const rows = db.prepare('SELECT projectKey, json FROM project_blobs WHERE domain = ? ORDER BY projectKey').all(domain) as Array<{ projectKey: string; json: string }>;
        const out: Record<string, unknown> = {};
        for (const r of rows) out[r.projectKey] = JSON.parse(r.json);
        return out;
      },
      pruneKeys(domain, keepKeys) {
        const keep = keepKeys || [];
        const res = db
          .prepare(
            keep.length === 0
              ? 'DELETE FROM project_blobs WHERE domain = ?'
              : `DELETE FROM project_blobs WHERE domain = ? AND projectKey NOT IN (${keep.map(() => '?').join(',')})`,
          )
          .run(domain, ...(keep.length === 0 ? [] : keep));
        return Number(res.changes);
      },
    },

    executions: {
      add(entry) {
        const ts = typeof entry?.ts === 'string' ? entry.ts : new Date().toISOString();
        const taskId = typeof entry?.taskId === 'string' ? entry.taskId : null;
        const status = typeof entry?.status === 'string' ? entry.status : null;
        const durationMs = typeof entry?.durationMs === 'number' ? entry.durationMs : null;
        tx(() => {
          db.prepare(
            `INSERT OR IGNORE INTO rank_executions (ts, taskId, status, durationMs, entryJson)
             VALUES (?, ?, ?, ?, ?)`,
          ).run(ts, taskId, status, durationMs, JSON.stringify(entry));
        });
      },
      since(sinceIso, limit = 20000) {
        const n = Math.min(Math.max(limit, 1), 200000);
        const rows = db
          .prepare(
            `SELECT * FROM rank_executions WHERE ts >= ? ORDER BY ts ASC, id ASC LIMIT ?`,
          )
          .all(sinceIso, n) as any[];
        return rows.map((r) => JSON.parse(r.entryJson) as Record<string, unknown>);
      },
      latest(limit = 20000) {
        const n = Math.min(Math.max(limit, 1), 200000);
        const rows = db
          .prepare(
            `SELECT * FROM rank_executions ORDER BY ts DESC, id DESC LIMIT ?`,
          )
          .all(n) as any[];
        return rows.reverse().map((r) => JSON.parse(r.entryJson) as Record<string, unknown>);
      },
      summaryByTask() {
        const rows = db
          .prepare(
            `SELECT taskId, MIN(ts) AS firstRunAt, MAX(ts) AS lastRunAt, COUNT(*) AS count
             FROM rank_executions
             WHERE taskId IS NOT NULL AND taskId <> ''
             GROUP BY taskId
             ORDER BY taskId ASC`,
          )
          .all() as { taskId: string; firstRunAt: string; lastRunAt: string; count: number | bigint }[];
        return rows.map((row) => ({
          taskId: row.taskId,
          firstRunAt: row.firstRunAt,
          lastRunAt: row.lastRunAt,
          count: Number(row.count),
        }));
      },
      pruneBefore(beforeIso) {
        const res = db.prepare('DELETE FROM rank_executions WHERE ts < ?').run(beforeIso);
        return Number(res.changes);
      },
    },

    snapshots: {
      add(rows) {
        if (rows.length === 0) return;
        tx(() => {
          const stmt = db.prepare(
            `INSERT INTO rank_snapshots (projectId, productId, keyword, language, storefront, rank, totalResults, checkedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          );
          for (const row of rows) {
            const identity = row.projectId
              ? requireProjectIdentity(row.projectId)
              : requireProjectIdentity(row.projectName);
            stmt.run(identity.id, row.productId ?? null, row.keyword, row.language, row.storefront, row.rank, row.totalResults, row.checkedAt);
          }
        });
      },
      latestByKey(projectName: string, productId?: string | null) {
        const identity = projectIdentity(projectName);
        if (!identity) return [];
        // 每组 (keyword, language, storefront) 取最新（checkedAt 降序，同刻按 id 兜底）
        const rows = db
          .prepare(
            `SELECT s.*, p.name AS projectName FROM rank_snapshots s
             JOIN projects p ON p.id = s.projectId
             WHERE s.projectId = ? AND s.productId IS ?
               AND s.id = (
                 SELECT s2.id FROM rank_snapshots s2
                 WHERE s2.projectId = s.projectId
                   AND s2.productId IS s.productId
                   AND s2.keyword = s.keyword
                   AND s2.language = s.language
                   AND s2.storefront = s.storefront
                 ORDER BY s2.checkedAt DESC, s2.id DESC LIMIT 1)
             ORDER BY s.keyword, s.language, s.storefront`,
          )
          .all(identity.id, productId ?? null) as any[];
        return rows.map(stripId);
      },
      pruneOlderThan(projectName, beforeIso) {
        const identity = projectIdentity(projectName);
        if (!identity) return 0;
        const res = db
          .prepare('DELETE FROM rank_snapshots WHERE projectId = ? AND checkedAt < ?')
          .run(identity.id, beforeIso);
        return Number(res.changes);
      },
      /** 全库清理早于 checkedAt 的旧快照（数据管理/保留策略用）。返回删除行数。 */
      pruneAllOlderThan(beforeIso) {
        const res = db
          .prepare('DELETE FROM rank_snapshots WHERE checkedAt < ?')
          .run(beforeIso);
        return Number(res.changes);
      },
      latestCheckedAtByKey() {
        const out: Record<string, string> = {};
        const rows = db
          .prepare(
            `SELECT productId, keyword, language, storefront, MAX(checkedAt) AS latest
             FROM rank_snapshots
             WHERE productId IS NOT NULL
             GROUP BY productId, keyword, language, storefront`,
          )
          .all() as Array<{
            productId: string;
            keyword: string;
            language: string;
            storefront: string;
            latest: string;
          }>;
        for (const r of rows) {
          out[`${r.productId}|${r.keyword}|${r.language}|${r.storefront}`] = r.latest;
        }
        return out;
      },
      recent(projectName, opts = {}) {
        const identity = projectIdentity(projectName);
        if (!identity) return [];
        const limit = Math.min(Math.max(opts.limit ?? 200, 1), 2000);
        const productId = opts.productId ?? null;
        const rows = opts.keyword
          ? (db
              .prepare(
                `SELECT s.*, p.name AS projectName FROM rank_snapshots s
                 JOIN projects p ON p.id = s.projectId
                 WHERE s.projectId = ? AND s.productId IS ? AND s.keyword = ?
                 ORDER BY s.checkedAt DESC, s.id DESC LIMIT ?`,
              )
              .all(identity.id, productId, opts.keyword, limit) as any[])
          : (db
              .prepare(
                `SELECT s.*, p.name AS projectName FROM rank_snapshots s
                 JOIN projects p ON p.id = s.projectId
                 WHERE s.projectId = ? AND s.productId IS ?
                 ORDER BY s.checkedAt DESC, s.id DESC LIMIT ?`,
              )
              .all(identity.id, productId, limit) as any[]);
        return rows.map(stripId);
      },
      history(projectName, opts = {}) {
        const identity = projectIdentity(projectName);
        if (!identity) return [];
        const productId = opts.productId ?? null;
        const windowMs = 90 * 24 * 60 * 60 * 1000; // 与 core RANK_SNAPSHOT_WINDOW_MS 一致
        const maxPerKey = 120; // 与 core RANK_SNAPSHOT_MAX_PER_KEY 一致
        const since = new Date(Date.now() - windowMs).toISOString();
        const sql = opts.keyword
          ? `SELECT s.*, p.name AS projectName FROM rank_snapshots s
             JOIN projects p ON p.id = s.projectId
             WHERE s.projectId = ? AND s.productId IS ? AND s.keyword = ? AND s.checkedAt >= ?
             ORDER BY s.checkedAt ASC, s.id ASC`
          : `SELECT s.*, p.name AS projectName FROM rank_snapshots s
             JOIN projects p ON p.id = s.projectId
             WHERE s.projectId = ? AND s.productId IS ? AND s.checkedAt >= ?
             ORDER BY s.checkedAt ASC, s.id ASC`;
        const params = opts.keyword
          ? [identity.id, productId, opts.keyword, since]
          : [identity.id, productId, since];
        const rows = db.prepare(sql).all(...params) as any[];
        // 按 (keyword, language, storefront) 分组，每 key 保留最近 maxPerKey 条
        const byKey = new Map<string, any[]>();
        for (const r of rows) {
          const key = `${r.keyword}\u0000${r.language}\u0000${r.storefront}`;
          let list = byKey.get(key);
          if (!list) {
            list = [];
            byKey.set(key, list);
          }
          list.push(r);
        }
        const out: any[] = [];
        for (const list of byKey.values()) {
          out.push(...list.slice(-maxPerKey));
        }
        return out.sort(
          (a, b) =>
            new Date(a.checkedAt).getTime() - new Date(b.checkedAt).getTime() ||
            (a.id as number) - (b.id as number),
        ).map(stripId);
      },
    },

    tasks: {
      advance(row, target, at) {
        if (row.schedule?.origin !== 'automatic' || row.schedule.balancedAt || !row.nextRunAt ||
            !(Date.parse(target) < Date.parse(row.nextRunAt))) return false;
        const schedule = { ...row.schedule, balancedAt: at };
        return tx(() => Number(db.prepare(`UPDATE tasks SET nextRunAt = ?, scheduleJson = ?
          WHERE id = ? AND nextRunAt = ? AND scheduleJson = ? AND enabled = 1
          AND intervalMinutes = ? AND lastRunAt IS ? AND lastStatus = ?`).run(
            target, JSON.stringify(schedule), row.id, row.nextRunAt, JSON.stringify(row.schedule),
            row.intervalMinutes, row.lastRunAt, row.lastStatus,
          ).changes) === 1);
      },
      upsert(row, opts = {}) {
        tx(() => {
          const setIdentity = opts.setIdentity === true;
          const previous = db.prepare('SELECT * FROM tasks WHERE id = ?').get(row.id) as any;
          // Explicit scheduling writers set provenance. Generic edits that change
          // due time/interval invalidate it; spreading a stale TaskRow cannot restore it.
          const scheduleJson = opts.schedule !== undefined
            ? (opts.schedule ? JSON.stringify(opts.schedule) : null)
            : previous && previous.nextRunAt === row.nextRunAt && previous.intervalMinutes === row.intervalMinutes
              ? previous.scheduleJson : null;
          db.prepare(
            `INSERT INTO tasks (id, title, intervalMinutes, lastRunAt, nextRunAt, lastStatus, lastSummary, runCount, source, kind, instance, enabled, electronJson, scheduleJson)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               title = excluded.title,
               intervalMinutes = excluded.intervalMinutes,
               lastRunAt = excluded.lastRunAt,
               nextRunAt = excluded.nextRunAt,
               lastStatus = excluded.lastStatus,
               lastSummary = excluded.lastSummary,
               runCount = excluded.runCount,
               enabled = excluded.enabled,
               electronJson = excluded.electronJson,
               scheduleJson = excluded.scheduleJson
               ${setIdentity ? ", source = excluded.source, kind = excluded.kind, instance = excluded.instance" : ""}`,
          ).run(
            row.id,
            row.title,
            row.intervalMinutes,
            row.lastRunAt,
            row.nextRunAt,
            row.lastStatus,
            row.lastSummary,
            row.runCount,
            row.source ?? 'dsh',
            row.kind ?? null,
            row.instance ? JSON.stringify(row.instance) : null,
            row.enabled === false ? 0 : 1,
            row.electronJson ?? null,
            scheduleJson,
          );
        });
      },
      all() {
        const rows = db.prepare('SELECT * FROM tasks ORDER BY id').all() as any[];
        return rows.map(parseTaskRow);
      },
      get(id) {
        const r = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any;
        return r ? parseTaskRow(r) : undefined;
      },
      remove(id) {
        const res = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
        return Number(res.changes) > 0;
      },
    },

    lease: {
      acquire(leaderId, ttlMs) {
        return tx(() => {
          const existing = db.prepare('SELECT * FROM lease WHERE id = 1').get() as any;
          const now = Date.now();
          if (existing) {
            const heartbeat = new Date(existing.heartbeatAt).getTime();
            const fresh = now - heartbeat < ttlMs;
            if (existing.leaderId === leaderId) {
              // 同 id：心跳新鲜 = 已有**同 id 活主**（如双 daemon 并存）→ 拒绝，
              // 防第二个同 id 进程把活主心跳当"自己续租"而并跑（2026-09-04 事故）。
              // 心跳过期（同 id 主崩溃）→ 允许接管。
              if (fresh) return false;
            } else if (fresh) {
              return false; // 还有活主（异 id）
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
      release(leaderId) {
        return tx(() => {
          const existing = db.prepare('SELECT leaderId FROM lease WHERE id = 1').get() as any;
          if (!existing || existing.leaderId !== leaderId) return false;
          db.prepare('DELETE FROM lease WHERE id = 1').run();
          return true;
        });
      },
    },

    meta: {
      save(row) {
        tx(() => {
          const identity = row.projectId
            ? requireProjectIdentity(row.projectId)
            : requireProjectIdentity(row.projectName);
          db.prepare(
            `INSERT INTO project_meta (projectId, githubUrl, headSha, headDate, lastReleaseSha, branch, headMessage, dirty, description, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(projectId) DO UPDATE SET
               githubUrl = excluded.githubUrl,
               headSha = excluded.headSha,
               headDate = excluded.headDate,
               lastReleaseSha = excluded.lastReleaseSha,
               branch = excluded.branch,
               headMessage = excluded.headMessage,
               dirty = excluded.dirty,
               description = excluded.description,
               updatedAt = excluded.updatedAt`,
          ).run(
            identity.id,
            row.githubUrl,
            row.headSha,
            row.headDate,
            row.lastReleaseSha,
            row.branch ?? null,
            row.headMessage ?? null,
            row.dirty === true ? 1 : 0,
            row.description ?? null,
            row.updatedAt,
          );
        });
      },
      get(projectName) {
        const identity = projectIdentity(projectName);
        if (!identity) return undefined;
        const r = db.prepare('SELECT * FROM project_meta WHERE projectId = ?').get(identity.id) as any;
        if (!r) return undefined;
        return {
          projectName: identity.name,
          projectId: identity.id,
          githubUrl: r.githubUrl,
          headSha: r.headSha,
          headDate: r.headDate,
          lastReleaseSha: r.lastReleaseSha,
          branch: r.branch ?? null,
          headMessage: r.headMessage ?? null,
          dirty: r.dirty == null ? null : Number(r.dirty) === 1,
          description: r.description ?? null,
          updatedAt: r.updatedAt,
        };
      },
    },

    products: {
      upsert(row) {
        tx(() => {
          const identity = row.projectId
            ? requireProjectIdentity(row.projectId)
            : requireProjectIdentity(row.projectName);
          db.prepare(
            `INSERT INTO product_records (projectId, productId, platform, trackId, bundleId, trackName, artworkUrl, supportedLanguages, trackedKeywords, storeLinks, submissionKeywords, removedKeywords, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(projectId, productId) DO UPDATE SET
               platform = excluded.platform,
               trackId = excluded.trackId,
               bundleId = excluded.bundleId,
               trackName = excluded.trackName,
               artworkUrl = excluded.artworkUrl,
               supportedLanguages = excluded.supportedLanguages,
               trackedKeywords = excluded.trackedKeywords,
               storeLinks = excluded.storeLinks,
               submissionKeywords = excluded.submissionKeywords,
               removedKeywords = excluded.removedKeywords,
               updatedAt = excluded.updatedAt`,
          ).run(
            identity.id,
            row.productId,
            row.platform,
            row.trackId,
            row.bundleId,
            row.trackName,
            row.artworkUrl,
            JSON.stringify(row.supportedLanguages),
            JSON.stringify(row.trackedKeywords),
            JSON.stringify(row.storeLinks),
            JSON.stringify(row.submissionKeywords ?? []),
            JSON.stringify(row.removedKeywords ?? []),
            row.updatedAt,
          );
        });
      },
      listByProject(projectName) {
        const identity = projectIdentity(projectName);
        if (!identity) return [];
        const rows = db
          .prepare('SELECT * FROM product_records WHERE projectId = ? ORDER BY productId')
          .all(identity.id) as any[];
        return rows.map((r) => ({
          projectName: identity.name,
          projectId: identity.id,
          productId: r.productId,
          platform: r.platform,
          trackId: r.trackId,
          bundleId: r.bundleId,
          trackName: r.trackName,
          artworkUrl: r.artworkUrl,
          supportedLanguages: parseJsonArray(r.supportedLanguages),
          trackedKeywords: parseJsonArray(r.trackedKeywords),
          storeLinks: parseJsonArray(r.storeLinks),
          submissionKeywords: parseJsonArray(r.submissionKeywords),
          removedKeywords: parseJsonArray(r.removedKeywords),
          updatedAt: r.updatedAt,
        }));
      },
    },

    releaseCache: {
      save(projectName, cache, syncedAt) {
        tx(() => {
          const identity = requireProjectIdentity(projectName);
          db.prepare(
            `INSERT INTO project_release_cache (projectId, cacheJson, syncedAt)
             VALUES (?, ?, ?)
             ON CONFLICT(projectId) DO UPDATE SET
               cacheJson = excluded.cacheJson,
               syncedAt = excluded.syncedAt`,
          ).run(identity.id, JSON.stringify(cache ?? {}), syncedAt ?? new Date().toISOString());
        });
      },
      get(projectName) {
        const identity = projectIdentity(projectName);
        if (!identity) return undefined;
        const r = db
          .prepare('SELECT * FROM project_release_cache WHERE projectId = ?')
          .get(identity.id) as any;
        if (!r) return undefined;
        let cache: Record<string, unknown> = {};
        try {
          cache = JSON.parse(r.cacheJson);
        } catch {
          cache = {};
        }
        return { projectName: identity.name, projectId: identity.id, cache, syncedAt: r.syncedAt };
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
    projectId: r.projectId,
    productId: r.productId ?? null,
    keyword: r.keyword,
    language: r.language,
    storefront: r.storefront,
    rank: r.rank,
    totalResults: r.totalResults,
    checkedAt: r.checkedAt,
  };
}

/** 任务行解析：instance JSON 列 → 对象；kind 空串 → null。 */
function parseJsonArray(raw: unknown): any[] {
  try {
    const v = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function parseTaskRow(r: any): TaskRow {
  let instance: Record<string, unknown> | null = null;
  if (typeof r.instance === 'string' && r.instance) {
    try {
      instance = JSON.parse(r.instance);
    } catch {
      instance = null;
    }
  }
  return {
    schedule: parseSchedule(r.scheduleJson),
    id: r.id,
    title: r.title,
    intervalMinutes: r.intervalMinutes,
    lastRunAt: r.lastRunAt,
    nextRunAt: r.nextRunAt,
    lastStatus: r.lastStatus,
    lastSummary: r.lastSummary,
    runCount: r.runCount,
    source: r.source ?? 'dsh',
    kind: r.kind || null,
    instance,
    enabled: r.enabled === undefined ? undefined : Number(r.enabled) === 1,
    electronJson: typeof r.electronJson === 'string' ? r.electronJson : null,
  };
}

function parseSchedule(raw: unknown): TaskSchedule | null {
  try {
    const s = JSON.parse(String(raw));
    return s && ['automatic', 'manual', 'retry'].includes(s.origin) && Number.isFinite(Date.parse(s.originalDueAt)) &&
      (s.balancedAt === null || Number.isFinite(Date.parse(s.balancedAt))) ? s : null;
  } catch { return null; }
}
