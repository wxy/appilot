// @appilot-labs/engine — Core engine logic (pure TypeScript, zero Electron/React dependency)

// Error handling (Task 0.3)
export {
  AppError,
  EngineError,
  ApiError,
  apiErrorFromStatus,
  isAppError,
  formatError,
} from "./errors";

// Logging (Task 0.3)
export { initLogger, getLogger, log } from "./logger";
export type { Logger, LogLevel } from "./logger";

// AI (Task 0.5-0.8)
export { AIProvider } from "./ai/ai-provider";
export type { ChatMessage, TokenUsage, AIProviderConfig } from "./ai/ai-provider";
