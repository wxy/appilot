import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import path from "path";
import fs from "fs";

let db: ReturnType<typeof drizzle> | null = null;
let sqlite: Database.Database | null = null;

export function createDatabase(dbPath: string) {
  if (db) return db;

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  db = drizzle(sqlite, { schema });
  return db;
}

export function getDatabase() {
  if (!db) throw new Error("Database not initialized. Call createDatabase() first.");
  return db;
}

/** Close connection and reset references. Safe to call multiple times. */
export function closeDatabase() {
  if (sqlite) { sqlite.close(); sqlite = null; }
  db = null;
}
