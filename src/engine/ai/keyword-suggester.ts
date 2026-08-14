/**
 * ASO keyword generation (Phase A step 3).
 *
 * In ONE AI request, generate two keyword sets for a target localization:
 * - tracking: broad terms real users would search (rank observation)
 * - submission: a curated set for the App Store keyword field (≤100 chars)
 */

import type { AIProvider, ChatMessage } from "./ai-provider";
import { log } from "../logger";
import { EngineError } from "../errors";

export interface KeywordSuggestion {
  keyword: string;
  rationale: string;
}

export interface KeywordGeneration {
  tracking: KeywordSuggestion[];
  submission: string[];
}

function parseJsonObject(raw: string): any {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return JSON.parse(s);
}

/** Parse the AI's JSON response into tracking + submission keyword sets. */
export function parseKeywordGeneration(raw: string): KeywordGeneration {
  const data = parseJsonObject(raw);

  const tracking: KeywordSuggestion[] = Array.isArray(data.tracking)
    ? data.tracking
        .filter((x: any) => x && typeof x.keyword === "string" && x.keyword.trim())
        .map((x: any) => ({
          keyword: x.keyword.trim(),
          rationale: String(x.rationale || "").trim(),
        }))
        .slice(0, 30)
    : [];

  const submission: string[] = Array.isArray(data.submission)
    ? data.submission
        .map((x: any) => String(x).trim())
        .filter(Boolean)
        .slice(0, 30)
    : [];

  return { tracking, submission };
}

export async function generateKeywords(
  provider: AIProvider,
  context: {
    name: string;
    description: string;
    productType: string;
    language: string;
    uiLanguage: string;
  },
): Promise<KeywordGeneration> {
  log.info(`Generating ASO keywords for ${context.name} (${context.language})`);

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You are Appilot's ASO keyword analyst. In ONE response, generate two keyword sets for the target localization language:",
        "1. `tracking`: a broad set of search terms a real user might type to find this app. Include 12-20 SHORT terms (single words or compound terms WITHOUT spaces, e.g. 'flashlight', 'nightwalk'). Breadth matters — cover category, function, use case, and synonyms.",
        "2. `submission`: a curated set to put into the App Store keyword field. It must total 100 characters MAXIMUM (comma-separated, no spaces). Choose only high-value descriptive terms that fit the limit; do NOT include competitor brand names.",
        "Keywords must be in the target localization language. Each tracking term needs a `rationale` written in the UI language.",
        'Respond ONLY with a JSON object in this exact shape:',
        '{"tracking":[{"keyword":"...","rationale":"..."}],"submission":["kw1","kw2","kw3"]}',
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `App name: ${context.name}`,
        `Platform: ${context.productType}`,
        `Description: ${context.description || "N/A"}`,
        `Target localization (keywords must be in this language): ${context.language}`,
        `UI language (write the rationale in this language): ${context.uiLanguage}`,
      ].join("\n"),
    },
  ];

  let raw: string;
  try {
    raw = await provider.chat(messages, {
      temperature: 0.4,
      maxTokens: 3000,
      thinking: "low",
    });
  } catch (err) {
    if (err instanceof EngineError && err.code === "AI_EMPTY_RESPONSE") {
      log.warn(
        `Low-thinking keyword generation returned no content for ${context.name}; falling back to disabled thinking`,
      );
      raw = await provider.chat(messages, {
        temperature: 0.4,
        maxTokens: 3000,
        thinking: "disabled",
      });
    } else {
      throw err;
    }
  }
  try {
    return parseKeywordGeneration(raw);
  } catch (err: any) {
    log.warn(`Failed to parse keyword generation for ${context.name}: ${err.message}`);
    throw new Error("AI 关键词响应无法解析，请重试。");
  }
}
