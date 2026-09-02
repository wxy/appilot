/**
 * Appilot headless 数据模型与 SQLite Schema。
 *
 * 设计要点：
 * - 单一 SQLite 数据库文件（node:sqlite DatabaseSync + WAL），多进程（Electron /
 *   DSH / CLI）可同时打开同一文件：WAL 允许多读一写，busy_timeout 处理写竞争；
 * - 行类型即对外契约（Electron 壳 / DSH 壳 / MCP / CLI 共用同一套类型）；
 * - schema 版本号 + 迁移钩子：后续加表/加列走 migrations，而不是推倒重建。
 */

export const SCHEMA_VERSION = 3;

/** 项目注册表行（与旧 registry.json 记录对齐，新增 updatedAt/artworkUrl）。 */
export interface ProjectRow {
  name: string;
  path: string;
  githubUrl: string | null;
  platform: string | null;
  languages: string[];
  lastResolvedAt: string;
  artworkUrl: string | null;
  updatedAt: string;
}

/** 排名快照行（keyword×language×storefront 历史点）。productId 供多产品（Electron）区分。 */
export interface RankSnapshotRow {
  projectName: string;
  /** 产品维度（Electron 的 product.id）；DSH 侧为 null。 */
  productId?: string | null;
  keyword: string;
  language: string;
  storefront: string;
  rank: number | null;
  totalResults: number;
  checkedAt: string;
}

/**
 * 定时任务状态行（Phase 3 调度器使用）。
 * source：任务来源——'dsh'（共享静态任务 buildHeadlessJobs）/ 'electron'（Electron
 * 动态任务镜像）/ 'cli'（显式触发）；用于镜像清理与展示过滤。
 */
export interface TaskRow {
  id: string;
  title: string;
  intervalMinutes: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: 'never' | 'ok' | 'error';
  lastSummary: string | null;
  runCount: number;
  source?: 'dsh' | 'electron' | 'cli' | string;
}

/** 调度租约行（Phase 3：多壳同时打开时仅主进程调度）。 */
export interface LeaseRow {
  leaderId: string;
  heartbeatAt: string;
}

export const DDL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  name TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  githubUrl TEXT,
  platform TEXT,
  languages TEXT NOT NULL DEFAULT '[]',
  lastResolvedAt TEXT NOT NULL,
  artworkUrl TEXT,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rank_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  projectName TEXT NOT NULL,
  productId TEXT,
  keyword TEXT NOT NULL,
  language TEXT NOT NULL,
  storefront TEXT NOT NULL,
  rank INTEGER,
  totalResults INTEGER NOT NULL DEFAULT 0,
  checkedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rank_snapshots_project
  ON rank_snapshots(projectName, keyword, language, storefront, checkedAt);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  intervalMinutes INTEGER NOT NULL,
  lastRunAt TEXT,
  nextRunAt TEXT,
  lastStatus TEXT NOT NULL DEFAULT 'never',
  lastSummary TEXT,
  runCount INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'dsh'
);

CREATE TABLE IF NOT EXISTS lease (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  leaderId TEXT NOT NULL,
  heartbeatAt TEXT NOT NULL
);
`;

/** 逐版本迁移：v1→v2 为 rank_snapshots 增加 productId 列。 */
export function migrate(db: {
  exec(sql: string): void;
  prepare(sql: string): { get(...p: unknown[]): { value?: unknown } | undefined; run(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
}): void {
  db.exec(DDL);
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('schemaVersion') as
    | { value?: unknown }
    | undefined;
  const ver = row && row.value !== undefined ? Number(row.value) : 0;
  if (ver < 1) {
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('schemaVersion', '1');
  }
  if (ver < 2) {
    // v1→v2：rank_snapshots 加 productId（幂等：列已存在则跳过）
    const cols = (db.prepare('PRAGMA table_info(rank_snapshots)').all() as Array<{ name: string }>) || [];
    if (!cols.some((c) => c.name === 'productId')) {
      db.exec('ALTER TABLE rank_snapshots ADD COLUMN productId TEXT');
    }
    db.prepare("INSERT INTO meta (key, value) VALUES ('schemaVersion', '2') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  }
  if (ver < 3) {
    // v2→v3：tasks 加 source（任务来源：dsh/electron/cli；镜像清理与展示过滤用）
    const cols = (db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>) || [];
    if (!cols.some((c) => c.name === 'source')) {
      db.exec("ALTER TABLE tasks ADD COLUMN source TEXT NOT NULL DEFAULT 'dsh'");
    }
    db.prepare("INSERT INTO meta (key, value) VALUES ('schemaVersion', '3') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  }
}
