import type {
  BriefSuggestion,
  BriefSuggestionDecision,
} from "@appilot-labs/appilot-core/ai/overview-brief";

export type ManageableBriefSession = {
  suggestions: BriefSuggestion[];
  nextSuggestionNumber?: number;
  exchanges: Array<{ suggestionId: string | null } & Record<string, unknown>>;
  actionRuns: Array<{ suggestionId: string | null } & Record<string, unknown>>;
  dismissedSuggestionIds: string[];
  supersededSuggestionIds: string[];
};

export function normalizeBriefSuggestionNumbers<T extends ManageableBriefSession>(session: T): T {
  let highest = session.suggestions.reduce(
    (value, suggestion) => Number.isInteger(suggestion.number) && (suggestion.number || 0) > value
      ? suggestion.number as number
      : value,
    0,
  );
  const assigned = new Map<string, number>();
  const missing = session.suggestions
    .map((suggestion, index) => ({ suggestion, index }))
    .filter(({ suggestion }) => !Number.isInteger(suggestion.number) || (suggestion.number || 0) < 1)
    .sort((a, b) => {
      const time = new Date(a.suggestion.generatedAt || 0).getTime()
        - new Date(b.suggestion.generatedAt || 0).getTime();
      return time || a.index - b.index;
    });
  for (const { suggestion } of missing) assigned.set(suggestion.id, ++highest);
  const nextSuggestionNumber = Math.max(session.nextSuggestionNumber || 1, highest + 1);
  if (assigned.size === 0 && session.nextSuggestionNumber === nextSuggestionNumber) return session;
  return {
    ...session,
    suggestions: session.suggestions.map((suggestion) => assigned.has(suggestion.id)
      ? { ...suggestion, number: assigned.get(suggestion.id) }
      : suggestion),
    nextSuggestionNumber,
  };
}

export function applyBriefSuggestionDecision<T extends ManageableBriefSession>(
  session: T,
  suggestionId: string,
  decision: BriefSuggestionDecision,
  replacementSuggestion: BriefSuggestion | null,
  changedAt: string,
): { session: T; replacementSuggestion: BriefSuggestion | null } {
  const target = session.suggestions.find((item) => item.id === suggestionId);
  if (!target || decision.disposition === "keep") {
    return { session, replacementSuggestion: null };
  }

  const replacement = decision.disposition === "replace" && replacementSuggestion
    ? {
        ...replacementSuggestion,
        number: session.nextSuggestionNumber || (
          session.suggestions.reduce((max, item) => Math.max(max, item.number || 0), 0) + 1
        ),
        generatedAt: changedAt,
        contextId: target.contextId,
        lifecycle: { state: "active" as const, reason: "", changedAt },
        replacesSuggestionId: target.id,
      }
    : null;
  const state = replacement ? "replaced" as const : "withdrawn" as const;
  const suggestions = session.suggestions.map((item) =>
    item.id === suggestionId
      ? {
          ...item,
          lifecycle: {
            state,
            reason: decision.reason,
            changedAt,
            replacementSuggestionId: replacement?.id || null,
          },
        }
      : item,
  );
  if (replacement && !suggestions.some((item) => item.id === replacement.id)) {
    suggestions.unshift(replacement);
  }
  return {
    session: {
      ...session,
      suggestions,
      nextSuggestionNumber: replacement
        ? Math.max(session.nextSuggestionNumber || 1, (replacement.number || 0) + 1)
        : session.nextSuggestionNumber,
      supersededSuggestionIds: [...new Set([...session.supersededSuggestionIds, suggestionId])],
    },
    replacementSuggestion: replacement,
  };
}

export function setBriefSuggestionArchived<T extends ManageableBriefSession>(
  session: T,
  suggestionId: string,
  archived: boolean,
): T | null {
  if (!session.suggestions.some((item) => item.id === suggestionId)) return null;
  const ids = archived
    ? [...new Set([...session.dismissedSuggestionIds, suggestionId])]
    : session.dismissedSuggestionIds.filter((id) => id !== suggestionId);
  return { ...session, dismissedSuggestionIds: ids };
}

export function deleteBriefSuggestion<T extends ManageableBriefSession>(
  session: T,
  suggestionId: string,
): T | null {
  if (!session.suggestions.some((item) => item.id === suggestionId)) return null;
  return {
    ...session,
    suggestions: session.suggestions.filter((item) => item.id !== suggestionId),
    exchanges: session.exchanges.filter((item) => item.suggestionId !== suggestionId),
    actionRuns: session.actionRuns.filter((item) => item.suggestionId !== suggestionId),
    dismissedSuggestionIds: session.dismissedSuggestionIds.filter((id) => id !== suggestionId),
    supersededSuggestionIds: session.supersededSuggestionIds.filter((id) => id !== suggestionId),
  };
}
