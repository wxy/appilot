/**
 * Error handling tests
 * Run: npm test (tsx tests/errors.test.ts)
 */

import {
  AppError,
  EngineError,
  ApiError,
  apiErrorFromStatus,
  isAppError,
  formatError,
} from "../src/engine/errors";

let errors = 0;
function assert(condition: boolean, msg: string) {
  if (!condition) { console.error(`❌ FAIL: ${msg}`); errors++; }
  else { console.log(`✅ PASS: ${msg}`); }
}

// 1. Base AppError (tested via EngineError — AppError is abstract)
const base = new EngineError("test error", "TEST_CODE", { key: "val" });
assert(base instanceof Error, "AppError (via EngineError) is an Error");
assert(base instanceof AppError, "EngineError instanceof AppError");
assert(base.message === "test error", "AppError.message preserved");
assert(base.code === "TEST_CODE", "AppError.code set");
assert(base.context?.key === "val", "AppError.context preserved");
assert(isAppError(base), "isAppError returns true for AppError subclass");
assert(!isAppError(new Error("plain")), "isAppError returns false for plain Error");
assert(!isAppError("string"), "isAppError returns false for string");

// 2. EngineError
const eng = new EngineError("db failed", "DB_ERROR", { sql: "SELECT 1" });
assert(eng instanceof AppError, "EngineError is an AppError");
assert(eng instanceof EngineError, "EngineError is an EngineError");
assert(eng.code === "DB_ERROR", "EngineError.code set");

// 3. ApiError
const api = new ApiError("rate limited", "RATE_LIMIT", { statusCode: 429, retryable: true });
assert(api instanceof AppError, "ApiError is an AppError");
assert(api.statusCode === 429, "ApiError.statusCode");
assert(api.retryable, "ApiError.retryable = true for 429");

const serverError = new ApiError("server down", "SERVER_ERROR", { statusCode: 500, retryable: true });
assert(serverError.retryable, "ApiError.retryable = true for 500");

const clientError = new ApiError("not found", "NOT_FOUND", { statusCode: 404, retryable: false });
assert(!clientError.retryable, "ApiError.retryable = false for 404");

// 4. apiErrorFromStatus
const rateLimit = apiErrorFromStatus("too many", "RL", 429);
assert(rateLimit.retryable, "apiErrorFromStatus 429 → retryable");
assert(rateLimit.statusCode === 429, "apiErrorFromStatus preserves status");

const internal = apiErrorFromStatus("boom", "BOOM", 500);
assert(internal.retryable, "apiErrorFromStatus 500 → retryable");

const notFound = apiErrorFromStatus("nope", "NF", 404);
assert(!notFound.retryable, "apiErrorFromStatus 404 → not retryable");

// 5. formatError
assert(formatError(new EngineError("user msg", "E")) === "user msg", "formatError returns AppError.message");
assert(formatError(new Error("raw error")) === "raw error", "formatError returns Error.message");
assert(formatError("plain string") === "plain string", "formatError returns string as-is");
assert(formatError(42) === "42", "formatError stringifies numbers");

// 6. Stack traces
const withStack = new EngineError("trace me", "TRACE");
assert(typeof withStack.stack === "string", "Error has stack trace");
assert(withStack.stack!.includes("errors.test.ts"), "Stack includes test file");

console.log(`\n${errors === 0 ? "🎉 All error handling tests passed!" : `❌ ${errors} test(s) failed`}`);
process.exit(errors > 0 ? 1 : 0);
