/**
 * Layered error model for Appilot.
 *
 *   AppError (base)
 *   ├── EngineError   — DB, repo analysis, content store failures
 *   └── ApiError      — GitHub API, AI API, rate limits
 *
 * Each error carries a user-readable message and optional metadata
 * for logging/ debugging. stack traces are preserved.
 */

export class AppError extends Error {
  /** Machine-readable error code (e.g. "DB_CONNECTION_FAILED") */
  readonly code: string;
  /** Additional structured context for logging */
  readonly context?: Record<string, unknown>;

  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.context = context;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/** Errors from the Core Engine layer */
export class EngineError extends AppError {
  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message, code, context);
  }
}

/** Errors from external API calls */
export class ApiError extends AppError {
  /** HTTP status code if available */
  readonly statusCode?: number;
  /** Whether the error is retryable (429, 5xx, network timeout) */
  readonly retryable: boolean;

  constructor(
    message: string,
    code: string,
    opts?: { statusCode?: number; retryable?: boolean; context?: Record<string, unknown> },
  ) {
    super(message, code, opts?.context);
    this.statusCode = opts?.statusCode;
    this.retryable = opts?.retryable ?? false;
  }
}

/** Convenience: create an ApiError with proper retryable flag based on status */
export function apiErrorFromStatus(
  message: string,
  code: string,
  status: number,
  context?: Record<string, unknown>,
): ApiError {
  const retryable = status === 429 || status >= 500;
  return new ApiError(message, code, { statusCode: status, retryable, context });
}

/** Determine if an error is user-facing (can be shown directly) vs internal */
export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

/** Format any error into a user-readable string */
export function formatError(err: unknown): string {
  if (err instanceof AppError) {
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
