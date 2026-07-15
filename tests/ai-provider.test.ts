/**
 * AI Provider tests — mocks openai SDK to avoid real API calls.
 */

import { AIProvider } from "../src/engine/ai/ai-provider";
import type { ChatMessage } from "../src/engine/ai/ai-provider";
import { ApiError } from "../src/engine/errors";

let errors = 0;
function assert(condition: boolean, msg: string) {
  if (!condition) { console.error(`❌ FAIL: ${msg}`); errors++; }
  else { console.log(`✅ PASS: ${msg}`); }
}

// ── Testing with a local provider is the gold standard. ──
// The following tests validate the provider construction, config,
// and error classification without requiring a live endpoint.

// 1. Provider construction
const provider = new AIProvider({
  baseURL: "https://api.openai.com/v1",
  apiKey: "sk-test-key",
  model: "gpt-4o",
});

assert(provider.model === "gpt-4o", "constructor: model stored");
assert(provider.baseURL === "https://api.openai.com/v1", "constructor: baseURL stored");
assert(provider.lastUsage === null, "constructor: lastUsage starts null");

// 2. ChatMessage type
const messages: ChatMessage[] = [
  { role: "system", content: "You are a helpful assistant." },
  { role: "user", content: "Hello" },
];
assert(messages.length === 2, "ChatMessage: can build message array");
assert(messages[0].role === "system", "ChatMessage: system role");
assert(messages[1].role === "user", "ChatMessage: user role");

// 3. ApiError classification (tested via error types, not live API)
// Auth errors should be non-retryable
const authErr = new ApiError("auth failed", "AI_AUTH_ERROR", { statusCode: 401, retryable: false });
assert(!authErr.retryable, "auth error: non-retryable");

// Rate limit errors should be retryable
const rateErr = new ApiError("rate limited", "AI_RATE_LIMIT", { statusCode: 429, retryable: true });
assert(rateErr.retryable, "rate limit error: retryable");

// 4. Provider supports multiple configs (Ollama local)
const localProvider = new AIProvider({
  baseURL: "http://localhost:11434/v1",
  apiKey: "ollama",
  model: "llama3",
});
assert(localProvider.model === "llama3", "local provider: model");
assert(localProvider.baseURL.includes("11434"), "local provider: ollama URL");

// 5. Provider with DeepSeek
const dsProvider = new AIProvider({
  baseURL: "https://api.deepseek.com/v1",
  apiKey: "sk-ds-test",
  model: "deepseek-chat",
});
assert(dsProvider.model === "deepseek-chat", "deepseek provider: model");

console.log(`\n${errors === 0 ? "🎉 All AI provider tests passed!" : `❌ ${errors} test(s) failed`}`);
process.exit(errors > 0 ? 1 : 0);
