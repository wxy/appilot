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

  log.transports.file.resolvePathFn = () => path.join(logsDir, "main.log");
  log.transports.file.maxSize = 0; // daily rotation via electron-log schedule
  log.transports.file.resolvePathFn = () => {
    // Auto-cleanup: remove logs older than 14 days
    cleanupOldLogs(logsDir, 14);
    return path.join(logsDir, "main.log");
  };

  // Console in dev mode, file always
  log.transports.console.level = process.env.NODE_ENV === "production" ? "info" : "debug";
  log.transports.file.level = "debug";

  // Create the logger adapter implementing our engine Logger interface
  const logger: Logger = {
    debug: (msg, meta) => log.debug(msg, meta),
    info: (msg, meta) => log.info(msg, meta),
    warn: (msg, meta) => log.warn(msg, meta),
    error: (msg, meta) => log.error(msg, meta),
  };

  initLogger(logger);
  log.info(`Appilot v${app.getVersion()} starting — logs: ${logsDir}`);
  return logger;
}
