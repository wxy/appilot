/**
 * Appilot headless 数据模型与 SQLite Schema。
 *
 * 设计要点：
 * - 单一 SQLite 数据库文件（node:sqlite DatabaseSync + WAL），多进程（Electron /
 *   DSH / CLI）可同时打开同一文件：WAL 允许多读一写，busy_timeout 处理写竞争；
 * - 行类型即对外契约（Electron 壳 / DSH 壳 / MCP / CLI 共用同一套类型）；
 * - schema 版本号 + 迁移钩子：后续加表/加列走 migrations，而不是推倒重建。
 */

import { randomUUID } from 'node:crypto';

export const SCHEMA_VERSION = 15;

/** 项目注册表行（与旧 registry.json 记录对齐，新增 updatedAt/artworkUrl）。 */
export interface ProjectRow {
  name: string;
  /** electron project id（v8 起同步；DSH 侧可为 null）。 */
  id?: string | null;
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
  /** v14 内部外键；公共调用仍可用 projectName，读出时两者都提供。 */
  projectId?: string;
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
 * 定时任务状态行（Phase 3 调度器使用；v4 起支持实例任务）。
 * source：任务来源——'dsh' / 'electron' / 'cli'；用于镜像清理与展示过滤。
 * kind + instance：v4 实例任务——kind 是核心任务类型（如 'github-sync'），
 * instance 是该实例的参数（JSON，如 { projectName, path }）。静态任务（job
 * 数组驱动）无 kind；实例任务由 executors（按 kind 分发的核心执行器）执行，
 * 使 Electron / DSH 的任务收敛为同一 DB 实例 + 同一核心执行器。
 */
export interface TaskSchedule {
  origin: 'automatic' | 'manual' | 'retry';
  originalDueAt: string;
  balancedAt: string | null;
}

export interface TaskRow {
  /** Absent metadata means unknown provenance and must never be balanced. */
  schedule?: TaskSchedule | null;
  id: string;
  title: string;
  intervalMinutes: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: 'never' | 'ok' | 'error';
  lastSummary: string | null;
  runCount: number;
  source?: 'dsh' | 'electron' | 'cli' | string;
  /** v4：核心任务类型（实例任务用；静态任务无）。 */
  kind?: string | null;
  /** v4：实例参数（JSON 列；静态任务无）。 */
  instance?: Record<string, unknown> | null;
  /** v12：electron 镜像是否启用（false = 标题带“已停用”）。 */
  enabled?: boolean;
  /** v12：electron 原始任务 JSON（无损重建引擎任务用；非 electron 行为空）。 */
  electronJson?: string | null;
}

/** 调度租约行（Phase 3：多壳同时打开时仅主进程调度）。 */
export interface LeaseRow {
  leaderId: string;
  heartbeatAt: string;
}

/**
 * 项目富数据行（v5）：repo 状态（供 github-sync 边界、UI 状态展示）。
 * Electron hydrate 双写；DSH 注册时仅写基本字段。
 */
export interface ProjectMetaRow {
  projectName: string;
  projectId?: string;
  githubUrl: string | null;
  /** 当前 HEAD sha（Electron repo 状态；DSH 可能为 null）。 */
  headSha: string | null;
  headDate: string | null;
  /** github-sync 的 lastSeenSha 边界（checkForRelease 用）。 */
  lastReleaseSha: string | null;
  /** v13：repo 展示字段（branch/HEAD message/dirty/description，写切(2) 后 UI 依赖）。 */
  branch?: string | null;
  headMessage?: string | null;
  dirty?: boolean | null;
  description?: string | null;
  updatedAt: string;
}

/**
 * 产品注册行（v5）：Electron 富数据的产品维度（platform/trackId/关键词池等），
 * rank 等富数据任务实例化与 UI 读取的前提。productId 与 rank_snapshots 对齐。
 */
export interface ProductRecordRow {
  projectName: string;
  projectId?: string;
  /** Electron product.id（如 'projId:macos'）；DSH 侧无产品时可为项目名。 */
  productId: string;
  platform: string | null;
  trackId: number | null;
  bundleId: string | null;
  trackName: string | null;
  artworkUrl: string | null;
  supportedLanguages: string[];
  /** Electron trackedKeywords 池（对象数组 JSON 保留）。 */
  trackedKeywords: unknown[];
  /** Electron storeLinks（平台链接 JSON 保留）。 */
  storeLinks: unknown[];
  /** Electron 富数据扩展（v8）：submissionKeywords / removedKeywords（对象数组 JSON 保留）。 */
  submissionKeywords?: unknown[];
  removedKeywords?: unknown[];
  updatedAt: string;
}

/**
 * 发布页数据缓存行（v6）：Electron githubSyncCache 条目（release material /
 * Pull Requests / repo capabilities / releases），UI 数据源迁出 electron-store
 * 的前提（M4-A 双写；迁移完成前 UI 仍读 electron-store）。
 */
export interface ReleaseCacheRow {
  projectName: string;
  projectId?: string;
  /** githubSyncCache[projectId] 条目对象（JSON 原样保留，结构随壳变化）。 */
  cache: Record<string, unknown>;
  syncedAt: string;
}

export const DDL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rank_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  taskId TEXT,
  status TEXT,
  durationMs INTEGER,
  entryJson TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rank_executions_ts ON rank_executions(ts);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rank_executions_uniq ON rank_executions(ts, taskId);

CREATE TABLE IF NOT EXISTS project_blobs (
  domain TEXT NOT NULL,
  projectKey TEXT NOT NULL,
  json TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (domain, projectKey)
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  path TEXT NOT NULL,
  githubUrl TEXT,
  platform TEXT,
  languages TEXT NOT NULL DEFAULT '[]',
  lastResolvedAt TEXT NOT NULL,
  artworkUrl TEXT,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_meta (
  projectId TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  githubUrl TEXT,
  headSha TEXT,
  headDate TEXT,
  lastReleaseSha TEXT,
  branch TEXT,
  headMessage TEXT,
  dirty INTEGER,
  description TEXT,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_records (
  projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  productId TEXT NOT NULL,
  platform TEXT,
  trackId INTEGER,
  bundleId TEXT,
  trackName TEXT,
  artworkUrl TEXT,
  supportedLanguages TEXT NOT NULL DEFAULT '[]',
  trackedKeywords TEXT NOT NULL DEFAULT '[]',
  storeLinks TEXT NOT NULL DEFAULT '[]',
  submissionKeywords TEXT NOT NULL DEFAULT '[]',
  removedKeywords TEXT NOT NULL DEFAULT '[]',
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (projectId, productId)
);

CREATE TABLE IF NOT EXISTS rank_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  productId TEXT,
  keyword TEXT NOT NULL,
  language TEXT NOT NULL,
  storefront TEXT NOT NULL,
  rank INTEGER,
  totalResults INTEGER NOT NULL DEFAULT 0,
  checkedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_release_cache (
  projectId TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  cacheJson TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  intervalMinutes INTEGER NOT NULL,
  lastRunAt TEXT,
  nextRunAt TEXT,
  lastStatus TEXT NOT NULL DEFAULT 'never',
  lastSummary TEXT,
  runCount INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'dsh',
  kind TEXT,
  instance TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  electronJson TEXT,
  scheduleJson TEXT
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
  const initialProjectCols = (db.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string; pk?: number }>) || [];
  const alreadyUsesIdPrimaryKey = initialProjectCols.some((c) => c.name === 'id' && Number(c.pk) === 1);
  // 全新数据库由上面的最终 DDL 一次建成；不要再回放只适用于旧列名的历史迁移。
  if (!row && alreadyUsesIdPrimaryKey) {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_product_records_project ON product_records(projectId);
      CREATE INDEX IF NOT EXISTS idx_rank_snapshots_project
        ON rank_snapshots(projectId, keyword, language, storefront, checkedAt);`);
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('schemaVersion', String(SCHEMA_VERSION));
    return;
  }
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
  if (ver < 4) {
    // v3→v4：tasks 加 kind/instance（实例任务：类型 + 参数 JSON；两壳任务统一）
    const cols = (db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>) || [];
    if (!cols.some((c) => c.name === 'kind')) {
      db.exec('ALTER TABLE tasks ADD COLUMN kind TEXT');
    }
    if (!cols.some((c) => c.name === 'instance')) {
      db.exec('ALTER TABLE tasks ADD COLUMN instance TEXT');
    }
    db.prepare("INSERT INTO meta (key, value) VALUES ('schemaVersion', '4') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  }
  if (ver < 5) {
    // v4→v5：新增 project_meta / product_records（富数据：repo 状态 + 产品注册）
    db.exec(`CREATE TABLE IF NOT EXISTS project_meta (
      projectName TEXT PRIMARY KEY,
      githubUrl TEXT,
      headSha TEXT,
      headDate TEXT,
      lastReleaseSha TEXT,
      updatedAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS product_records (
      projectName TEXT NOT NULL,
      productId TEXT NOT NULL,
      platform TEXT,
      trackId INTEGER,
      bundleId TEXT,
      trackName TEXT,
      artworkUrl TEXT,
      supportedLanguages TEXT NOT NULL DEFAULT '[]',
      trackedKeywords TEXT NOT NULL DEFAULT '[]',
      storeLinks TEXT NOT NULL DEFAULT '[]',
      updatedAt TEXT NOT NULL,
      PRIMARY KEY (projectName, productId));`);
    const productCols5 = (db.prepare('PRAGMA table_info(product_records)').all() as Array<{ name: string }>) || [];
    db.exec(
      productCols5.some((c) => c.name === 'projectId')
        ? 'CREATE INDEX IF NOT EXISTS idx_product_records_project ON product_records(projectId)'
        : 'CREATE INDEX IF NOT EXISTS idx_product_records_project ON product_records(projectName)',
    );
    db.prepare("INSERT INTO meta (key, value) VALUES ('schemaVersion', '5') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  }
  if (ver < 6) {
    // v5→v6：发布页数据缓存入 DB（githubSyncCache：release material/PR/capabilities）。
    // Electron 发布页 UI 数据源的迁出前提（M4-A）；UI 仍读 electron-store 期间双写。
    db.exec(`CREATE TABLE IF NOT EXISTS project_release_cache (
      projectName TEXT PRIMARY KEY,
      cacheJson TEXT NOT NULL,
      syncedAt TEXT NOT NULL);`);
    db.prepare("INSERT INTO meta (key, value) VALUES ('schemaVersion', '6') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  }
  if (ver < 7) {
    // v6→v7：新增 app_kv 通用键值表（electron-store config.json 整体迁入 SQLite
    // 的落地表；键名保持原 getStore() 键名，值为 JSON 文本）。迁移期向后兼容，
    // 由 Electron 主进程在启动时一次性导入旧 config.json 后退役该文件。
    db.exec(`CREATE TABLE IF NOT EXISTS app_kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updatedAt TEXT NOT NULL);`);
    db.prepare("INSERT INTO meta (key, value) VALUES ('schemaVersion', '7') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  }
  if (ver < 8) {
    // v7→v8：阶段二双写补齐——注册表 projects 加 electron id 列；
    // product_records 加 submissionKeywords/removedKeywords（electron 富数据扩展，DSH 忽略）。
    const cols8 = (db.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string }>) || [];
    if (!cols8.some((c) => c.name === 'id')) {
      db.exec('ALTER TABLE projects ADD COLUMN id TEXT');
    }
    const pcols = (db.prepare('PRAGMA table_info(product_records)').all() as Array<{ name: string }>) || [];
    if (!pcols.some((c) => c.name === 'submissionKeywords')) {
      db.exec("ALTER TABLE product_records ADD COLUMN submissionKeywords TEXT NOT NULL DEFAULT '[]'");
    }
    if (!pcols.some((c) => c.name === 'removedKeywords')) {
      db.exec("ALTER TABLE product_records ADD COLUMN removedKeywords TEXT NOT NULL DEFAULT '[]'");
    }
    db.prepare("INSERT INTO meta (key, value) VALUES ('schemaVersion', '8') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  }
  if (ver < 9) {
    // v8→v9：rank 执行记录入表（electron kv rankExecutions 的结构化落点，双写期
    // 读仍走 kv；schema 便于按 ts 窗口查询统计）。
    db.exec(`CREATE TABLE IF NOT EXISTS rank_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      taskId TEXT,
      status TEXT,
      durationMs INTEGER,
      entryJson TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_rank_executions_ts ON rank_executions(ts);`);
    db.prepare("INSERT INTO meta (key, value) VALUES ('schemaVersion', '9') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  }
  if (ver < 10) {
    // v9→v10：rank_executions 增加 (ts, taskId) 唯一约束（一次性导入幂等用）。
    // 若历史已存在重复键，先清理再建索引（正常路径无重复）。
    const dup = (db.prepare(
      'SELECT ts, taskId, COUNT(*) c FROM rank_executions GROUP BY ts, taskId HAVING c > 1 LIMIT 1',
    ).get() as { c?: number } | undefined);
    if (dup) {
      db.exec(`DELETE FROM rank_executions WHERE id NOT IN (
        SELECT MIN(id) FROM rank_executions GROUP BY ts, taskId)`);
    }
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_rank_executions_uniq ON rank_executions(ts, taskId)');
    db.prepare("INSERT INTO meta (key, value) VALUES ('schemaVersion', '10') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  }
  if (ver < 11) {
    // v10→v11：通用 per-key JSON 表（竞品/ascCache/trafficSnapshots/opsStatus 等
    // kv 的 Record<项目id, 数据> 结构化落点；双写期读仍走 kv）。
    db.exec(`CREATE TABLE IF NOT EXISTS project_blobs (
      domain TEXT NOT NULL,
      projectKey TEXT NOT NULL,
      json TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      PRIMARY KEY (domain, projectKey));`);
    db.prepare("INSERT INTO meta (key, value) VALUES ('schemaVersion', '11') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  }
  if (ver < 12) {
    // v11→v12：tasks 增加 electron 无损镜像列（enabled / electronJson）。
    const tcols = (db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>) || [];
    if (!tcols.some((c) => c.name === 'enabled')) {
      db.exec("ALTER TABLE tasks ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1");
    }
    if (!tcols.some((c) => c.name === 'electronJson')) {
      db.exec('ALTER TABLE tasks ADD COLUMN electronJson TEXT');
    }
    db.prepare("INSERT INTO meta (key, value) VALUES ('schemaVersion', '12') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  }
  if (ver < 13) {
    // v12→v13：project_meta 增加 repo 展示字段（branch/headMessage/dirty/description）。
    const mcols = (db.prepare('PRAGMA table_info(project_meta)').all() as Array<{ name: string }>) || [];
    for (const [col, decl] of [['branch','TEXT'],['headMessage','TEXT'],['dirty','INTEGER'],['description','TEXT']]) {
      if (!mcols.some((c) => c.name === col)) db.exec(`ALTER TABLE project_meta ADD COLUMN ${col} ${decl}`);
    }
    db.prepare("INSERT INTO meta (key, value) VALUES ('schemaVersion', '13') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  }
  if (ver < 14) {
    const projectCols = (db.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string; pk?: number }>) || [];
    const idIsPrimaryKey = projectCols.some((c) => c.name === 'id' && Number(c.pk) === 1);
    if (!idIsPrimaryKey) {
      // v13→v14：项目身份从可变 name 切到稳定 id。所有复制、任务改写与换表在
      // 同一事务内完成；任一步失败都会保留完整 v13 数据。
      db.exec('PRAGMA foreign_keys = OFF');
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec(`
          CREATE TABLE projects_v14 (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            path TEXT NOT NULL,
            githubUrl TEXT,
            platform TEXT,
            languages TEXT NOT NULL DEFAULT '[]',
            lastResolvedAt TEXT NOT NULL,
            artworkUrl TEXT,
            updatedAt TEXT NOT NULL);
          CREATE TEMP TABLE project_id_map (name TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE);
        `);
        const oldProjects = db.prepare('SELECT * FROM projects ORDER BY name').all() as Array<Record<string, unknown>>;
        const usedIds = new Set<string>();
        const idByName = new Map<string, string>();
        const mapInsert = db.prepare('INSERT INTO project_id_map (name, id) VALUES (?, ?)');
        const projectInsert = db.prepare(
          `INSERT INTO projects_v14
           (id, name, path, githubUrl, platform, languages, lastResolvedAt, artworkUrl, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const project of oldProjects) {
          const name = String(project.name ?? '');
          const legacyId = typeof project.id === 'string' ? project.id.trim() : '';
          let id = legacyId && !usedIds.has(legacyId) ? legacyId : `legacy-${randomUUID()}`;
          while (usedIds.has(id)) id = `legacy-${randomUUID()}`;
          usedIds.add(id);
          idByName.set(name, id);
          mapInsert.run(name, id);
          projectInsert.run(
            id, name, project.path, project.githubUrl, project.platform, project.languages,
            project.lastResolvedAt, project.artworkUrl, project.updatedAt,
          );
        }

        db.exec(`
          CREATE TABLE project_meta_v14 (
            projectId TEXT PRIMARY KEY REFERENCES projects_v14(id) ON DELETE CASCADE,
            githubUrl TEXT, headSha TEXT, headDate TEXT, lastReleaseSha TEXT,
            branch TEXT, headMessage TEXT, dirty INTEGER, description TEXT, updatedAt TEXT NOT NULL);

          CREATE TABLE product_records_v14 (
            projectId TEXT NOT NULL REFERENCES projects_v14(id) ON DELETE CASCADE,
            productId TEXT NOT NULL, platform TEXT, trackId INTEGER, bundleId TEXT,
            trackName TEXT, artworkUrl TEXT, supportedLanguages TEXT NOT NULL DEFAULT '[]',
            trackedKeywords TEXT NOT NULL DEFAULT '[]', storeLinks TEXT NOT NULL DEFAULT '[]',
            submissionKeywords TEXT NOT NULL DEFAULT '[]', removedKeywords TEXT NOT NULL DEFAULT '[]',
            updatedAt TEXT NOT NULL, PRIMARY KEY (projectId, productId));

          CREATE TABLE rank_snapshots_v14 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            projectId TEXT NOT NULL REFERENCES projects_v14(id) ON DELETE CASCADE,
            productId TEXT, keyword TEXT NOT NULL, language TEXT NOT NULL,
            storefront TEXT NOT NULL, rank INTEGER, totalResults INTEGER NOT NULL DEFAULT 0,
            checkedAt TEXT NOT NULL);

          CREATE TABLE project_release_cache_v14 (
            projectId TEXT PRIMARY KEY REFERENCES projects_v14(id) ON DELETE CASCADE,
            cacheJson TEXT NOT NULL, syncedAt TEXT NOT NULL);
        `);
        // 历史测试库可能跳过部分版本，导致 DDL 新建的表已是 projectId，而存量表仍是
        // projectName。逐表探测关联列，使任意 v1-v13 组合都能安全收敛到 v14。
        const projectJoin = (table: string): string => {
          const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
          return cols.some((col) => col.name === 'projectId')
            ? 'JOIN project_id_map m ON m.id = x.projectId'
            : 'JOIN project_id_map m ON m.name = x.projectName';
        };
        db.exec(`INSERT INTO project_meta_v14
          SELECT m.id, x.githubUrl, x.headSha, x.headDate, x.lastReleaseSha,
                 x.branch, x.headMessage, x.dirty, x.description, x.updatedAt
          FROM project_meta x ${projectJoin('project_meta')};`);
        db.exec(`INSERT INTO product_records_v14
          SELECT m.id, x.productId, x.platform, x.trackId, x.bundleId, x.trackName,
                 x.artworkUrl, x.supportedLanguages, x.trackedKeywords, x.storeLinks,
                 x.submissionKeywords, x.removedKeywords, x.updatedAt
          FROM product_records x ${projectJoin('product_records')};`);
        db.exec(`INSERT INTO rank_snapshots_v14
          SELECT x.id, m.id, x.productId, x.keyword, x.language, x.storefront,
                 x.rank, x.totalResults, x.checkedAt
          FROM rank_snapshots x ${projectJoin('rank_snapshots')};`);
        db.exec(`INSERT INTO project_release_cache_v14
          SELECT m.id, x.cacheJson, x.syncedAt
          FROM project_release_cache x ${projectJoin('project_release_cache')};`);

        // 草稿域此前是唯一仍以项目名作 projectKey 的 blob 域。
        const draftRows = db.prepare(
          "SELECT projectKey, json, updatedAt FROM project_blobs WHERE domain = 'storeSubmissionDrafts'",
        ).all() as Array<{ projectKey: string; json: string; updatedAt: string }>;
        const draftPut = db.prepare(
          `INSERT OR REPLACE INTO project_blobs (domain, projectKey, json, updatedAt)
           VALUES ('storeSubmissionDrafts', ?, ?, ?)`,
        );
        const draftDelete = db.prepare(
          "DELETE FROM project_blobs WHERE domain = 'storeSubmissionDrafts' AND projectKey = ?",
        );
        for (const draft of draftRows) {
          const projectId = idByName.get(draft.projectKey);
          if (!projectId || projectId === draft.projectKey) continue;
          draftPut.run(projectId, draft.json, draft.updatedAt);
          draftDelete.run(draft.projectKey);
        }

        // 名称型 github-sync 实例迁到稳定 projectId；保留 projectName 仅作显示。
        const taskRows = db.prepare("SELECT * FROM tasks WHERE kind = 'github-sync'").all() as Array<Record<string, unknown>>;
        for (const task of taskRows) {
          let instance: Record<string, unknown> = {};
          try {
            instance = task.instance ? JSON.parse(String(task.instance)) : {};
          } catch {
            instance = {};
          }
          const oldSuffix = String(task.id ?? '').startsWith('github-sync:')
            ? String(task.id).slice('github-sync:'.length)
            : '';
          const name = typeof instance.projectName === 'string' ? instance.projectName : oldSuffix;
          const projectId =
            (typeof instance.projectId === 'string' && usedIds.has(instance.projectId) ? instance.projectId : null) ??
            idByName.get(name);
          if (!projectId) continue;
          const newId = `github-sync:${projectId}`;
          instance.projectId = projectId;
          if (!instance.projectName) instance.projectName = name;
          let electronJson = task.electronJson == null ? null : String(task.electronJson);
          if (electronJson) {
            try {
              const parsed = JSON.parse(electronJson);
              parsed.id = newId;
              parsed.projectId = projectId;
              electronJson = JSON.stringify(parsed);
            } catch {
              // 诊断副本损坏不阻断结构迁移。
            }
          }
          if (newId !== task.id && db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(newId)) {
            db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
            db.prepare('UPDATE tasks SET instance = ?, electronJson = ? WHERE id = ?')
              .run(JSON.stringify(instance), electronJson, newId);
          } else {
            db.prepare('UPDATE tasks SET id = ?, instance = ?, electronJson = ? WHERE id = ?')
              .run(newId, JSON.stringify(instance), electronJson, task.id);
          }
        }

        db.exec(`
          DROP TABLE project_meta;
          DROP TABLE product_records;
          DROP TABLE rank_snapshots;
          DROP TABLE project_release_cache;
          DROP TABLE projects;
          ALTER TABLE projects_v14 RENAME TO projects;
          ALTER TABLE project_meta_v14 RENAME TO project_meta;
          ALTER TABLE product_records_v14 RENAME TO product_records;
          ALTER TABLE rank_snapshots_v14 RENAME TO rank_snapshots;
          ALTER TABLE project_release_cache_v14 RENAME TO project_release_cache;
          CREATE INDEX idx_product_records_project ON product_records(projectId);
          CREATE INDEX idx_rank_snapshots_project
            ON rank_snapshots(projectId, keyword, language, storefront, checkedAt);
          DROP TABLE project_id_map;
        `);
        db.prepare("INSERT INTO meta (key, value) VALUES ('schemaVersion', '14') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      } finally {
        db.exec('PRAGMA foreign_keys = ON');
      }
    } else {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_product_records_project ON product_records(projectId);
        CREATE INDEX IF NOT EXISTS idx_rank_snapshots_project
          ON rank_snapshots(projectId, keyword, language, storefront, checkedAt);`);
      db.prepare("INSERT INTO meta (key, value) VALUES ('schemaVersion', '14') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    }
  }
  if (ver < 15) {
    const cols = db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>;
    if (!cols.some(c => c.name === 'scheduleJson')) db.exec('ALTER TABLE tasks ADD COLUMN scheduleJson TEXT');
    db.prepare("INSERT INTO meta (key, value) VALUES ('schemaVersion', '15') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  }

}
