# 跟踪关键词 Phase 3（整理优化 / 复盘模式）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「为所选语言生成」升级为「生成 / 整理」两段式：已有该语言关键词时，再次点击进入复盘模式——AI 结合现有词与观察数据给出「建议移除 / 建议新增 / 相似扩展」，用户在建议面板逐条采纳或忽略。

**Architecture:** 引擎层 `keyword-suggester` 新增 `curateKeywords`（复盘模式）与 `parseKeywordCuration`，并给 `generateKeywords` 增加可选上下文（副标题、提交关键词、现有词）；主进程新增 `projects:curateKeywords` IPC 组装上下文；渲染层按钮分流 + 建议面板（逐条采纳/忽略，立即生效）。

**Tech Stack:** TypeScript / electron-vite；测试沿用 `tsx tests/*.test.ts`（`node:assert/strict`）。

**Spec:** [docs/superpowers/specs/tracking-keywords-improvement.md](../specs/tracking-keywords-improvement.md)（§7 生成增强）

## Global Constraints

- 分支：从 `origin/master`（已合入 PR #30）新建 `codex/tracking-keywords-phase3`。
- 不做新依赖；复盘只产出**建议**，用户确认后才改跟踪集（采纳新增→加入跟踪，采纳移除→移入已删除并停采）。
- 每语言整理上限：建议移除 ≤20 条、建议新增 ≤30 条。
- 测试脚本 `package.json` 的 `test` 与 `test:ci` 必须加入新测试文件。
- 每个任务结束时 `npm run typecheck` 与相关测试必须通过，并单独提交。

---

### Task 0: 建分支并验证基线

- [ ] **Step 1: 创建分支**

Run:
```bash
git fetch origin
git checkout -b codex/tracking-keywords-phase3 origin/master
```

- [ ] **Step 2: 验证基线**

Run: `npm run typecheck && npm test`
Expected: 全部通过。

---

### Task 1: 复盘引擎（curateKeywords + parse + 生成上下文增强）

**Files:**
- Modify: `src/engine/ai/keyword-suggester.ts`
- Create: `tests/keyword-curation.test.ts`
- Modify: `package.json`（test / test:ci 加入 `tsx tests/keyword-curation.test.ts`）

**Interfaces:**
- Produces:
  ```ts
  export interface KeywordCurationRemoval { keyword: string; reason: string; }
  export interface KeywordCuration { removals: KeywordCurationRemoval[]; adds: KeywordSuggestion[]; }
  export function parseKeywordCuration(raw: string, fallbackLanguage?: string): KeywordCuration;
  export async function curateKeywords(
    provider: AIProvider,
    context: {
      name: string; subtitle?: string; description: string; language: string; uiLanguage: string;
      existingKeywords: { keyword: string; language: string; bestRank: number | null; lastSeenAt: string | null; status: string }[];
      submissionKeywords: string[];
      removedKeywords: string[];
    },
  ): Promise<KeywordCuration>;
  ```

- [ ] **Step 1: 写失败测试**

```ts
import assert from "node:assert/strict";
import { parseKeywordCuration } from "../src/engine/ai/keyword-suggester";

console.log("✅ PASS: parseKeywordCuration reads removals and adds");
const c1 = parseKeywordCuration(
  '{"removals":[{"keyword":"torch","reason":"持续未进榜"}],"adds":[{"keyword":"night walk","rationale":"夜间场景","language":"en"}]}',
);
assert.equal(c1.removals.length, 1);
assert.equal(c1.removals[0].keyword, "torch");
assert.equal(c1.adds[0].keyword, "night walk");

console.log("✅ PASS: parseKeywordCuration unwraps markdown fences");
const c2 = parseKeywordCuration(
  '```json\n{"removals":[{"keyword":"a","reason":"r"}],"adds":[]}\n```',
);
assert.equal(c2.removals[0].keyword, "a");

console.log("✅ PASS: parseKeywordCuration caps removals at 20 and adds at 30");
const removals = Array.from({ length: 30 }, (_, i) => `{"keyword":"k${i}","reason":"r"}`).join(",");
const adds = Array.from({ length: 40 }, (_, i) => `{"keyword":"a${i}","rationale":"r"}`).join(",");
const c3 = parseKeywordCuration(`{"removals":[${removals}],"adds":[${adds}]}`);
assert.equal(c3.removals.length, 20);
assert.equal(c3.adds.length, 30);

console.log("✅ PASS: parseKeywordCuration tolerates missing fields");
assert.deepEqual(parseKeywordCuration("{}"), { removals: [], adds: [] });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx tests/keyword-curation.test.ts`
Expected: FAIL（函数不存在）。

- [ ] **Step 3: 实现 parseKeywordCuration 与 curateKeywords**

在 `src/engine/ai/keyword-suggester.ts` 追加：

```ts
export interface KeywordCurationRemoval {
  keyword: string;
  reason: string;
}

export interface KeywordCuration {
  removals: KeywordCurationRemoval[];
  adds: KeywordSuggestion[];
}

export function parseKeywordCuration(raw: string, fallbackLanguage = "en"): KeywordCuration {
  const data = parseJsonObject(raw);
  const removals = Array.isArray(data.removals)
    ? data.removals
        .map((item: any) => ({
          keyword: String(item?.keyword || "").trim(),
          reason: String(item?.reason || "").trim(),
        }))
        .filter((item) => item.keyword)
        .slice(0, 20)
    : [];
  const adds = Array.isArray(data.adds)
    ? data.adds
        .filter((x: any) => x && typeof x.keyword === "string" && x.keyword.trim())
        .map((x: any) => ({
          language: String(x.language || fallbackLanguage).trim(),
          keyword: x.keyword.trim(),
          rationale: String(x.rationale || "").trim(),
          translation: String(x.translation || "").trim(),
        }))
        .slice(0, 30)
    : [];
  return { removals, adds };
}

export async function curateKeywords(
  provider: AIProvider,
  context: {
    name: string;
    subtitle?: string;
    description: string;
    language: string;
    uiLanguage: string;
    existingKeywords: { keyword: string; language: string; bestRank: number | null; lastSeenAt: string | null; status: string }[];
    submissionKeywords: string[];
    removedKeywords: string[];
  },
): Promise<KeywordCuration> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You are Appilot's ASO keyword curator. Review the existing tracking keywords for one localization and produce a curated suggestion set.",
        "1. `removals`: keywords that are badly chosen or clearly ineffective. Common reasons: never ranked after many checks, irrelevant to the app, duplicate of the name/subtitle, or too generic. Give one short reason each.",
        "2. `adds`: NEW keywords to track. Cover gaps (name/subtitle/submission-keyword intents), high-value scenarios from the description, and similar variants of keywords that HAVE ranked before. Never repeat existing or removed keywords.",
        "Keep removals ≤20 and adds ≤30. Do not include competitor brand names.",
        "Respond ONLY with JSON: {\"removals\":[{\"keyword\":\"...\",\"reason\":\"...\"}],\"adds\":[{\"language\":\"...\",\"keyword\":\"...\",\"translation\":\"...\",\"rationale\":\"...\"}]}",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `App name: ${context.name}`,
        `App subtitle: ${context.subtitle || "N/A"}`,
        `Target localization: ${context.language}`,
        `UI language (write rationale in this language): ${context.uiLanguage}`,
        `Description: ${context.description || "N/A"}`,
        `Submission keywords: ${context.submissionKeywords.join(", ") || "N/A"}`,
        `Existing tracked keywords (keyword|bestRank|lastSeenAt|status):\n${context.existingKeywords
          .map((k) => `${k.keyword}|${k.bestRank ?? "—"}|${k.lastSeenAt ?? "—"}|${k.status}`)
          .join("\n") || "N/A"}`,
        `Removed keywords (do not re-suggest): ${context.removedKeywords.join(", ") || "N/A"}`,
      ].join("\n"),
    },
  ];
  const raw = await provider.chat(messages, {
    temperature: 0.4,
    maxTokens: 3000,
    thinking: "low",
    responseFormat: "json_object",
  });
  return parseKeywordCuration(raw, context.language);
}
```

同时给 `generateKeywords` 的 context 增加可选字段并在 user prompt 里带上：
```ts
subtitle?: string;
submissionKeywords?: string[];
existingKeywords?: { keyword: string }[];
removedKeywords?: string[];
```
`user` 内容追加 `App subtitle / Submission keywords / Existing keywords / Removed keywords`（有值才输出，缺省 N/A）。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx tests/keyword-curation.test.ts`
Expected: PASS。

- [ ] **Step 5: 接入 package.json 并提交**

```bash
git add src/engine/ai/keyword-suggester.ts tests/keyword-curation.test.ts package.json
git commit -m "feat: 关键词复盘引擎（建议移除/新增/相似扩展）"
```

---

### Task 2: IPC 与 preload

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Consumes: `curateKeywords`（Task 1）
- Produces: `window.appilot.projects.curateKeywords(productId, language): Promise<KeywordCuration>`

- [ ] **Step 1: 新增 `projects:curateKeywords` handler**

参照 `projects:generateKeywords`，组装上下文：
```ts
ipcMain.handle("projects:curateKeywords", async (_event, productId: string, language: string) => {
  const s = await getStore();
  const projects: any[] = s.get("projects") || [];
  const context = findProductContext(projects, productId);
  if (!context) throw new Error("Store product not found");
  if (!language) throw new Error("Missing language");
  const { project, product } = context;

  const { AIProvider } = await import("../engine/ai/ai-provider");
  const provider = new AIProvider({
    baseURL: s.get("aiProviderUrl"),
    apiKey: decryptApiKey(s.get("aiApiKey")),
    model: s.get("aiModel"),
  });
  const { curateKeywords } = await import("../engine/ai/keyword-suggester");
  const { readRepoDescription } = await import("../engine/app-store-discovery");

  const drafts = getStoreSubmissionDrafts(project)
    .filter((draft) => draft.productId === productId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const latest = drafts[0];
  const loc = latest?.localizations?.find((item: any) => item.language === language)
    || latest?.localizations?.[0];
  const submission = (product.submissionKeywords || []).find((item: any) => item.language === language);
  const submissionKeywords = (submission?.text || "")
    .split(",")
    .map((item: string) => item.trim())
    .filter(Boolean);
  const existingKeywords = (product.trackedKeywords || [])
    .filter((item: any) => item.language === language)
    .map((item: any) => ({
      keyword: item.keyword,
      language: item.language,
      bestRank: item.bestRank ?? null,
      lastSeenAt: item.lastSeenAt ?? null,
      status: item.status || "active",
    }));
  const removedKeywords = (product.removedKeywords || [])
    .filter((item: any) => item.language === language)
    .map((item: any) => item.keyword);

  return curateKeywords(provider, {
    name: product.trackName || project.name,
    subtitle: loc?.subtitle || "",
    description: readRepoDescription(project.localPath),
    language,
    uiLanguage: "zh-Hans",
    existingKeywords,
    submissionKeywords,
    removedKeywords,
  });
});
```

- [ ] **Step 2: preload 暴露**

`src/preload/index.ts` 的 `projects` 下追加：
```ts
curateKeywords: (projectId: string, language: string): Promise<any> =>
  ipcRenderer.invoke("projects:curateKeywords", projectId, language),
```

- [ ] **Step 3: 验证**

Run: `npm run typecheck && npm test`
Expected: 全绿。

- [ ] **Step 4: 提交**

```bash
git add src/main/ipc.ts src/preload/index.ts
git commit -m "feat: 关键词复盘 IPC 与 preload"
```

---

### Task 3: 渲染层分流与建议面板

**Files:**
- Modify: `src/renderer/App.tsx`（KeywordsPage）

**Interfaces:**
- Consumes: `curateKeywords`（Task 2）、`removeTrackedKeyword` / `saveTrackedKeywords`（已有）
- Produces: 无新 IPC；面板为页面内状态

- [ ] **Step 1: 状态与分流**

新增状态：
```ts
const [curation, setCuration] = useState<Record<string, { removals: { keyword: string; reason: string }[]; adds: KeywordSuggestion[] }>>({});
```
`handleGenerateAll` 改为按语言分流：
```ts
const handleGenerateAll = async () => {
  setError("");
  const tracked = product.trackedKeywords || [];
  const toGenerate = litLangs.filter((lang) => !tracked.some((k) => k.language === lang));
  const toCurate = litLangs.filter((lang) => tracked.some((k) => k.language === lang));
  setLoadingLangs(new Set([...toGenerate, ...toCurate]));
  const results = await Promise.all([
    ...toGenerate.map((lang) => generateOne(lang)),
    ...toCurate.map(async (lang) => {
      try {
        const result = await (window as any).appilot.projects.curateKeywords(product.id, lang);
        return { lang, curation: result as { removals: { keyword: string; reason: string }[]; adds: KeywordSuggestion[] } };
      } catch (e: any) {
        setError(e.message || "关键词整理失败。");
        return { lang, curation: null };
      }
    }),
  ]);
  await applyGenerations(results.filter((r) => "gen" in r) as any);
  const nextCuration: Record<string, any> = {};
  for (const r of results) {
    if ("curation" in r && r.curation) nextCuration[r.lang] = r.curation;
  }
  setCuration((prev) => ({ ...prev, ...nextCuration }));
  setLoadingLangs(new Set());
};
```
按钮文案改为 `为所选语言生成 / 整理`。

- [ ] **Step 2: 建议面板**

在滚动容器内、关键词行之前渲染（有数据时）：
```tsx
{Object.keys(curation).length > 0 && (
  <div className="mb-4 rounded-xl border border-amber-200/70 dark:border-amber-500/30 bg-amber-50/40 dark:bg-amber-500/5 p-4 space-y-4">
    <div className="flex items-center justify-between gap-3">
      <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">关键词整理建议</h4>
      <button onClick={() => setCuration({})} className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">关闭</button>
    </div>
    {Object.entries(curation).map(([lang, data]) => (
      <div key={lang} className="space-y-3">
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{languageLabel(lang)}</p>
        {data.removals.map((item) => (
          <div key={`rm:${item.keyword}`} className="flex items-start justify-between gap-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm text-zinc-800 dark:text-zinc-200">{item.keyword}</p>
              <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">{item.reason}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button onClick={() => acceptRemoval(lang, item.keyword)} className="text-xs text-amber-600 dark:text-amber-400 hover:underline">采纳移除</button>
              <button onClick={() => dismissCurationItem(lang, "removals", item.keyword)} className="text-xs text-zinc-400 hover:text-zinc-600">忽略</button>
            </div>
          </div>
        ))}
        {data.adds.map((item) => (
          <div key={`add:${item.keyword}`} className="flex items-start justify-between gap-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm text-zinc-800 dark:text-zinc-200">{item.keyword}{item.translation ? `（${item.translation}）` : ""}</p>
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">{item.rationale}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button onClick={() => acceptAddition(lang, item)} className="text-xs text-amber-600 dark:text-amber-400 hover:underline">采纳新增</button>
              <button onClick={() => dismissCurationItem(lang, "adds", item.keyword)} className="text-xs text-zinc-400 hover:text-zinc-600">忽略</button>
            </div>
          </div>
        ))}
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 3: 采纳/忽略处理器**

```ts
const acceptRemoval = async (lang: string, keyword: string) => {
  await removeTracked(keyword, lang);
  dismissCurationItem(lang, "removals", keyword);
};

const acceptAddition = async (lang: string, item: KeywordSuggestion) => {
  const latest = useProject.getState().projects.find((p) => p.id === currentProjectId);
  const current = latest?.storeProducts?.find((p) => p.id === product.id) || product;
  const existingKeys = new Set((current.trackedKeywords || []).map((k) => `${k.language}\u0000${k.keyword}`));
  if (existingKeys.has(`${lang}\u0000${item.keyword}`)) {
    dismissCurationItem(lang, "adds", item.keyword);
    return;
  }
  const next = [...(current.trackedKeywords || []), { language: lang, keyword: item.keyword, rationale: item.rationale, translation: item.translation || "", status: "active", source: "ai" }];
  await (window as any).appilot.projects.saveTrackedKeywords(product.id, next);
  updateTrackedKeywords(product.id, next);
  dismissCurationItem(lang, "adds", item.keyword);
};

const dismissCurationItem = (lang: string, key: "removals" | "adds", keyword: string) => {
  setCuration((prev) => {
    const langData = prev[lang];
    if (!langData) return prev;
    const next = { ...langData, [key]: langData[key].filter((item: any) => item.keyword !== keyword) };
    const merged = { ...prev, [lang]: next };
    if (next.removals.length === 0 && next.adds.length === 0) {
      const copy = { ...merged };
      delete copy[lang];
      return copy;
    }
    return merged;
  });
};
```

- [ ] **Step 4: 验证**

Run: `npm run typecheck && npm test`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/App.tsx
git commit -m "feat: 排名页生成/整理分流与关键词建议面板"
```

---

### Task 4: 文档同步与收尾

**Files:**
- Modify: `docs/superpowers/specs/tracking-keywords-improvement.md`（§7 落地细节）
- Modify: `docs/superpowers/specs/appilot-ui.md`（§8.5 整理模式）

- [ ] **Step 1: 同步文档**

§7 补充：复盘模式输入（现有词+观察+提交内容）、输出建议（移除/新增/相似扩展）、用户逐条确认；§8.5 补充「为所选语言生成/整理」与建议面板。

- [ ] **Step 2: 全量验证**

Run: `npm run typecheck && npm run build && npm test`
Expected: 全绿。

- [ ] **Step 3: 提交并推送**

```bash
git add docs/superpowers/specs/tracking-keywords-improvement.md docs/superpowers/specs/appilot-ui.md
git commit -m "docs: 同步关键词整理/复盘模式规格"
git push -u origin codex/tracking-keywords-phase3
```
