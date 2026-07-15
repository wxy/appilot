/**
 * Structured logger abstraction.
 *
 * Phase 0: wraps electron-log (file rotation, 14-day retention).
 * The engine layer uses this interface — actual transport binding
 * happens in the Electron main process via initLogger().
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/** No-op logger used before initLogger() is called (e.g. in tests) */
class NoopLogger implements Logger {
  debug() {}
  info() {}
  warn() {}
  error() {}
}

let current: Logger = new NoopLogger();

/** Set the active logger (called once at app startup by Electron main process) */
export function initLogger(logger: Logger) {
  current = logger;
}

/** Get the current logger (safe to call before init — returns no-op) */
export function getLogger(): Logger {
  return current;
}

// Convenience shortcuts
export const log = {
  debug: (msg: string, meta?: Record<string, unknown>) => current.debug(msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => current.info(msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => current.warn(msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => current.error(msg, meta),
};
