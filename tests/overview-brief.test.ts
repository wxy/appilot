/**
 * Overview AI brief engine tests
 * Run: npm test (tsx tests/overview-brief.test.ts)
 */

import {
  briefActionCapability,
  parseBriefSuggestions,
  briefSuggestionId,
  buildBriefFollowupMessages,
  buildBriefMessages,
  filterActionableBriefSuggestions,
  filterSupportedBriefActions,
  generateOverviewBrief,
  normalizeBriefFollowupResponse,
  normalizeBriefProposedActions,
} from "@appilot-labs/appilot-core/ai/overview-brief";
import { buildProjectProfile } from "@appilot-labs/appilot-core/project-profile";
import { briefRuleSignals } from "../src/renderer/lib/overview-brief";

let errors = 0;
function assert(condition: boolean, msg: string) {
  if (!condition) { console.error(`❌ FAIL: ${msg}`); errors++; }
  else { console.log(`✅ PASS: ${msg}`); }
}

// 1. parseBriefSuggestions
const raw = JSON.stringify({
  suggestions: [
    { title: "把 night walk 加入跟踪", reason: "美区 #5 → #12", action: "keywords", target: "night walk", proposedActions: [{ kind: "keyword.open", label: "查看关键词", language: "en", keyword: "night walk", storefront: "us" }] },
    { title: "补齐英文文案", reason: "3/8 语言未完成", action: "release", target: null },
    { title: "坏条目", reason: "x", action: "bogus", target: "" },
    { title: "多余的第 4 条", reason: "x", action: "keywords", target: null },
  ],
});
const parsed = parseBriefSuggestions(raw);
assert(parsed.length === 3, "parse: caps at 3 suggestions");
assert(parsed[0].action === "keywords" && parsed[0].target === "night walk", "parse: fields preserved");
assert(parsed[0].proposedActions[0]?.kind === "keyword.open", "parse: structured proposed action preserved");
assert(
  normalizeBriefProposedActions([{ kind: "keyword.remove", label: "移除", language: "en", keyword: "night walk" }])[0]?.requiresConfirmation === true,
  "parse: mutating keyword action requires confirmation",
);
assert(
  briefActionCapability("keyword.pause").recommendationEligible === true &&
    briefActionCapability("keyword.open").recommendationEligible === false,
  "capability: Appilot defines effective actions instead of trusting the model",
);
assert(
  normalizeBriefProposedActions([{ kind: "keyword.remove", label: "移除", keyword: "night walk" }]).length === 0,
  "parse: keyword mutation without language is rejected",
);
assert(
  normalizeBriefProposedActions([{
    kind: "keyword.track.add",
    label: "添加跟踪",
    input: { language: "en", keyword: "safe night walk", rationale: "与产品定位一致" },
  }])[0]?.input.rationale === "与产品定位一致",
  "parse: generalized action input preserves validated keyword-add rationale",
);
assert(
  (normalizeBriefProposedActions([{
    kind: "copy-plan.add",
    label: "添加文案计划",
    input: {
      title: "突出安心感",
      instruction: "在描述中说明离线能力。",
      reason: "用户反复询问",
      fields: ["description", "whatsNew"],
      languages: ["en"],
    },
  }])[0]?.input.fields as string[])?.join() === "description",
  "parse: copy-plan action accepts only registered copy fields and excludes whatsNew",
);
assert(
  normalizeBriefProposedActions([{ kind: "keyword.open", label: "查看", keyword: "night walk" }]).length === 0,
  "parse: specific keyword view without language is rejected",
);
assert(
  normalizeBriefFollowupResponse({ answer: "**结论**", proposedActions: [{ kind: "release.open", label: "查看发布" }] }).proposedActions[0]?.kind === "release.open",
  "parse: follow-up markdown answer and actions",
);
const withdrawnFollowup = normalizeBriefFollowupResponse({
  answer: "原建议建立在错误假设上。",
  proposedActions: [],
  suggestionDecision: { disposition: "withdraw", reason: "用户不会为海报功能主动搜索应用" },
});
assert(
  withdrawnFollowup.suggestionDecision.disposition === "withdraw"
    && withdrawnFollowup.suggestionDecision.reason.includes("海报"),
  "parse: follow-up can explicitly withdraw the original suggestion",
);
const replacementFollowup = normalizeBriefFollowupResponse({
  answer: "改为降低海报宣传权重。",
  suggestionDecision: { disposition: "replace", reason: "获客假设不成立" },
  replacementSuggestion: {
    title: "降低海报功能在商店文案中的权重",
    reason: "海报词没有搜索侧需求证据",
    expectedOutcome: "主文案更贴近照明需求",
    successMetric: "下一版本商店转化率不低于当前基线",
    evaluateAfterDays: 14,
    action: "release",
    target: "商店文案",
    proposedActions: [{
      kind: "copy-plan.add",
      label: "加入文案计划",
      input: {
        title: "降低海报宣传权重",
        instruction: "主推照明能力，把海报移到功能列表后部。",
        reason: "海报词没有排名信号",
        fields: ["description"],
        languages: ["en"],
      },
    }],
  },
});
assert(
  replacementFollowup.suggestionDecision.disposition === "replace"
    && replacementFollowup.replacementSuggestion?.proposedActions[0]?.kind === "copy-plan.add",
  "parse: follow-up replacement is a complete standalone suggestion",
);

const followupProfile = buildProjectProfile({
  name: "GloWalk",
  platform: "ios",
  supportedLanguages: ["en"],
  description: "A night walking companion.",
  readme: "# GloWalk\n\nWalk safely and record a path of light.",
});
const followupSuggestion = parsed[0];
const followupArgs = {
  profile: followupProfile,
  systemPrompt: "Follow up on the prior suggestion and output JSON.",
  evidenceContext: JSON.stringify({ keywordStats: { tracked: 34 }, keywordInventory: { active: ["night walk"] } }),
  fallbackBriefContext: "fallback",
  numberedSuggestionContext: "建议 1=把 night walk 加入跟踪",
  targetSuggestion: followupSuggestion,
  targetSuggestionNumber: 1,
  exchanges: [
    { suggestionId: "another", question: "unrelated question", answer: "unrelated answer" },
    { suggestionId: followupSuggestion.id, question: "为什么？", answer: "因为排名下滑", proposedActions: followupSuggestion.proposedActions },
  ],
  maxExchanges: 6,
  question: "应该等待吗？",
};
const followupMessages = buildBriefFollowupMessages(followupArgs);
assert(
  followupMessages[0].content.startsWith("Appilot project archive") &&
    followupMessages[1].content.includes("\"tracked\":34"),
  "follow-up: stable project archive and original evidence are restored",
);
assert(
  followupMessages[2].role === "assistant" &&
    followupMessages[2].content.includes(followupSuggestion.reason) &&
    followupMessages[2].content.includes("proposedActions"),
  "follow-up: complete original suggestion is restored as assistant context",
);
assert(
  !followupMessages.some((message) => message.content.includes("unrelated question")) &&
    followupMessages.some((message) => message.content === "为什么？"),
  "follow-up: history is scoped to the selected suggestion",
);
const laterFollowup = buildBriefFollowupMessages({
  ...followupArgs,
  exchanges: [
    ...followupArgs.exchanges,
    { suggestionId: followupSuggestion.id, question: "应该等待吗？", answer: "先验证" },
  ],
  question: "下一步呢？",
});
assert(
  followupMessages.slice(0, 3).map((message) => message.content).join("\u0000") ===
    laterFollowup.slice(0, 3).map((message) => message.content).join("\u0000"),
  "follow-up: archive, evidence, and original suggestion form a reusable prefix",
);
const resultFollowup = buildBriefFollowupMessages({
  ...followupArgs,
  postActionEvidenceContext: JSON.stringify({ keywordStats: { tracked: 33 }, actionResult: "paused" }),
  question: "执行结果怎么样？",
});
assert(
  resultFollowup.at(-1)?.content.includes("动作执行后的最新数据快照") === true &&
    resultFollowup.at(-1)?.content.includes("\"tracked\":33") === true,
  "follow-up: completed action evidence is appended for before/after assessment",
);
assert(
  normalizeBriefProposedActions([{ kind: "trend.open", label: "查看长期效果" }]).length === 0,
  "parse: unfinished trend page is not proposed",
);
assert(parsed[1].action === "release", "parse: release action kept");
assert(parsed[2].action === "keywords", "parse: unknown action falls back to keywords");
assert(
  parseBriefSuggestions("```json\n" + raw + "\n```")[0].title === "把 night walk 加入跟踪",
  "parse: code fence tolerated",
);
assert(
  briefSuggestionId("a", "keywords", "b") === briefSuggestionId("a", "keywords", "b"),
  "parse: id is stable",
);
const deduped = parseBriefSuggestions(JSON.stringify({ suggestions: [
  { title: "处理 night walk 下滑", reason: "下降 7 位", action: "trend", target: "night walk" },
  { title: "复盘 night walk", reason: "从 5 到 12", action: "trend", target: "night walk" },
  { title: "补齐发布文案", reason: "3/8", action: "release", target: "v1.2.0" },
] }));
assert(deduped.length === 2 && deduped[1].action === "release", "parse: duplicate actions for the same target are merged");
assert(deduped[0].action === "keywords", "parse: removed trend action falls back to keywords");
const qualityCandidates = parseBriefSuggestions(JSON.stringify({ suggestions: [
  {
    title: "暂停弱相关词",
    reason: "已检查 26 个商店且均未进入前 200",
    expectedOutcome: "减少无效监控目标",
    successMetric: "每日排名查询减少 26 次",
    evaluateAfterDays: 1,
    action: "keywords",
    target: "weak term",
    proposedActions: [{ kind: "keyword.pause", label: "暂停关键词", language: "en", keyword: "weak term" }],
  },
  {
    title: "查看掉榜详情",
    reason: "排名下降",
    expectedOutcome: "了解详情",
    successMetric: "打开页面",
    evaluateAfterDays: 1,
    action: "trend",
    target: "night walk",
    proposedActions: [{ kind: "keyword.open", label: "查看", language: "en", keyword: "night walk" }],
  },
  {
    title: "重新全量刷新",
    reason: "确认数据",
    expectedOutcome: "更新数据",
    successMetric: "收到快照",
    evaluateAfterDays: 1,
    action: "keywords",
    target: null,
    proposedActions: [{ kind: "rank.collect", label: "刷新", language: "en" }],
  },
] }));
assert(
  filterActionableBriefSuggestions(qualityCandidates).map((item) => item.title).join() === "暂停弱相关词",
  "quality: view-only and collection-only observations are not recommendations",
);
const effectiveAndView = normalizeBriefProposedActions([
  { kind: "keyword.pause", label: "暂停", language: "en", keyword: "weak term" },
  { kind: "keyword.open", label: "查看", language: "en", keyword: "weak term" },
]);
assert(
  filterSupportedBriefActions(effectiveAndView).map((action) => action.kind).join() === "keyword.pause",
  "capability: navigation is removed even when attached to an effective action",
);
assert(
  filterSupportedBriefActions(effectiveAndView, {
    active: [],
    paused: [{ language: "en", keyword: "weak term" }],
    removed: [],
  }).length === 0,
  "capability: an action that does not match current state is rejected",
);
const addKeyword = normalizeBriefProposedActions([{
  kind: "keyword.track.add",
  label: "添加跟踪",
  input: { language: "en", keyword: "new term", rationale: "相关且尚未跟踪" },
}]);
assert(
  filterSupportedBriefActions(addKeyword, {
    active: [],
    paused: [],
    removed: [],
  }).length === 1,
  "capability: missing keyword can be proposed for tracking",
);
assert(
  filterSupportedBriefActions(addKeyword, {
    active: [],
    paused: [],
    removed: [{ language: "en", keyword: "new term", removedAt: null }],
  }).length === 0,
  "capability: removed keyword must use restore instead of add",
);
const missingReviewWindow = parseBriefSuggestions(JSON.stringify({ suggestions: [{
  title: "缺少复核时间",
  reason: "词表需要整理",
  expectedOutcome: "减少无效监控目标",
  successMetric: "每日查询减少 26 次",
  action: "keywords",
  target: "another weak term",
  proposedActions: [{ kind: "keyword.pause", label: "暂停", language: "en", keyword: "another weak term" }],
}] }));
assert(
  filterActionableBriefSuggestions(missingReviewWindow).length === 0,
  "quality: a measurable recommendation also needs a review window",
);

// 2. buildBriefMessages
const input: any = {
  name: "GloWalk",
  description: "Night walking app",
  platform: "ios",
  supportedLanguages: ["en", "zh-Hans"],
  storefrontCoverage: [{ language: "en", storefronts: ["us", "es"] }],
  keywordStats: { tracked: 10, ranked: 4, top10: 2, paused: 1 },
  keywordInventory: {
    active: [
      { keyword: "night walk", language: "en" },
      { keyword: "weak term", language: "en" },
    ],
    paused: [],
    removed: [],
  },
  keywordRankDetails: [{ keyword: "night walk", language: "en", checkedStorefronts: 1, rankedStorefronts: 1, unrankedStorefronts: 0, top10Storefronts: 0, bestRanks: [{ storefront: "us", rank: 12 }], weakestRanks: [], latestCheckedAt: new Date().toISOString() }],
  rankMovers: [{ keyword: "night walk", language: "en", storefront: "us", previousRank: 5, currentRank: 12, delta: -7 }],
  detectedIssues: [{ id: "rank-drop", category: "ranking", severity: "medium", title: "night walk 显著掉榜", evidence: "美区从第 5 名降至第 12 名", action: "keywords", target: "night walk" }],
  release: { tag: "v1.2.0", languageProgress: 3, languageTotal: 8, masterConfirmed: true, batchConfirmed: false, storeStatus: "prepared" },
  submissionKeywordCount: 12,
  uiLanguage: "zh-Hans",
};
const messages = buildBriefMessages(input);
const joined = messages.map((m) => m.content).join("\n");
assert(joined.includes("GloWalk") && joined.includes("night walk") && joined.includes("v1.2.0"), "buildBriefMessages: context embedded");
assert(messages[0].role === "system", "buildBriefMessages: system prompt first");
assert(joined.includes("detectedIssues") && joined.includes("优先处理 high"), "buildBriefMessages: deterministic issues drive prioritization");
assert(joined.includes("storefrontCoverage") && joined.includes("不能扩大覆盖"), "buildBriefMessages: collection refresh is distinct from storefront coverage");
assert(joined.includes("不要复述这些状态") && joined.includes("不同的决策"), "buildBriefMessages: avoids dashboard repetition and fragmented advice");
assert(
  joined.includes("不得输出 detectedIssues") &&
    joined.includes("Appilot 有效动作目录") && joined.includes('"appliesTo":"active"'),
  "buildBriefMessages: internal fields stay out of copy and only effective actions are offered",
);

// 4. buildBriefMessages with competitor deltas
const themedInput: any = {
  ...input,
  competitorDeltas: [{ name: "Comp", change: "v1.0 → v1.1" }],
};
const themedMessages = buildBriefMessages(themedInput);
const themedJoined = themedMessages.map((m) => m.content).join("\n");
assert(themedJoined.includes("Comp"), "buildBriefMessages: competitor context is embedded");
assert(!themedMessages[0].content.includes('"name": "Comp"') && themedMessages[1].content.includes('"name": "Comp"'), "buildBriefMessages: volatile evidence stays out of cacheable system prefix");

// 3. Renderer rule signals
const signals = briefRuleSignals({
  rankRows: [
    { keyword: "night walk", language: "en", bestRank: 12, trend: "down" },
    { keyword: "记账", language: "zh-Hans", bestRank: 3, trend: "up" },
  ],
  trackedActiveCount: 8,
  pausedCount: 2,
  pendingPauseCount: 0,
  languageTotal: 8,
  generatedLanguageCount: 3,
});
assert(signals.length === 3, "rules: emits up to 3 signals");
assert(signals[0].action === "keywords" && signals[0].target === "night walk", "rules: dropout first");
assert(signals[1].action === "release", "rules: incomplete languages signal");
assert(signals[2].id === "rule-paused", "rules: paused signal when keywords exist");
assert(
  briefRuleSignals({ rankRows: [], trackedActiveCount: 0, pausedCount: 0, pendingPauseCount: 0, languageTotal: 0, generatedLanguageCount: 0 })
    .some((s) => s.id === "rule-no-keywords"),
  "rules: no-keywords signal when empty",
);
assert(
  briefRuleSignals({
    rankRows: [],
    trackedActiveCount: 3,
    pausedCount: 0,
    pendingPauseCount: 4,
    languageTotal: 8,
    generatedLanguageCount: 8,
  }).some((s) => s.id === "rule-pending-pause" && s.title.includes("4")),
  "rules: pending-pause review signal",
);

// 4. generateOverviewBrief with a stub provider
void (async () => {
  let captured: any = null;
  const actionableRaw = JSON.stringify({ suggestions: [
    {
      title: "暂停弱相关词",
      reason: "26 个商店均未进入前 200",
      expectedOutcome: "减少无效监控目标",
      successMetric: "每日查询减少 26 次",
      evaluateAfterDays: 1,
      action: "keywords",
      target: "weak term",
      proposedActions: [{ kind: "keyword.pause", label: "暂停", language: "en", keyword: "weak term" }],
    },
  ] });
  const stubProvider: any = {
    chat: async (msgs: any, opts?: any) => {
      captured = { msgs, opts };
      return actionableRaw;
    },
  };
  const generated = await generateOverviewBrief(stubProvider, input);
  assert(Boolean(generated.length === 1 && generated[0].successMetric), "generate: returns only measurable state-changing suggestions");
  const noAdvice = await generateOverviewBrief({
    chat: async () => JSON.stringify({ suggestions: [{
      title: "查看排名",
      reason: "排名变化",
      expectedOutcome: "看见数据",
      successMetric: "页面打开",
      evaluateAfterDays: 1,
      action: "trend",
      target: "night walk",
      proposedActions: [{ kind: "keyword.open", label: "查看", language: "en", keyword: "night walk" }],
    }] }),
  } as any, input);
  assert(noAdvice.length === 0, "generate: returns no advice instead of padding with observations");
  assert(captured.opts.responseFormat === "json_object", "generate: requests json_object");
  assert(captured.opts.maxTokens === 2400, "generate: concise output token cap");

  if (errors === 0) console.log("\nAll overview-brief tests passed ✅");
  else { console.error(`\n${errors} test(s) failed ❌`); process.exit(1); }
})();
