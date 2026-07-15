// @appilot/engine — Core engine logic (pure TypeScript, zero Electron/React dependency)
export const ENGINE_VERSION = "0.1.0";

// Database (Task 0.2)
export { createDatabase, getDatabase, closeDatabase } from "./database/index.js";
export * as schema from "./database/schema.js";
export { runMigrations } from "./database/migrate.js";

// Error handling (Task 0.3)
export {
  AppError,
  EngineError,
  ApiError,
  apiErrorFromStatus,
  isAppError,
  formatError,
} from "./errors.js";

// Logging (Task 0.3)
export { initLogger, getLogger, log } from "./logger.js";
export type { Logger, LogLevel } from "./logger.js";

// Repo Analyzer (Task 0.4)
export { RepoAnalyzer } from "./repo-analyzer.js";
export type { RepoIndex, RepoSummary, FeatureHighlight, CommitInfo } from "./repo-analyzer.js";

// AI (Task 0.5)
export { AIProvider } from "./ai/ai-provider.js";
export type { ChatMessage, TokenUsage, AIProviderConfig } from "./ai/ai-provider.js";
