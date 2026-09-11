import assert from "node:assert/strict";
import {
  applyBriefSuggestionDecision,
  deleteBriefSuggestion,
  normalizeBriefSuggestionNumbers,
  setBriefSuggestionArchived,
  type ManageableBriefSession,
} from "../src/main/brief-session-management";

const session: ManageableBriefSession & { generatedAt: string } = {
  generatedAt: "2026-09-11T00:00:00.000Z",
  suggestions: [
    { id: "current", title: "current", reason: "r", action: "keywords" as const, target: null, proposedActions: [] },
    { id: "old", title: "old", reason: "r", action: "keywords" as const, target: null, proposedActions: [] },
  ],
  exchanges: [
    { suggestionId: "old", question: "why" },
    { suggestionId: null, question: "general" },
  ],
  actionRuns: [{ suggestionId: "old", id: "run-old" }],
  dismissedSuggestionIds: [],
  supersededSuggestionIds: ["old"],
};

const archived = setBriefSuggestionArchived(session, "current", true);
assert.deepEqual(archived?.dismissedSuggestionIds, ["current"]);
assert.deepEqual(
  setBriefSuggestionArchived(archived!, "current", false)?.dismissedSuggestionIds,
  [],
);
assert.equal(setBriefSuggestionArchived(session, "missing", true), null);

const deleted = deleteBriefSuggestion(session, "old");
assert.deepEqual(deleted?.suggestions, [session.suggestions[0]]);
assert.deepEqual(deleted?.exchanges, [{ suggestionId: null, question: "general" }]);
assert.deepEqual(deleted?.actionRuns, []);
assert.deepEqual(deleted?.supersededSuggestionIds, []);
assert.equal(deleteBriefSuggestion(session, "missing"), null);

const numbered = normalizeBriefSuggestionNumbers({
  ...session,
  suggestions: [
    { ...session.suggestions[1], generatedAt: "2026-09-11T02:00:00.000Z" },
    { ...session.suggestions[0], generatedAt: "2026-09-11T01:00:00.000Z" },
  ],
});
assert.equal(numbered.suggestions.find((item) => item.id === "current")?.number, 1);
assert.equal(numbered.suggestions.find((item) => item.id === "old")?.number, 2);
assert.equal(numbered.nextSuggestionNumber, 3);

const withdrawn = applyBriefSuggestionDecision(
  session,
  "current",
  { disposition: "withdraw", reason: "原产品假设不成立" },
  null,
  "2026-09-11T01:00:00.000Z",
);
assert.equal(withdrawn.session.suggestions[0].lifecycle?.state, "withdrawn");
assert.equal(withdrawn.session.supersededSuggestionIds.includes("current"), true);

const replacement = {
  id: "replacement",
  title: "降低海报宣传权重",
  reason: "搜索侧没有需求证据",
  action: "release" as const,
  target: "商店文案",
  proposedActions: [],
};
const replaced = applyBriefSuggestionDecision(
  numbered,
  "current",
  { disposition: "replace", reason: "新的文案方向取代原关键词建议" },
  replacement,
  "2026-09-11T02:00:00.000Z",
);
assert.equal(replaced.session.suggestions[0].id, "replacement");
assert.equal(replaced.session.suggestions[0].replacesSuggestionId, "current");
assert.equal(replaced.session.suggestions[0].number, 3);
assert.equal(replaced.session.nextSuggestionNumber, 4);
assert.equal(
  replaced.session.suggestions.find((item) => item.id === "current")?.lifecycle?.replacementSuggestionId,
  "replacement",
);

console.log("brief session management tests passed");
