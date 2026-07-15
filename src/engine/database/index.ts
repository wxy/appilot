import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import path from "path";
import fs from "fs";

let db: ReturnType<typeof drizzle> | null = null;

/**
 * Create or return a singleton database connection.
 * Phase 0: dbPath = ~/.appilot/data/appilot.db
 *
 * The Engine runs in Electron's main process. All DB access goes through
 * this single connection — the renderer process accesses it via IPC handlers.
 */
export function createDatabase(dbPath: string) {
  if (db) return db;

  // Ensure parent directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  db = drizzle(sqlite, { schema });
  return db;
}

/** Get the current db instance (throws if not initialized) */
export function getDatabase() {
  if (!db) throw new Error("Database not initialized. Call createDatabase() first.");
  return db;
}

/** Close and reset the connection (for testing) */
export function closeDatabase() {
  if (db) {
    db = null;
  }
}
