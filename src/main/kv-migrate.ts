/**
 * config.json（旧 electron-store）→ SQLite app_kv 一次性导入。
 *
 * 纯逻辑模块（不 import electron），便于 tsx 单测；路径与文件系统由调用方注入。
 * 语义：
 * - 已完成标记（KV_MIGRATE_MARK 已写入）→ 幂等跳过；
 * - config.json 不存在 → 直接置完成标记（新装/已迁移）；
 * - 存在 → 全量导入各键（JSON 文本存 app_kv），成功后把文件改名归档
 *   `config.json.migrated-<ts>`（保留可人工恢复），再置完成标记；
 * - JSON 解析失败 → 抛错（调用方记录日志、不置标记，下次启动重试；旧文件保留）。
 */
import fs from "fs";

export const KV_MIGRATE_MARK = "__kvMigratedFromConfigJson";

export interface KvLike {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

export interface KvMigrationOutcome {
  imported: number;
  archivedTo: string | null;
  alreadyDone: boolean;
}

export function migrateConfigJsonIntoKv(
  kv: KvLike,
  configPath: string,
  fsApi: {
    existsSync(p: string): boolean;
    readFileSync(p: string, enc: "utf8"): string;
    renameSync(from: string, to: string): void;
  } = fs,
): KvMigrationOutcome {
  if (kv.get(KV_MIGRATE_MARK)) {
    return { imported: 0, archivedTo: null, alreadyDone: true };
  }
  if (!fsApi.existsSync(configPath)) {
    kv.set(KV_MIGRATE_MARK, new Date().toISOString());
    return { imported: 0, archivedTo: null, alreadyDone: false };
  }
  const raw = JSON.parse(fsApi.readFileSync(configPath, "utf8")) as Record<string, unknown>;
  if (!raw || typeof raw !== "object") {
    throw new Error(`config.json 顶层不是对象（内容: ${String(raw).slice(0, 80)}）`);
  }
  let imported = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (key === KV_MIGRATE_MARK) continue;
    kv.set(key, JSON.stringify(value));
    imported += 1;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archivedTo = `${configPath}.migrated-${stamp}`;
  fsApi.renameSync(configPath, archivedTo);
  kv.set(KV_MIGRATE_MARK, new Date().toISOString());
  return { imported, archivedTo, alreadyDone: false };
}

/** 迁移产物保留期（默认 14 天）：过期后启动时自动清理。 */
export const MIGRATION_ARTIFACT_RETENTION_DAYS = 14;

/** config.json 迁移产物（.bak-* / .migrated-*）——可能含迁移前明文凭据，到期即清。 */
export function cleanupMigrationArtifacts(
  dir: string,
  nowMs: number = Date.now(),
  retentionDays: number = MIGRATION_ARTIFACT_RETENTION_DAYS,
  fsApi: {
    existsSync(p: string): boolean;
    readdirSync(p: string): string[];
    statSync(p: string): { mtimeMs: number };
    unlinkSync(p: string): void;
  } = fs,
): string[] {
  const removed: string[] = [];
  try {
    if (!fsApi.existsSync(dir)) return removed;
    const cutoffMs = nowMs - Math.max(1, retentionDays) * 86400000;
    for (const file of fsApi.readdirSync(dir)) {
      if (!/^config\.json\.(bak-|migrated-)/.test(file)) continue;
      const full = `${dir.replace(/\/$/, "")}/${file}`;
      try {
        if (fsApi.statSync(full).mtimeMs >= cutoffMs) continue;
        fsApi.unlinkSync(full);
        removed.push(file);
      } catch {
        // 单个文件失败不阻塞其余清理
      }
    }
  } catch {
    // best effort
  }
  return removed;
}
