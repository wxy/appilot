# 总览副驾驶简报 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在总览页顶部新增「副驾驶简报」卡：先以确定性规则信号占位，再接入 AI 生成 ≤3 条可采纳/忽略的运营建议，动作日志持久化到项目记录。

**Architecture:** 引擎层新增 `src/engine/overview-summary.ts`（纯函数：排名变化计算、简报输入组装）与 `src/engine/ai/overview-brief.ts`（prompt 构建、JSON 解析、AI 调用），主进程新增 `projects:generateBrief` / `projects:recordBriefAction` IPC，渲染层新增 `src/renderer/lib/overview-brief.ts`（规则信号纯函数）并在 `OverviewPage` 渲染卡片。建议 id 由内容哈希生成，动作日志按 id 去重持久化在项目记录。

**Tech Stack:** TypeScript / React 19 + Tailwind / electron-vite；AI 调用复用现有 `AIProvider.chat`（OpenAI 兼容）；测试沿用 `tsx tests/*.test.ts`。

**Spec:** [docs/superpowers/specs/overview-ai-brief.md](../specs/overview-ai-brief.md)

## Global Constraints

- 分支：先在当前 `codex/overview-wip` 提交本轮未提交的总览工作，再从当前 HEAD 新建 `codex/overview-ai-brief`。
- 不做新依赖；不引入 React 测试框架，纯逻辑抽到 `tsx` 测试。
- `package.json` 的 `test` 与 `test:ci` 必须同步加入每个新测试文件。
- 每个任务结束时 `npm run typecheck` 与相关测试必须通过，并单独提交。
- 简报只建议不执行：采纳只记录 + 跳转内部页面（`/keywords`、`/release`、`/trend`）。
- 建议 `id` 必须稳定（内容哈希），用于去重；动作日志 `briefActions` 按 id upsert，上限 200。
- UI 保持总览一页布局：卡片紧凑（py-2 行、小字号），不引入滚动。
- 术语与现有页面一致（中文）；`action` 值只用 `keywords | release | trend`。

---

### Task 0: 基线提交与建分支

**Files:**
- Modify: `docs/superpowers/plans/2026-08-20-overview-ai-brief.md`（本文件，提交用）
- Modify: `docs/superpowers/specs/overview-ai-brief.md`

**Interfaces:**
- Consumes: 当前 `codex/overview-wip` 工作区（含未提交的总览页/P1 改动）
- Produces: 干净分支 `codex/overview-ai-brief`

- [ ] **Step 1: 确认工作区状态**

Run: `git status --short`
Expected: 存在未提交改动（`src/renderer/App.tsx`、`src/main/ipc.ts`、`src/preload/index.ts`、`src/renderer/stores/project.ts`、`src/engine/git-info.ts`、`tests/git-info.test.ts`、`package.json`、两份本 plan 文档）。

- [ ] **Step 2: 提交总览页现有工作（代码）**

```bash
git add src tests package.json
git commit -m "feat: 总览页一页布局、排名趋势图、仓库信息与发布摘要、平台切换"
```

- [ ] **Step 3: 提交设计文档**

```bash
git add docs/superpowers/specs/overview-ai-brief.md docs/superpowers/plans/2026-08-20-overview-ai-brief.md
git commit -m "docs: 总览副驾驶简报设计规格与实施计划"
```

- [ ] **Step 4: 建分支并验证基线**

```bash
git checkout -b codex/overview-ai-brief
npm run typecheck && npm test
```

Expected: typecheck 通过，全部测试通过。

---

### Task 1: 引擎纯函数 `overview-summary`

**Files:**
- Create: `src/engine/overview-summary.ts`
- Create: `tests/overview-summary.test.ts`
- Modify: `package.json`（test / test:ci 追加 `tests/overview-summary.test.ts`）

**Interfaces:**
- Consumes: `RankSnapshot` 形状 `{ keyword; language; storefront; rank: number | null; checkedAt }`
- Produces:
  - `RankMover { keyword; language; storefront; previousRank: number | null; currentRank: number; delta: number | null }`
  - `computeRankMovers(snapshots: RankSnapshotLike[], days?: number): RankMover[]`
  - `OverviewBriefInput`（Task 2 / Task 3 消费）
  - `buildBriefInput(args): OverviewBriefInput`

- [ ] **Step 1: 写失败测试**

创建 `tests/overview-summary.test.ts`：

```ts
/**
 * Overview summary pure-function tests
 * Run: npm test (tsx tests/overview-summary.test.ts)
 */

import { computeRankMovers, buildBriefInput } from "../src/engine/overview-summary";

let errors = 0;
function assert(condition: boolean, msg: string) {
  if (!condition) { console.error(`❌ FAIL: ${msg}`); errors++; }
  else { console.log(`✅ PASS: ${msg}`); }
}

const now = Date.now();
const iso = (hoursAgo: number) => new Date(now - hoursAgo * 3600 * 1000).toISOString();
const snapshots = [
  { keyword: "night walk", language: "en", storefront: "us", rank: 5, totalResults: 1, checkedAt: iso(30) },
  { keyword: "night walk", language: "en", storefront: "us", rank: 12, totalResults: 1, checkedAt: iso(2) },
  { keyword: "记账", language: "zh-Hans", storefront: "hk", rank: null, totalResults: 1, checkedAt: iso(3) },
  { keyword: "记账", language: "zh-Hans", storefront: "hk", rank: 8, totalResults: 1, checkedAt: iso(1) },
  { keyword: "old", language: "en", storefront: "us", rank: 1, totalResults: 1, checkedAt: iso(20 * 24) },
];

const movers = computeRankMovers(snapshots as any);
const night = movers.find((m) => m.keyword === "night walk");
assert(night?.delta === -7, "computeRankMovers: drop delta is negative");
assert(night?.previousRank === 5 && night?.currentRank === 12, "computeRankMovers: prev/current ranks");
const note = movers.find((m) => m.keyword === "记账");
assert(note?.delta === null && note?.currentRank === 8, "computeRankMovers: new entry has null delta");
assert(!movers.some((m) => m.keyword === "old"), "computeRankMovers: outside window excluded");

const input = buildBriefInput({
  projectName: "GloWalk",
  productName: "GloWalk",
  description: "Night walking app",
  platform: "ios",
  supportedLanguages: ["en", "zh-Hans"],
  trackedKeywords: [
    { keyword: "night walk", language: "en", status: "active" },
    { keyword: "old", language: "en", status: "paused" },
  ],
  rankSnapshots: snapshots as any,
  releaseDraft: { name: "v1.2.0", tag: "v1.2.0" },
  submissionDraft: {
    localizations: [{ language: "en", name: "GloWalk", subtitle: "", promotionalText: "", description: "", whatsNew: "", keywords: "" }],
    storeStatus: "prepared",
  },
  submissionKeywords: [{ language: "en", text: "night walk, walk" }],
});
assert(input.name === "GloWalk", "buildBriefInput: name");
assert(input.keywordStats.tracked === 1 && input.keywordStats.paused === 1, "buildBriefInput: keyword stats");
assert(input.keywordStats.ranked === 1 && input.keywordStats.top10 === 1, "buildBriefInput: ranked/top10 from snapshots (night walk best #5 in window)");
assert(input.release?.tag === "v1.2.0", "buildBriefInput: release tag");
assert(input.submissionKeywordCount === 2, "buildBriefInput: submission keyword count");

if (errors === 0) console.log("\nAll overview-summary tests passed ✅");
else { console.error(`\n${errors} test(s) failed ❌`); process.exit(1); }
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx tests/overview-summary.test.ts`
Expected: FAIL（模块不存在 / 函数未定义）。

- [ ] **Step 3: 实现 `src/engine/overview-summary.ts`**

```ts
/**
 * Overview summary pure functions: rank-change detection and AI brief input.
 */

export interface RankSnapshotLike {
  keyword: string;
  language: string;
  storefront: string;
  rank: number | null;
  checkedAt: string;
}

export interface RankMover {
  keyword: string;
  language: string;
  storefront: string;
  previousRank: number | null;
  currentRank: number;
  delta: number | null; // positive = improved
}

export function computeRankMovers(snapshots: RankSnapshotLike[], days = 14): RankMover[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const byKey = new Map<string, RankSnapshotLike[]>();
  for (const snapshot of snapshots) {
    if (new Date(snapshot.checkedAt).getTime() < cutoff) continue;
    const key = `${snapshot.keyword}\u0000${snapshot.language}\u0000${snapshot.storefront}`;
    const list = byKey.get(key) || [];
    list.push(snapshot);
    byKey.set(key, list);
  }
  const movers: RankMover[] = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => new Date(a.checkedAt).getTime() - new Date(b.checkedAt).getTime());
    const current = list[list.length - 1];
    if (current.rank == null) continue;
    let previous: RankSnapshotLike | null = null;
    for (let i = list.length - 2; i >= 0; i--) {
      if (list[i].rank != null) { previous = list[i]; break; }
    }
    movers.push({
      keyword: current.keyword,
      language: current.language,
      storefront: current.storefront,
      previousRank: previous?.rank ?? null,
      currentRank: current.rank,
      delta: previous?.rank != null ? previous.rank - current.rank : null,
    });
  }
  movers.sort((a, b) => {
    const aScore = a.delta != null ? Math.abs(a.delta) : 999;
    const bScore = b.delta != null ? Math.abs(b.delta) : 999;
    return bScore - aScore;
  });
  return movers.slice(0, 15);
}

export interface OverviewBriefInput {
  name: string;
  description: string;
  platform: string;
  supportedLanguages: string[];
  keywordStats: { tracked: number; ranked: number; top10: number; paused: number };
  rankMovers: RankMover[];
  release: {
    tag: string;
    languageProgress: number;
    languageTotal: number;
    masterConfirmed: boolean;
    batchConfirmed: boolean;
    storeStatus: string | null;
  } | null;
  submissionKeywordCount: number;
  uiLanguage: string;
}

export function buildBriefInput(args: {
  projectName: string;
  productName: string;
  description: string;
  platform: string;
  supportedLanguages: string[];
  trackedKeywords: { keyword?: string; language?: string; status?: string }[];
  rankSnapshots: RankSnapshotLike[];
  days?: number;
  releaseDraft: { name?: string | null; tag: string } | null;
  submissionDraft: {
    localizations?: {
      name?: string; subtitle?: string; promotionalText?: string;
      description?: string; whatsNew?: string; keywords?: string;
    }[];
    masterConfirmedAt?: string;
    batchConfirmedAt?: string;
    storeStatus?: string;
  } | null;
  submissionKeywords: { text?: string }[];
}): OverviewBriefInput {
  const days = args.days ?? 14;
  const active = args.trackedKeywords.filter((k) => k.status !== "paused");
  const activeKeys = new Set(
    active.map((k) => `${k.keyword ?? ""}\u0000${k.language ?? ""}`),
  );
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const bestByKeyword = new Map<string, number>();
  for (const snapshot of args.rankSnapshots) {
    if (snapshot.rank == null || new Date(snapshot.checkedAt).getTime() < cutoff) continue;
    const key = `${snapshot.keyword}\u0000${snapshot.language}`;
    if (!activeKeys.has(key)) continue;
    const prev = bestByKeyword.get(key);
    if (prev === undefined || snapshot.rank < prev) bestByKeyword.set(key, snapshot.rank);
  }
  const ranked = bestByKeyword.size;
  const top10 = [...bestByKeyword.values()].filter((rank) => rank <= 10).length;

  const localizations = args.submissionDraft?.localizations || [];
  const generatedLanguageCount = localizations.filter((loc) =>
    [loc.name, loc.subtitle, loc.promotionalText, loc.description, loc.whatsNew, loc.keywords]
      .some((value) => value && String(value).trim()),
  ).length;
  const submissionKeywordCount = args.submissionKeywords
    .flatMap((item) => String(item.text || "").split(","))
    .map((item) => item.trim())
    .filter(Boolean).length;

  return {
    name: args.productName || args.projectName,
    description: args.description || "",
    platform: args.platform,
    supportedLanguages: args.supportedLanguages,
    keywordStats: {
      tracked: active.length,
      ranked,
      top10,
      paused: args.trackedKeywords.length - active.length,
    },
    rankMovers: computeRankMovers(args.rankSnapshots, days),
    release: args.releaseDraft
      ? {
          tag: args.releaseDraft.tag,
          languageProgress: generatedLanguageCount,
          languageTotal: args.supportedLanguages.length || localizations.length,
          masterConfirmed: Boolean(args.submissionDraft?.masterConfirmedAt),
          batchConfirmed: Boolean(args.submissionDraft?.batchConfirmedAt),
          storeStatus: args.submissionDraft?.storeStatus ?? null,
        }
      : null,
    submissionKeywordCount,
    uiLanguage: "zh-Hans",
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx tests/overview-summary.test.ts`
Expected: PASS。

- [ ] **Step 5: 同步测试脚本并提交**

修改 `package.json` 的 `test` 与 `test:ci`，在 `tests/errors.test.ts` 后追加 `&& tsx tests/overview-summary.test.ts`。

```bash
npm run typecheck
npx tsx tests/overview-summary.test.ts
git add src/engine/overview-summary.ts tests/overview-summary.test.ts package.json
git commit -m "feat: 总览简报排名变化与输入组装纯函数"
```

---

### Task 2: AI 简报引擎 `overview-brief`

**Files:**
- Modify: `src/engine/ai/keyword-suggester.ts`（导出 `parseJsonObject`）
- Create: `src/engine/ai/overview-brief.ts`
- Create: `tests/overview-brief.test.ts`
- Modify: `package.json`（test / test:ci 追加 `tests/overview-brief.test.ts`）

**Interfaces:**
- Consumes: `OverviewBriefInput`（Task 1）、`AIProvider.chat(messages, { temperature; maxTokens; thinking; responseFormat; onProgress })`、`parseJsonObject`（本 Task 导出）
- Produces:
  - `BriefAction = "keywords" | "release" | "trend"`
  - `BriefSuggestion { id; title; reason; action: BriefAction; target: string | null }`
  - `briefSuggestionId(title, action, target): string`
  - `buildBriefMessages(input: OverviewBriefInput): ChatMessage[]`
  - `parseBriefSuggestions(raw: string): BriefSuggestion[]`
  - `generateOverviewBrief(provider, input, onProgress?): Promise<BriefSuggestion[]>`

- [ ] **Step 1: 导出 `parseJsonObject`**

`src/engine/ai/keyword-suggester.ts`：将 `function parseJsonObject` 改为 `export function parseJsonObject`。

- [ ] **Step 2: 写失败测试**

创建 `tests/overview-brief.test.ts`：

```ts
/**
 * Overview AI brief engine tests
 * Run: npm test (tsx tests/overview-brief.test.ts)
 */

import {
  parseBriefSuggestions,
  briefSuggestionId,
  buildBriefMessages,
  generateOverviewBrief,
} from "../src/engine/ai/overview-brief";

let errors = 0;
function assert(condition: boolean, msg: string) {
  if (!condition) { console.error(`❌ FAIL: ${msg}`); errors++; }
  else { console.log(`✅ PASS: ${msg}`); }
}

// 1. parseBriefSuggestions
const raw = JSON.stringify({
  suggestions: [
    { title: "把 night walk 加入跟踪", reason: "美区 #5 → #12", action: "keywords", target: "night walk" },
    { title: "补齐英文文案", reason: "3/8 语言未完成", action: "release", target: null },
    { title: "坏条目", reason: "x", action: "bogus", target: "" },
    { title: "多余的第 4 条", reason: "x", action: "keywords", target: null },
  ],
});
const parsed = parseBriefSuggestions(raw);
assert(parsed.length === 3, "parse: caps at 3 suggestions");
assert(parsed[0].action === "keywords" && parsed[0].target === "night walk", "parse: fields preserved");
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

// 2. buildBriefMessages
const input: any = {
  name: "GloWalk",
  description: "Night walking app",
  platform: "ios",
  supportedLanguages: ["en", "zh-Hans"],
  keywordStats: { tracked: 10, ranked: 4, top10: 2, paused: 1 },
  rankMovers: [{ keyword: "night walk", language: "en", storefront: "us", previousRank: 5, currentRank: 12, delta: -7 }],
  release: { tag: "v1.2.0", languageProgress: 3, languageTotal: 8, masterConfirmed: true, batchConfirmed: false, storeStatus: "prepared" },
  submissionKeywordCount: 12,
  uiLanguage: "zh-Hans",
};
const messages = buildBriefMessages(input);
const joined = messages.map((m) => m.content).join("\n");
assert(joined.includes("GloWalk") && joined.includes("night walk") && joined.includes("v1.2.0"), "buildBriefMessages: context embedded");
assert(messages[0].role === "system", "buildBriefMessages: system prompt first");

// 3. generateOverviewBrief with a stub provider
let captured: any = null;
const stubProvider: any = {
  chat: async (msgs: any, opts?: any) => {
    captured = { msgs, opts };
    return raw;
  },
};
const generated = await generateOverviewBrief(stubProvider, input);
assert(generated.length === 3, "generate: returns parsed suggestions");
assert(captured.opts.responseFormat === "json_object", "generate: requests json_object");
assert(captured.opts.maxTokens === 4000, "generate: token cap 4000");

if (errors === 0) console.log("\nAll overview-brief tests passed ✅");
else { console.error(`\n${errors} test(s) failed ❌`); process.exit(1); }
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx tsx tests/overview-brief.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 4: 实现 `src/engine/ai/overview-brief.ts`**

```ts
/**
 * Overview AI brief: generate ≤3 actionable suggestions from real app data.
 */

import type { AIProvider, ChatMessage } from "./ai-provider";
import { parseJsonObject } from "./keyword-suggester";
import type { OverviewBriefInput } from "../overview-summary";
import { EngineError } from "../errors";
import { log } from "../logger";

export type BriefAction = "keywords" | "release" | "trend";

export interface BriefSuggestion {
  id: string;
  title: string;
  reason: string;
  action: BriefAction;
  target: string | null;
}

export function briefSuggestionId(title: string, action: BriefAction, target: unknown): string {
  let hash = 5381;
  const input = `${title}\u0000${action}\u0000${target ?? ""}`;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return `brief-${hash.toString(36)}`;
}

const BRIEF_ACTIONS: BriefAction[] = ["keywords", "release", "trend"];

export function parseBriefSuggestions(raw: string): BriefSuggestion[] {
  const data = parseJsonObject(raw);
  const list = Array.isArray(data.suggestions) ? data.suggestions : [];
  const suggestions: BriefSuggestion[] = [];
  for (const item of list.slice(0, 3)) {
    if (!item || typeof item.title !== "string" || !item.title.trim()) continue;
    const action: BriefAction = BRIEF_ACTIONS.includes(item.action) ? item.action : "keywords";
    const title = item.title.trim();
    suggestions.push({
      id: briefSuggestionId(title, action, item.target),
      title,
      reason: String(item.reason || "").trim(),
      action,
      target: typeof item.target === "string" && item.target ? item.target : null,
    });
  }
  return suggestions;
}

export function buildBriefMessages(input: OverviewBriefInput): ChatMessage[] {
  const system = [
    "你是 Appilot 的运营副驾驶，为独立开发者的 App Store 增长给出简短、可执行的建议。",
    "你只能基于下面给定的真实数据输出建议，reason 必须引用数据，不得编造。",
    "输出一个 JSON 对象：{\"suggestions\":[{\"title\":\"一句话动作\",\"reason\":\"引用数据的依据\",\"action\":\"keywords|release|trend\",\"target\":\"可选辅助信息或 null\"}]}",
    "最多 3 条，按价值排序。action 只能是 keywords、release、trend 之一。title 用中文。",
  ].join("\n");
  const user = JSON.stringify(input, null, 2);
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export async function generateOverviewBrief(
  provider: AIProvider,
  input: OverviewBriefInput,
  onProgress?: (received: { chars: number; phase: "reasoning" | "content" }) => void,
): Promise<BriefSuggestion[]> {
  log.info(`Generating overview brief for ${input.name}`);
  const raw = await provider.chat(buildBriefMessages(input), {
    temperature: 0.3,
    maxTokens: 4000,
    thinking: "disabled",
    responseFormat: "json_object",
    onProgress,
  });
  const suggestions = parseBriefSuggestions(raw);
  if (suggestions.length === 0) {
    throw new EngineError("AI brief returned no suggestions", "BRIEF_EMPTY");
  }
  return suggestions;
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx tsx tests/overview-brief.test.ts`
Expected: PASS。

- [ ] **Step 6: 同步测试脚本并提交**

修改 `package.json` 的 `test` 与 `test:ci`，追加 `&& tsx tests/overview-brief.test.ts`。

```bash
npm run typecheck
npx tsx tests/overview-brief.test.ts
git add src/engine/ai/keyword-suggester.ts src/engine/ai/overview-brief.ts tests/overview-brief.test.ts package.json
git commit -m "feat: 总览副驾驶简报 AI 引擎（prompt、解析、生成）"
```

---

### Task 3: IPC + preload + 动作日志持久化

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Consumes: `buildBriefInput` / `computeRankMovers`（Task 1）、`generateOverviewBrief`（Task 2）、`findProductContext`、`getStoreSubmissionDrafts`、`checkForRelease`、`readRepoDescription`（均已在 ipc.ts 中）
- Produces:
  - IPC `projects:generateBrief(projectId, productId)` → `{ suggestions: BriefSuggestion[]; generatedAt: string }`
  - IPC `projects:recordBriefAction(projectId, { id; action; status })` → 更新后的 project
  - 进度事件 `projects:briefProgress` `{ chars; phase }`
  - preload：`projects.generateBrief`、`projects.recordBriefAction`、`projects.onBriefProgress`
  - 项目记录新增 `briefActions` 字段（上限 200，按 id upsert）

- [ ] **Step 1: 在 `src/main/ipc.ts` 增加两个 handler**

在 `projects:clearRemovedKeywords` handler 之后追加：

```ts
  ipcMain.handle("projects:generateBrief", async (_event, projectId: string, productId: string) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    productId = assertNonEmptyString(productId, "productId");
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const context = findProductContext(projects, productId);
    if (!context) throw new Error("Store product not found");
    const { project, product } = context;

    const { AIProvider } = await import("../engine/ai/ai-provider");
    const provider = new AIProvider({
      baseURL: s.get("aiProviderUrl"),
      apiKey: decryptApiKey(s.get("aiApiKey")),
      model: s.get("aiModel"),
    });
    const { generateOverviewBrief } = await import("../engine/ai/overview-brief");
    const { buildBriefInput } = await import("../engine/overview-summary");
    const { readRepoDescription } = await import("../engine/app-store-discovery");
    const { checkForRelease } = await import("../engine/release-watcher");

    const releaseResult = await checkForRelease(project.localPath, project.lastReleaseTag || null);
    const drafts = getStoreSubmissionDrafts(project)
      .filter((item: any) => item.productId === productId)
      .sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    const submissionDraft = drafts[0] || null;

    const input = buildBriefInput({
      projectName: project.name,
      productName: product.trackName || project.name,
      description: readRepoDescription(project.localPath),
      platform: product.platform || "unknown",
      supportedLanguages: (product.supportedLanguages || []).map((l: any) => l.code),
      trackedKeywords: product.trackedKeywords || [],
      rankSnapshots: product.rankSnapshots || [],
      releaseDraft: releaseResult.latest
        ? { name: releaseResult.latest.name, tag: releaseResult.latest.tag }
        : null,
      submissionDraft,
      submissionKeywords: product.submissionKeywords || [],
    });

    const suggestions = await generateOverviewBrief(provider, input, (received) => {
      if (!_event.sender.isDestroyed()) {
        _event.sender.send("projects:briefProgress", {
          chars: received.chars,
          phase: received.phase,
        });
      }
    });
    return { suggestions, generatedAt: new Date().toISOString() };
  });

  ipcMain.handle(
    "projects:recordBriefAction",
    async (_event, projectId: string, payload: { id: string; action: string; status: string }) => {
      projectId = assertNonEmptyString(projectId, "projectId");
      const actionId = assertNonEmptyString(payload?.id, "id");
      const action = assertNonEmptyString(payload?.action, "action");
      const status = payload?.status === "ignored" ? "ignored" : "adopted";
      const s = await getStore();
      const projects: any[] = s.get("projects") || [];
      const index = projects.findIndex((p: any) => p.id === projectId);
      if (index < 0) throw new Error("Project not found");
      const project = projects[index];
      const existing = Array.isArray(project.briefActions) ? project.briefActions : [];
      const rest = existing.filter((item: any) => item.id !== actionId);
      project.briefActions = [
        { id: actionId, action, status, createdAt: new Date().toISOString() },
        ...rest,
      ].slice(0, 200);
      projects[index] = project;
      s.set("projects", projects);
      emitProjectsChanged();
      return project;
    },
  );
```

- [ ] **Step 2: 在 `src/preload/index.ts` 暴露三个 API**

在 `projects` 对象内、`onKeywordProgress` 之后追加：

```ts
    generateBrief: (projectId: string, productId: string): Promise<any> =>
      ipcRenderer.invoke("projects:generateBrief", projectId, productId),
    recordBriefAction: (projectId: string, payload: any): Promise<any> =>
      ipcRenderer.invoke("projects:recordBriefAction", projectId, payload),
    onBriefProgress: (callback: (progress: any) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: any) => callback(progress);
      ipcRenderer.on("projects:briefProgress", listener);
      return () => ipcRenderer.removeListener("projects:briefProgress", listener);
    },
```

- [ ] **Step 3: 验证**

Run: `npm run typecheck && npm run build`
Expected: 通过。手动验证（dev 模式）：总览页点「生成简报」能收到 `briefProgress` 事件并返回 `suggestions`；`recordBriefAction` 后 `projects:list` 返回的 project 带 `briefActions`。

- [ ] **Step 4: 提交**

```bash
git add src/main/ipc.ts src/preload/index.ts
git commit -m "feat: 总览简报生成/动作记录 IPC 与 preload 暴露"
```

---

### Task 4: 渲染层规则信号 `overview-brief` lib

**Files:**
- Create: `src/renderer/lib/overview-brief.ts`
- Modify: `tests/overview-brief.test.ts`（追加规则信号用例）

**Interfaces:**
- Consumes: `rankRows` 形状 `{ keyword; language; bestRank; trend }`（来自 `overviewRankRows`）
- Produces:
  - `BriefActionKind = "keywords" | "release" | "trend"`
  - `BriefSignal { id; title; reason; action: BriefActionKind; target: string | null }`
  - `briefRuleSignals(args): BriefSignal[]`
  - `BriefActionRecord { id; action: BriefActionKind; status: "adopted" | "ignored"; createdAt: string }`（Task 5 消费）

- [ ] **Step 1: 追加失败测试**

在 `tests/overview-brief.test.ts` 末尾追加：

```ts
// 4. Renderer rule signals
import { briefRuleSignals } from "../src/renderer/lib/overview-brief";

const signals = briefRuleSignals({
  rankRows: [
    { keyword: "night walk", language: "en", bestRank: 12, trend: "down" },
    { keyword: "记账", language: "zh-Hans", bestRank: 3, trend: "up" },
  ],
  trackedActiveCount: 8,
  pausedCount: 2,
  languageTotal: 8,
  generatedLanguageCount: 3,
});
assert(signals.length === 3, "rules: emits up to 3 signals");
assert(signals[0].action === "keywords" && signals[0].target === "night walk", "rules: dropout first");
assert(signals[1].action === "release", "rules: incomplete languages signal");
assert(signals[2].id === "rule-paused", "rules: paused signal when keywords exist");
assert(
  briefRuleSignals({ rankRows: [], trackedActiveCount: 0, pausedCount: 0, languageTotal: 0, generatedLanguageCount: 0 })
    .some((s) => s.id === "rule-no-keywords"),
  "rules: no-keywords signal when empty",
);
```

注意：将顶部 `import { parseBriefSuggestions, ... }` 保持不变，追加的 import 放在文件底部不影响执行顺序（脚本按顺序执行，`briefRuleSignals` 仅在此处使用）。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx tests/overview-brief.test.ts`
Expected: FAIL（`briefRuleSignals` 不存在）。

- [ ] **Step 3: 实现 `src/renderer/lib/overview-brief.ts`**

```ts
/**
 * Overview brief renderer helpers: deterministic rule signals (AI fallback).
 */

export type BriefActionKind = "keywords" | "release" | "trend";

export interface BriefSignal {
  id: string;
  title: string;
  reason: string;
  action: BriefActionKind;
  target: string | null;
}

export interface BriefActionRecord {
  id: string;
  action: BriefActionKind;
  status: "adopted" | "ignored";
  createdAt: string;
}

export function briefRuleSignals(args: {
  rankRows: { keyword: string; language: string; bestRank: number; trend: string }[];
  trackedActiveCount: number;
  pausedCount: number;
  languageTotal: number;
  generatedLanguageCount: number;
}): BriefSignal[] {
  const signals: BriefSignal[] = [];
  const dropped = args.rankRows.filter((row) => row.trend === "down").slice(0, 1);
  if (dropped[0]) {
    signals.push({
      id: "rule-dropout",
      title: `查看「${dropped[0].keyword}」排名下滑`,
      reason: `${dropped[0].keyword} 最近排名下滑，建议到排名页查看趋势。`,
      action: "keywords",
      target: dropped[0].keyword,
    });
  }
  if (args.languageTotal > 0 && args.generatedLanguageCount < args.languageTotal) {
    signals.push({
      id: "rule-languages",
      title: `补齐发布文案（${args.generatedLanguageCount}/${args.languageTotal} 语言）`,
      reason: "发布工作台还有语言未生成或未确定文案。",
      action: "release",
      target: null,
    });
  }
  if (args.trackedActiveCount === 0) {
    signals.push({
      id: "rule-no-keywords",
      title: "生成跟踪关键词",
      reason: "还没有跟踪关键词，先建立关键词集才能观察排名。",
      action: "keywords",
      target: null,
    });
  } else if (args.pausedCount > 0) {
    signals.push({
      id: "rule-paused",
      title: `处理 ${args.pausedCount} 个暂停关键词`,
      reason: "有跟踪关键词因连续未入榜被自动暂停，可恢复或删除。",
      action: "keywords",
      target: null,
    });
  }
  return signals.slice(0, 3);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx tests/overview-brief.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
npm run typecheck
npx tsx tests/overview-brief.test.ts
git add src/renderer/lib/overview-brief.ts tests/overview-brief.test.ts
git commit -m "feat: 总览简报规则信号纯函数"
```

---

### Task 5: 渲染层 store 接入 `briefActions`

**Files:**
- Modify: `src/renderer/stores/project.ts`

**Interfaces:**
- Consumes: `BriefActionRecord`（Task 4）
- Produces:
  - `Project.briefActions: BriefActionRecord[]`
  - `normalizeBriefActions(raw): BriefActionRecord[]`
  - store 方法 `recordBriefAction(projectId, payload): Promise<void>`（调用 IPC，更新本地 projects）

- [ ] **Step 1: 类型与归一化**

在 `src/renderer/stores/project.ts` 顶部追加 type import，并在现有 `Project` 接口中新增 `briefActions` 字段、追加 `normalizeBriefActions` 函数：

```ts
import type { BriefActionRecord } from "../lib/overview-brief";

export interface Project {
  // 现有字段保持不变，仅新增下面这一行：
  briefActions: BriefActionRecord[];
}

function normalizeBriefActions(raw: any): BriefActionRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item.id === "string")
    .map((item) => ({
      id: item.id,
      action: ["keywords", "release", "trend"].includes(item.action) ? item.action : "keywords",
      status: item.status === "ignored" ? "ignored" : "adopted",
      createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
    }));
}

function normalizeProject(p: any): Project {
  const products = migrateLegacyProject(p);
  return {
    ...p,
    repo: normalizeRepo(p.repo),
    briefActions: normalizeBriefActions(p.briefActions),
    storeProducts: products,
    ...summarizeLegacyProject(products),
  };
}
```

- [ ] **Step 2: store 方法**

在 `ProjectState` 接口加 `recordBriefAction: (projectId: string, payload: { id: string; action: string; status: "adopted" | "ignored" }) => Promise<void>;`，并在实现中追加：

```ts
  recordBriefAction: async (projectId, payload) => {
    const updatedProject = normalizeProject(
      await (window as any).appilot.projects.recordBriefAction(projectId, payload),
    ) as unknown as Project;
    set((s) => ({
      projects: s.projects.map((project) => (project.id === updatedProject.id ? updatedProject : project)),
    }));
  },
```

- [ ] **Step 3: 验证**

Run: `npm run typecheck`
Expected: 通过。

- [ ] **Step 4: 提交**

```bash
git add src/renderer/stores/project.ts
git commit -m "feat: 渲染层 store 接入简报动作日志"
```

---

### Task 6: 总览页「副驾驶简报」卡

**Files:**
- Modify: `src/renderer/App.tsx`（`OverviewPage`）

**Interfaces:**
- Consumes: `briefRuleSignals` / `BriefActionRecord`（Task 4）、`useProject().recordBriefAction`（Task 5）、`appilot.projects.generateBrief` / `onBriefProgress`（Task 3）、现有 `rankRows` / `languages` / `generatedLanguageCount` / `languageTotal`
- Produces: 简报卡 UI（idle / loading / ready / error 四态）

- [ ] **Step 1: 状态与数据准备**

在 `OverviewPage` 顶部追加：

```tsx
  const [briefState, setBriefState] = useState<{
    status: "idle" | "loading" | "ready" | "error";
    suggestions: BriefSuggestion[];
    progress: { chars: number; phase: "reasoning" | "content" } | null;
    error: string;
  }>({ status: "idle", suggestions: [], progress: null, error: "" });
```

在派生数据区（`rankRows` 等之后）追加：

```tsx
  const handledBriefIds = new Set(
    (project.briefActions || []).map((item) => item.id),
  );
  const ruleSignals = briefRuleSignals({
    rankRows,
    trackedActiveCount: trackedActive.length,
    pausedCount,
    languageTotal,
    generatedLanguageCount,
  }).filter((signal) => !handledBriefIds.has(signal.id));
  const briefSuggestions = briefState.suggestions.filter(
    (item) => !handledBriefIds.has(item.id),
  );
  const showRuleSignals =
    briefState.status === "idle" || briefState.status === "error";
  const visibleBriefItems = showRuleSignals ? ruleSignals : briefSuggestions;
```

- [ ] **Step 2: 生成与进度监听**

在 `OverviewPage` 内追加 handler 与 effect：

```tsx
  const handleGenerateBrief = useCallback(async () => {
    if (!project || !product) return;
    setBriefState({ status: "loading", suggestions: [], progress: null, error: "" });
    try {
      const result = await (window as any).appilot?.projects?.generateBrief(
        project.id,
        product.id,
      );
      setBriefState({
        status: "ready",
        suggestions: result?.suggestions || [],
        progress: null,
        error: "",
      });
    } catch (err: any) {
      setBriefState({
        status: "error",
        suggestions: [],
        progress: null,
        error: err?.message || "生成失败",
      });
    }
  }, [project?.id, product?.id]);

  useEffect(() => {
    const off = (window as any).appilot?.projects?.onBriefProgress?.((progress: any) => {
      if (progress && typeof progress.chars === "number") {
        setBriefState((prev) => ({
          ...prev,
          progress: { chars: progress.chars, phase: progress.phase === "content" ? "content" : "reasoning" },
        }));
      }
    });
    return () => off?.();
  }, []);

  const handleBriefAction = useCallback(
    async (suggestion: BriefSuggestion, status: "adopted" | "ignored") => {
      if (!project) return;
      await recordBriefAction(project.id, {
        id: suggestion.id,
        action: suggestion.action,
        status,
      });
      if (status === "adopted") {
        navigate(suggestion.action === "release" ? "/release" : "/keywords");
      }
    },
    [project?.id, recordBriefAction, navigate],
  );
```

从 `useProject()` 解构中追加 `recordBriefAction`。文件顶部 import 追加 `import { briefRuleSignals } from "./lib/overview-brief";` 与 `import type { BriefSuggestion } from "../engine/ai/overview-brief";`（type-only import，不引入运行时依赖）。

- [ ] **Step 3: 渲染卡片**

在 `{/* Metrics */}` 之前插入：

```tsx
      {/* Copilot brief */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm mb-4">
        <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">副驾驶简报</h3>
          {briefState.status === "loading" ? (
            <span className="text-[11px] text-zinc-400 dark:text-zinc-500 shrink-0">
              {briefState.progress?.phase === "content" ? "生成中" : "思考中"} · {briefState.progress?.chars ?? 0} 字
            </span>
          ) : (
            <button onClick={handleGenerateBrief} className={btnSmSecondary}>
              生成简报
            </button>
          )}
        </div>
        {briefState.status === "error" && (
          <p className="px-5 py-2 text-[11px] text-red-500 dark:text-red-400 border-b border-zinc-100 dark:border-zinc-800">
            {briefState.error}（已显示规则信号）
          </p>
        )}
        {briefState.status === "loading" ? (
          <div className="px-5 py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">
            AI 正在分析排名与发布状态…
          </div>
        ) : visibleBriefItems.length === 0 ? (
          <div className="px-5 py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">
            {briefState.status === "ready" ? "本周事项已清空" : "暂无建议，点「生成简报」让副驾驶看路"}
          </div>
        ) : (
          <ul>
            {visibleBriefItems.map((item, index) => (
              <li
                key={item.id}
                className="flex items-center gap-3 px-5 py-2 border-b border-zinc-100 dark:border-zinc-800 last:border-b-0"
              >
                <span className="w-4 shrink-0 text-xs font-mono text-zinc-400 dark:text-zinc-500">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">{item.title}</p>
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate" title={item.reason}>
                    {item.reason}
                  </p>
                </div>
                <button
                  onClick={() => handleBriefAction(item, "adopted")}
                  className={cn(btnSmSecondary, "!px-2.5 !py-1")}
                >
                  采纳
                </button>
                <button
                  onClick={() => handleBriefAction(item, "ignored")}
                  className="px-2.5 py-1 text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                >
                  忽略
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
```

`BriefSuggestion` 与 `BriefSignal` 结构兼容（都有 id/title/reason/action/target），`visibleBriefItems` 可直接复用同一渲染。

- [ ] **Step 4: 验证**

Run: `npm run typecheck && npm run build`
Expected: 通过。手动验证（dev）：
1. 无 AI 配置时显示规则信号；点「生成简报」报错后回落规则信号；
2. 配置 AI 后生成成功，进度实时显示；采纳后跳转对应页面且该条不再展示；忽略同理；
3. 切换平台后简报按当前平台重新生成（依赖 `product?.id`）。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/App.tsx
git commit -m "feat: 总览页副驾驶简报卡（规则信号 + AI 生成 + 采纳/忽略）"
```

---

## Self-Review 记录

- **Spec 覆盖**：§4 规则信号 → Task 4/6；§5 四态 UI → Task 6；§6 动作日志 → Task 3/5；§7 边界（只建议不执行、maxTokens 4000、thinking disabled、手动触发）→ Task 2/3/6；§8 M1/M2 → Task 4-6 / Task 2-3。
- **占位符扫描**：无 TBD；每个代码步骤都含完整代码。
- **类型一致性**：`BriefAction`（engine）与 `BriefActionKind`（renderer lib）为同名异构类型，Task 6 通过结构兼容共用渲染；`generateBrief` 返回 `{ suggestions }` 与 preload/UI 使用一致；`recordBriefAction` payload 字段 `id/action/status` 三处（IPC、preload、store）一致。

## 范围外（后续计划）

- 每日自动生成简报（调度）；
- 建议效果追踪（长期效果时间线读取 `briefActions`）；
- 多平台汇总建议（等汇总视图落地）；
- AI 成本统计入 `aiUsage`（现有生成链路也未统计，保持一致）。
