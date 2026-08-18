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
    });
  }

  async chat(
    messages: ChatMessage[],
    opts?: {
      temperature?: number;
      maxTokens?: number;
      thinking?: ThinkingEffort;
      responseFormat?: "json_object";
    },
  ): Promise<string> {
    const isDeepSeek = this.config.baseURL.includes("deepseek");
    const thinkingEffort: ThinkingEffort = opts?.thinking ?? (isDeepSeek ? "low" : "disabled");
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let response: OpenAI.Chat.Completions.ChatCompletion;
      try {
        response = await this.client.chat.completions.create({
          model: this.config.model,
          messages,
          temperature: opts?.temperature ?? 0.7,
          max_tokens: opts?.maxTokens ?? 2000,
          ...(opts?.responseFormat ? { response_format: { type: opts.responseFormat } } : {}),
          ...deepSeekThinkingParams(this.config.baseURL, thinkingEffort),
        } as any);
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

      const usage = response.usage;
      if (usage) {
        const prev = this.totalUsage;
        this.totalUsage = {
          promptTokens: (prev?.promptTokens ?? 0) + usage.prompt_tokens,
          completionTokens: (prev?.completionTokens ?? 0) + usage.completion_tokens,
          totalTokens: (prev?.totalTokens ?? 0) + usage.total_tokens,
          estimatedCost:
            (prev?.estimatedCost ?? 0) +
            estimateCost(this.config.model, usage.prompt_tokens, usage.completion_tokens),
        };
      }

      const content = response.choices[0]?.message?.content;
      if (content) return content;

      log.warn(
        `AI returned empty content (attempt ${attempt}/${maxAttempts}, finish_reason=${response.choices[0]?.finish_reason})`,
      );
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
