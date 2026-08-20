/**
 * Electron main-process logger — wraps electron-log for file output.
 *
 * Phase 0 config:
 * - File: ~/Library/Logs/appilot/main.log (macOS) / %APPDATA%/appilot/logs/main.log (Windows)
 * - Rotation: daily, 14-day retention
 * - Console output in dev (electron-log default)
 */

import log from "electron-log";
import type { Logger } from "@engine/logger";
import { initLogger } from "@engine/logger";
import path from "path";
import fs from "fs";
import { app } from "electron";

function cleanupOldLogs(logsDir: string, maxDays: number) {
  try {
    if (!fs.existsSync(logsDir)) return;
    const cutoff = Date.now() - maxDays * 86400000;
    for (const file of fs.readdirSync(logsDir)) {
      const filePath = path.join(logsDir, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) fs.unlinkSync(filePath);
    }
  } catch { /* best-effort, don't crash on cleanup failure */ }
}

export function setupLogger(): Logger {
  // Configure file logging path
  const logsDir =
    process.platform === "darwin"
      ? path.join(app.getPath("home"), "Library", "Logs", "appilot")
      : path.join(app.getPath("userData"), "logs");

  // One-time cleanup at startup: remove logs older than 14 days.
  cleanupOldLogs(logsDir, 14);

  // Daily rotation via a date-stamped filename (a new file each day).
  const dateStr = new Date().toISOString().slice(0, 10);
  log.transports.file.resolvePathFn = () => path.join(logsDir, `main-${dateStr}.log`);

  // Console in dev mode, file always
  log.transports.console.level = process.env.NODE_ENV === "production" ? "info" : "debug";
  log.transports.file.level = "debug";

  // Create the logger adapter implementing our engine Logger interface
  const logger: Logger = {
    debug: (msg, meta) => (meta ? log.debug(msg, meta) : log.debug(msg)),
    info: (msg, meta) => (meta ? log.info(msg, meta) : log.info(msg)),
    warn: (msg, meta) => (meta ? log.warn(msg, meta) : log.warn(msg)),
    error: (msg, meta) => (meta ? log.error(msg, meta) : log.error(msg)),
  };

  initLogger(logger);
  log.info(`Appilot v${app.getVersion()} starting — logs: ${logsDir}`);
  return logger;
}
