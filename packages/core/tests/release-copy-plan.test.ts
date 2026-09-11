import assert from "node:assert/strict";
import { generateStoreSubmissionContent } from "../src/ai/release-reviewer";
import type { AIProvider, ChatMessage } from "../src/ai/ai-provider";
import { createCopyPlanItem } from "../src/copy-plan";

const calls: ChatMessage[][] = [];
const responses = [
  JSON.stringify({ summary: "本次发布摘要", promotionAngles: ["安心夜行"] }),
  JSON.stringify({
    name: "GloWalk: Night Walk",
    subtitle: "Walk with confidence",
    promotionalText: "Feel safer after dark.",
    description: "A calm companion for walking after dark.",
    whatsNew: "Improved route stability.",
    keywords: "night,walk,safety",
  }),
];
const provider = {
  async chat(messages: ChatMessage[]) {
    calls.push(messages);
    return responses.shift() || "{}";
  },
} as AIProvider;

const plan = createCopyPlanItem({
  projectId: "project-1",
  productId: "product-1",
  source: "manual",
  input: {
    title: "突出离线安心感",
    instruction: "在描述中清楚解释离线使用体验。",
    reason: "用户关心网络依赖",
    fields: ["description"],
    languages: ["en"],
  },
  id: "plan-1",
  now: "2026-09-11T00:00:00.000Z",
});

async function main() {
await generateStoreSubmissionContent(provider, {
  name: "GloWalk",
  description: "Night walking companion with offline route recording.",
  language: "en",
  trackedKeywords: [],
  currentSubmissionKeywords: [],
  recentRankings: [],
  release: {
    id: "release-1",
    tag: "v1.2.0",
    name: "v1.2.0",
    body: "Improved route stability.",
    publishedAt: "2026-09-11T00:00:00.000Z",
    url: "https://example.invalid/release",
    material: null,
    source: "github-release",
    githubDraft: false,
    draft: true,
    commitSha: "abc123",
  },
  includedChanges: ["Improved route stability"],
  copyPlanItems: [plan],
});

assert.equal(calls.length, 2, "global and localized generation both run");
assert.equal(calls[0].some((message) => message.content.includes("突出离线安心感")), true);
assert.equal(calls[1].some((message) => message.content.includes("突出离线安心感")), true);
assert.match(calls[1][0].content, /not product evidence/);
assert.match(calls[1][0].content, /must not add content to whatsNew/);

console.log("release copy-plan tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
