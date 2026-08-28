/**
 * AI request layer — the single place all AI requests flow through.
 *
 * Feature modules declare their request (messages + options) and this layer
 * enforces consistent behavior:
 * - JSON mode: generate → parse → truncated-echo repair;
 * - empty-response retry with thinking disabled (when requested);
 * - a shared output-token ceiling and per-task defaults.
 *
 * Feature modules should NOT call `provider.chat` directly.
 */

import type { AIProvider, ChatMessage, ThinkingEffort } from "./ai-provider";
import type { ProjectProfile } from "../project-profile";
import { archiveSystemPrompt } from "../project-profile";
import { EngineError } from "../errors";
import { log } from "../logger";

/** Absolute ceiling for a single generation (also provider.chat's doubling cap). */
export const MAX_OUTPUT_TOKENS = 64000;
/** Repair requests echo only this many chars of the malformed output. */
export const JSON_REPAIR_ECHO_CHARS = 4000;

export interface AiRequestOptions {
  temperature?: number;
  maxTokens?: number;
  thinking?: ThinkingEffort;
  /** Ask the provider for a JSON object (response_format json_object). */
  json?: boolean;
  /** Retry once with thinking disabled when the provider returns empty content. */
  retryWithoutThinking?: boolean;
  onProgress?: (received: { chars: number; phase: "reasoning" | "content" }) => void;
  /** 外部取消信号（「停止」按钮）。 */
  signal?: AbortSignal;
  /** 报告本次完成的 finish_reason，用于识别输出被截断。 */
  onFinishReason?: (reason: string | undefined) => void;
  /** 自动修复/重试开始时回调（UI 据此显示「修复中」状态）。 */
  onRetry?: () => void;
}

export interface JsonRequestOptions extends AiRequestOptions {
  /** How much of the malformed output to echo into the repair request. */
  repairEchoChars?: number;
}

/**
 * Build a request through the shared cache-friendly shape:
 * system = stable project archive prefix + task instructions,
 * user   = volatile task data only (fallback app identity when no profile).
 * Every feature that has a profile MUST use this so the archive prefix is
 * byte-identical across all AI requests for the same project.
 */
export function buildArchiveMessages(
  profile: ProjectProfile | undefined,
  taskSystem: string,
  taskUserLines: string[],
  fallbackUserLines: string[] = [],
): ChatMessage[] {
  const system = profile
    ? [archiveSystemPrompt(profile), taskSystem].join("\n\n")
    : taskSystem;
  const user = profile ? taskUserLines : [...fallbackUserLines, ...taskUserLines];
  return [
    { role: "system", content: system },
    { role: "user", content: user.join("\n") },
  ];
}

/** Robust JSON extraction: fences, surrounding prose, trailing commas, unquoted keys. */
export function parseJsonObject(raw: string): any {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  const repairs = [
    s,
    s.replace(/,\s*([}\]])/g, "$1"),
    s.replace(/}\s*{/g, "},{"),
    s.replace(/]\s*\[/g, "],["),
    s.replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3'),
  ];
  let lastError: any = null;
  for (const candidate of repairs) {
    try {
      return JSON.parse(candidate);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("JSON parse failed");
}

function chatOptions(options: AiRequestOptions) {
  return {
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    thinking: options.thinking,
    responseFormat: options.json ? ("json_object" as const) : undefined,
    onProgress: options.onProgress,
    signal: options.signal,
    onFinishReason: options.onFinishReason,
  };
}

/** One shared repair request; echoes only a truncated slice of the bad output. */
export async function repairJson(
  provider: AIProvider,
  raw: string,
  options: {
    echoChars?: number;
    onProgress?: AiRequestOptions["onProgress"];
    signal?: AbortSignal;
    /** 原请求的 system 提示词：修复时保留任务约束（如目标语言、字段上限）。 */
    systemContext?: string;
  } = {},
): Promise<any> {
  const echo = raw.slice(0, options.echoChars ?? JSON_REPAIR_ECHO_CHARS);
  const repaired = await provider.chat(
    [
      ...(options.systemContext
        ? [{ role: "system" as const, content: options.systemContext }]
        : []),
      {
        role: "user",
        content: [
          "The following response was supposed to be a single JSON object, but it could not be parsed.",
          "Return ONLY the corrected JSON object. Do not wrap it in markdown. Do not add commentary.",
          echo,
        ].join("\n\n"),
      },
    ],
    {
      temperature: 0,
      maxTokens: 8000,
      thinking: "disabled",
      responseFormat: "json_object",
      onProgress: options.onProgress,
      signal: options.signal,
    },
  );
  return parseJsonObject(repaired);
}

/** 输出远超字段上限的合理范围时，视为跑飞/被截断，不再进入修复放大消耗。 */
const TRUNCATED_RAW_CHARS = 20000;

/** Consistent plain-text generation through the layer. */
export async function requestText(
  provider: AIProvider,
  messages: ChatMessage[],
  options: AiRequestOptions = {},
): Promise<string> {
  try {
    return await provider.chat(messages, chatOptions(options));
  } catch (err) {
    if (
      options.retryWithoutThinking &&
      err instanceof EngineError &&
      err.code === "AI_EMPTY_RESPONSE"
    ) {
      log.warn("AI returned empty content; retrying with thinking disabled");
      return provider.chat(messages, chatOptions({ ...options, thinking: "disabled" }));
    }
    throw err;
  }
}

/** Generate a JSON object: chat → parse → truncated-echo repair on failure. */
export async function requestJson(
  provider: AIProvider,
  messages: ChatMessage[],
  options: JsonRequestOptions = {},
): Promise<any> {
  let finishReason: string | undefined;
  const raw = await requestText(provider, messages, {
    ...options,
    json: true,
    onFinishReason: (reason) => {
      finishReason = reason;
    },
  });
  try {
    return parseJsonObject(raw);
  } catch (err: any) {
    if (finishReason === "length" || raw.length > TRUNCATED_RAW_CHARS) {
      throw new EngineError(
        "AI 输出达到长度上限被截断，请重试（可在运行中点击「停止」后调整素材）。",
        "AI_OUTPUT_TRUNCATED",
      );
    }
    log.warn(`AI JSON parse failed (${err.message}); attempting repair`);
    options.onRetry?.();
    return repairJson(provider, raw, {
      echoChars: options.repairEchoChars,
      onProgress: options.onProgress,
      signal: options.signal,
      systemContext: messages.find((m) => m.role === "system")?.content,
    });
  }
}
