/**
 * SQLite 数据管理 IPC（架构收敛 C3）：Electron 壳对共享 DB 的运维介入面。
 *
 * 后端已从 JSON 换为独立 SQLite 单库（WAL），容量远超旧方案，长期累积
 * （rank_snapshots 快照、tasks 行等）需要管理动作：
 * - info：DB 路径 / 文件大小 / 各表行数 / 快照时间跨度；
 * - pruneSnapshots：保留最近 N 天排名快照，清理更早（headless 全库清理）；
 * - vacuum：WAL checkpoint + VACUUM 收缩文件；
 * - backup：VACUUM INTO 导出一致性副本（走系统保存对话框）。
 *
 * 与调度共用同一 DB 文件（WAL + busy_timeout 并发安全）；写类操作均影响行数
 * 回传，不做「静默清理」。
 */
import { ipcMain, app, dialog, BrowserWindow } from "electron";
import { statSync } from "node:fs";
import { join, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { log } from "@appilot-labs/appilot-core/logger";
import { sharedStore } from "./registry-sync";

function dbPath(): string {
  return join(app.getPath("userData"), "appilot.db");
}

/** 独立只读连接跑统计 SQL（不打扰 sharedStore 的活动连接）。 */
function openAdminDb() {
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  return new DatabaseSync(dbPath(), { readOnly: true });
}

function fileSize(p: string): number {
  try {
    return statSync(p).size;
  } catch {
    return 0;
  }
}

function dbInfo() {
  const path = dbPath();
  const db = openAdminDb();
  try {
    const count = (table: string) =>
      Number((db.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as any)?.c ?? 0);
    const span = db
      .prepare("SELECT MIN(checkedAt) min, MAX(checkedAt) max FROM rank_snapshots")
      .get() as { min: string | null; max: string | null } | undefined;
    return {
      dbPath: path,
      sizeBytes: fileSize(path),
      walSizeBytes: fileSize(path + "-wal"),
      counts: {
        projects: count("projects"),
        tasks: count("tasks"),
        rankSnapshots: count("rank_snapshots"),
        productRecords: count("product_records"),
        projectMeta: count("project_meta"),
        releaseCache: count("project_release_cache"),
      },
      snapshotSpan: { min: span?.min ?? null, max: span?.max ?? null },
    };
  } finally {
    db.close();
  }
}

export function registerDbAdminHandlers(): void {
  ipcMain.handle("db:admin:info", async () => dbInfo());

  // 清理旧排名快照：保留最近 N 天。返回删除行数与剩余量。
  ipcMain.handle("db:admin:pruneSnapshots", async (_e, days: number) => {
    const keepDays = Math.max(1, Math.min(Number(days) || 30, 3650));
    const beforeIso = new Date(Date.now() - keepDays * 86_400_000).toISOString();
    const removed = sharedStore().snapshots.pruneAllOlderThan(beforeIso);
    log.info(`appilot: pruned ${removed} rank snapshots older than ${keepDays}d`);
    return { removed, keepDays, info: dbInfo() };
  });

  // 压缩：WAL checkpoint（截断）+ VACUUM（文件收缩）。独立连接执行。
  ipcMain.handle("db:admin:vacuum", async () => {
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const path = dbPath();
    const before = fileSize(path) + fileSize(path + "-wal");
    const db = new DatabaseSync(path);
    try {
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      db.exec("VACUUM");
    } finally {
      db.close();
    }
    const after = fileSize(path) + fileSize(path + "-wal");
    return { ok: true, reclaimedBytes: Math.max(0, before - after), info: dbInfo() };
  });

  // 备份：VACUUM INTO 导出一致性副本（独立连接，可在调度运行时安全进行）。
  ipcMain.handle("db:admin:backup", async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const defaultName = `appilot-backup-${new Date().toISOString().slice(0, 10)}.db`;
    const opts = {
      title: "备份 Appilot 数据库",
      defaultPath: join(app.getPath("documents"), defaultName),
      filters: [{ name: "SQLite 数据库", extensions: ["db"] }],
    };
    const result = win
      ? await dialog.showSaveDialog(win, opts)
      : await dialog.showSaveDialog(opts);
    if (result.canceled || !result.filePath) return { canceled: true };
    const target = result.filePath;
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const db = new DatabaseSync(dbPath());
    try {
      // VACUUM INTO 目标必须不存在；先清理目录确保可写。
      mkdirSync(dirname(target), { recursive: true });
      const { rmSync } = require("node:fs") as typeof import("node:fs");
      rmSync(target, { force: true });
      db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    } finally {
      db.close();
    }
    log.info(`appilot: database backup written to ${target}`);
    return { canceled: false, path: target, sizeBytes: fileSize(target) };
  });
}
