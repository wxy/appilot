import type { AIProvider, ChatMessage } from "./ai-provider";
import type { ReleaseInfo } from "../release-watcher";
import { EngineError } from "../errors";
import { log } from "../logger";

export interface ReleaseReview {
  summary: string;
  descriptionSuggestions: string[];
  keywordSuggestions: string[];
  promotionAngles: string[];
}

function parseJson(raw: string): any {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  const candidates = [
    s,
    s.replace(/,\s*([}\]])/g, "$1"),
    s.replace(/}\s*{/g, "},{"),
  ];
  let lastError: any = null;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("JSON parse failed");
}

export async function reviewRelease(
  provider: AIProvider,
  context: {
    name: string;
    description: string;
    keywords: string[];
    recentRankings: { keyword: string; storefront: string; rank: number | null; checkedAt: string }[];
    release: ReleaseInfo;
  },
): Promise<ReleaseReview> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You are Appilot's release analyst. Given an app and its new release, produce an ASO and promotion review.",
        "Respond ONLY with JSON in this shape:",
        '{"summary":"...","descriptionSuggestions":["..."],"keywordSuggestions":["..."],"promotionAngles":["..."]}',
        "summary should be written in Chinese. Keep the other arrays concise and actionable.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `App name: ${context.name}`,
        `Current description: ${context.description || "N/A"}`,
        `Tracked keywords: ${context.keywords.join(", ") || "N/A"}`,
        `Recent rankings: ${context.recentRankings
          .map((item) => `${item.keyword}@${item.storefront}:${item.rank ?? "not ranked"}`)
          .join(", ") || "N/A"}`,
        `Release tag: ${context.release.tag}`,
        `Release name: ${context.release.name || context.release.tag}`,
        `Published at: ${context.release.publishedAt}`,
        `Release body:\n${context.release.body || "N/A"}`,
      ].join("\n"),
    },
  ];

  const raw = await provider.chat(messages, {
    temperature: 0.4,
    maxTokens: 1800,
    thinking: "low",
  });

  try {
    const data = parseJson(raw);
    return {
      summary: String(data.summary || "").trim(),
      descriptionSuggestions: Array.isArray(data.descriptionSuggestions)
        ? data.descriptionSuggestions.map((item: any) => String(item).trim()).filter(Boolean).slice(0, 8)
        : [],
      keywordSuggestions: Array.isArray(data.keywordSuggestions)
        ? data.keywordSuggestions.map((item: any) => String(item).trim()).filter(Boolean).slice(0, 12)
        : [],
      promotionAngles: Array.isArray(data.promotionAngles)
        ? data.promotionAngles.map((item: any) => String(item).trim()).filter(Boolean).slice(0, 8)
        : [],
    };
  } catch (err: any) {
    log.warn(`Release review JSON parse failed: ${err.message}\nRaw: ${raw.slice(0, 1000)}`);
    throw new EngineError("AI 无法解析 Release 审核结果，请重试。", "AI_EMPTY_RESPONSE");
  }
}
