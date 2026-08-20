/**
 * AI Provider — Phase 0: OpenAI-compatible API.
 *
 * Supports any OpenAI-compatible endpoint (OpenAI, DeepSeek, Groq, Ollama, LM Studio)
 * via configurable baseURL + apiKey.
 */

import OpenAI from "openai";
import { ApiError, EngineError } from "../errors";
import { log } from "../logger";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number; // USD
}

/** Per-model pricing (USD per 1K tokens). Ollama/local = 0. */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 0.0025, output: 0.01 },
  "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
  "gpt-4-turbo": { input: 0.01, output: 0.03 },
  "gpt-3.5-turbo": { input: 0.0005, output: 0.0015 },
  "claude-3-opus": { input: 0.015, output: 0.075 },
  "claude-3-sonnet": { input: 0.003, output: 0.015 },
  "claude-3-haiku": { input: 0.00025, output: 0.00125 },
  "deepseek-v4-flash": { input: 0.00014, output: 0.00028 },
};

function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0; // unknown model — assume $0 (e.g. local Ollama)
  return (promptTokens / 1000) * pricing.input + (completionTokens / 1000) * pricing.output;
}

export interface AIProviderConfig {
  baseURL: string;
  apiKey: string;
  model: string;
}

export type ThinkingEffort = "disabled" | "low" | "medium" | "high" | "max";

/** Abort a stream if no chunk arrives for this long (server stalled mid-stream). */
const STREAM_IDLE_TIMEOUT_MS = 60_000;

function deepSeekThinkingParams(
  baseURL: string,
  effort: ThinkingEffort,
): Record<string, unknown> {
  if (!baseURL.includes("deepseek")) return {};
  if (effort === "disabled") {
    return { thinking: { type: "disabled" } };
  }
  return {
    thinking: { type: "enabled" },
    reasoning_effort: effort,
  };
}

export class AIProvider {
  private client: OpenAI;
  private config: AIProviderConfig;
  /** Accumulated usage across all chat() calls on this provider instance. */
  totalUsage: TokenUsage | null = null;

  constructor(config: AIProviderConfig) {
    this.config = config;
    this.client = new OpenAI({
      baseURL: config.baseURL,
      apiKey: config.apiKey,
      timeout: 90_000,
    });
  }

  async chat(
    messages: ChatMessage[],
    opts?: {
      temperature?: number;
      maxTokens?: number;
      thinking?: ThinkingEffort;
      responseFormat?: "json_object";
      onProgress?: (received: { chars: number; phase: "reasoning" | "content" }) => void;
    },
  ): Promise<string> {
    const isDeepSeek = this.config.baseURL.includes("deepseek");
    const thinkingEffort: ThinkingEffort = opts?.thinking ?? (isDeepSeek ? "low" : "disabled");
    const maxAttempts = 3;
    let maxTokens = opts?.maxTokens ?? 2000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let content: string | null = null;
      let finishReason: string | undefined;
      let promptTokens = 0;
      let completionTokens = 0;
      try {
        const request = {
          model: this.config.model,
          messages,
          temperature: opts?.temperature ?? 0.7,
          max_tokens: maxTokens,
          ...(opts?.responseFormat ? { response_format: { type: opts.responseFormat } } : {}),
          ...deepSeekThinkingParams(this.config.baseURL, thinkingEffort),
        };
        if (opts?.onProgress) {
          let lastChunkAt = 0;
          const consumeStream = async (stream: any) => {
            let chars = 0;
            let contentChars = 0;
            let lastPhase: "reasoning" | "content" | null = null;
            let lastLoggedPhase: string | null = null;
            for await (const chunk of stream) {
              const delta = chunk?.choices?.[0]?.delta;
              // DeepSeek streams reasoning separately from content; count both
              // so the UI shows live progress while the model is thinking.
              const deltaText =
                typeof delta?.content === "string" ? delta.content
                : typeof delta?.reasoning_content === "string" ? delta.reasoning_content
                : null;
              if (deltaText && deltaText.length > 0) {
                // Only actual text data resets the idle timer; empty keep-alive
                // chunks must not defeat the stall detection.
                lastChunkAt = Date.now();
                if (typeof delta?.content === "string" && delta.content.length > 0) {
                  content = (content || "") + delta.content;
                  contentChars += delta.content.length;
                  lastPhase = "content";
                } else {
                  lastPhase = "reasoning";
                }
                chars += deltaText.length;
                if (lastPhase !== lastLoggedPhase) {
                  lastLoggedPhase = lastPhase;
                  log.info(
                    `AI stream phase=${lastPhase} chars=${chars} contentChars=${contentChars}`,
                  );
                }
                if (lastPhase) opts?.onProgress?.({ chars, phase: lastPhase });
              }
              if (chunk?.choices?.[0]?.finish_reason) {
                finishReason = chunk.choices[0].finish_reason;
              }
              if (chunk?.usage) {
                promptTokens = chunk.usage.prompt_tokens || 0;
                completionTokens = (chunk.usage.total_tokens || 0) - promptTokens;
              }
            }
          };
          const streamAttempts: any[] = [
            { ...request, stream: true, stream_options: { include_usage: true } },
            { ...request, stream: true },
          ];
          // Some OpenAI-compatible servers reject response_format combined with
          // streaming; retry streaming without it (JSON repair still applies
          // downstream if the output is malformed).
          if (request.response_format) {
            const { response_format: _dropped, ...withoutFormat } = request;
            streamAttempts.push({ ...withoutFormat, stream: true });
          }
          let streamed = false;
          for (const attempt of streamAttempts) {
            const streamController = new AbortController();
            lastChunkAt = Date.now();
            const idleTimer = setInterval(() => {
              if (Date.now() - lastChunkAt > STREAM_IDLE_TIMEOUT_MS) {
                log.warn("AI stream idle timeout; aborting attempt");
                streamController.abort();
              }
            }, 5000);
            try {
              await consumeStream(
                await this.client.chat.completions.create({
                  ...attempt,
                  signal: streamController.signal,
                } as any),
              );
              streamed = true;
              break;
            } catch (err: any) {
              log.warn(`AI streaming attempt failed (${err?.message})`);
            } finally {
              clearInterval(idleTimer);
            }
          }
          if (!streamed) {
            log.warn("All AI streaming attempts failed; falling back to non-streaming");
            const response = await this.client.chat.completions.create(request as any);
            content = response.choices[0]?.message?.content ?? null;
            finishReason = response.choices[0]?.finish_reason;
            promptTokens = response.usage?.prompt_tokens ?? 0;
            completionTokens = (response.usage?.total_tokens ?? 0) - promptTokens;
            if (content) opts.onProgress({ chars: content.length, phase: "content" });
          }
        } else {
          const response = await this.client.chat.completions.create(request as any);
          content = response.choices[0]?.message?.content ?? null;
          finishReason = response.choices[0]?.finish_reason;
          promptTokens = response.usage?.prompt_tokens ?? 0;
          completionTokens = (response.usage?.total_tokens ?? 0) - promptTokens;
        }
      } catch (err: any) {
        if (err instanceof EngineError || err instanceof ApiError) throw err;
        const status = err.status || err.response?.status;
        const message = err.message || "Unknown AI API error";
        if (status === 401 || status === 403) {
          throw new ApiError(`AI API authentication failed: ${message}`, "AI_AUTH_ERROR", {
            statusCode: status,
            retryable: false,
          });
        }
        if (status === 429) {
          throw new ApiError(`AI API rate limited: ${message}`, "AI_RATE_LIMIT", {
            statusCode: 429,
            retryable: true,
          });
        }
        throw new ApiError(`AI API error: ${message}`, "AI_API_ERROR", {
          statusCode: status || 0,
          retryable: status ? status >= 500 : true,
        });
      }

      if (promptTokens || completionTokens) {
        const prev = this.totalUsage;
        this.totalUsage = {
          promptTokens: (prev?.promptTokens ?? 0) + promptTokens,
          completionTokens: (prev?.completionTokens ?? 0) + completionTokens,
          totalTokens: (prev?.totalTokens ?? 0) + promptTokens + completionTokens,
          estimatedCost:
            (prev?.estimatedCost ?? 0) +
            estimateCost(this.config.model, promptTokens, completionTokens),
        };
      }

      if (content) return content;

      log.warn(
        `AI returned empty content (attempt ${attempt}/${maxAttempts}, finish_reason=${finishReason})`,
      );
      // The response was cut off before producing any text (reasoning consumed
      // the whole budget). Double the cap on the next attempt so the model has
      // room to finish, capped to avoid runaway cost.
      if (finishReason === "length" && maxTokens < 64000) {
        maxTokens = Math.min(maxTokens * 2, 64000);
      }
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }
    }

    throw new EngineError("AI returned empty response", "AI_EMPTY_RESPONSE");
  }

  async validateConnection(): Promise<{ ok: boolean; error: string }> {
    try {
      // Send a minimal ping — just list models or a trivial chat
      await this.client.chat.completions.create({
        model: this.config.model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        ...deepSeekThinkingParams(this.config.baseURL, "disabled"),
      } as any);
      log.info(`AI connection validated: ${this.config.model} @ ${this.config.baseURL}`);
      return { ok: true, error: "" };
    } catch (err: any) {
      log.warn(`AI connection failed: ${err.message}`);
      return { ok: false, error: err?.message || String(err) };
    }
  }

  get model(): string {
    return this.config.model;
  }

  get baseURL(): string {
    return this.config.baseURL;
  }
}
