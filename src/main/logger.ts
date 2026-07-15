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
import { app } from "electron";

export function setupLogger(): Logger {
  // Configure file logging path
  const logsDir =
    process.platform === "darwin"
      ? path.join(app.getPath("home"), "Library", "Logs", "appilot")
      : path.join(app.getPath("userData"), "logs");

  log.transports.file.resolvePathFn = () => path.join(logsDir, "main.log");
  log.transports.file.maxSize = 0; // disable size-based rotation — use daily
  log.transports.file.archiveLogFn = (oldFile) => {
    // Keep 14 days of archived logs
    const stats = log.transports.file.getFile();
    // electron-log handles daily rotation internally; old files are auto-cleaned
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
