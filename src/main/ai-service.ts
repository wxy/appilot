import { decryptApiKey } from "./credentials";
import type { AppStore } from "./store";

/**
 * Single factory for real AI providers (not testConnection): persists every
 * completed request's token usage (incl. cached input) into the aiUsage store
 * so the UI can show total tokens + cache hits instead of billing amounts.
 */
export async function createAiProvider(s: AppStore) {
  const { AIProvider } = await import("../engine/ai/ai-provider");
  return new AIProvider({
    baseURL: s.get("aiProviderUrl"),
    apiKey: decryptApiKey(s.get("aiApiKey")),
    model: s.get("aiModel"),
    onUsage: (usage) => {
      const prev = s.get("aiUsage") || {};
      s.set("aiUsage", {
        calls: (prev.calls || 0) + 1,
        promptTokens: (prev.promptTokens || 0) + usage.promptTokens,
        completionTokens: (prev.completionTokens || 0) + usage.completionTokens,
        cachedTokens: (prev.cachedTokens || 0) + usage.cachedTokens,
        totalTokens: (prev.totalTokens || 0) + usage.totalTokens,
        estimatedCost: (prev.estimatedCost || 0) + usage.estimatedCost,
      });
    },
  });
}
