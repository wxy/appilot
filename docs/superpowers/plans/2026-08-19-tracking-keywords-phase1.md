# 跟踪关键词 Phase 1 重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构跟踪关键词页：语言点亮制、移除本页商店关键词生成/编辑、矩阵式排名展示（含时间、200+、全局徽标），并删除发布工作台的 `trackingKeywordDeltas` 链路。

**Architecture:** 引擎层 `keyword-suggester` 只输出跟踪关键词（去掉 submission）；渲染层新增纯函数模块 `src/renderer/lib/matrix.ts` 承载矩阵计算（单元格状态、列头时间、语言过滤），UI 通过它渲染矩阵；发布侧从 `release-reviewer` / `store-submission` 移除增删建议字段与生成。全程保持 `language: "en"` 存储，显示为「全局」。

**Tech Stack:** TypeScript / React 19 + Tailwind / electron-vite；测试沿用 `tsx tests/*.test.ts`（`node:assert/strict`）。

**Spec:** [docs/superpowers/specs/tracking-keywords-improvement.md](../specs/tracking-keywords-improvement.md)

## Global Constraints

- 分支：从 `origin/master` 新建 `codex/tracking-keywords-refactor`（当前工作区在已 PR 的 `codex/aso-name-subtitle-keywords` 上，先 `git fetch origin`）。
- 不做新依赖；不引入 React 测试框架，UI 逻辑抽到纯函数测试。
- 存储约定不变：关键词仍存 `language` 字段，`"en"` 即「全局」；`submissionKeywords` 字段保留（发布工作台继续使用），跟踪页不再展示/编辑。
- 测试脚本 `package.json` 的 `test` 与 `test:ci` 必须同步加入新测试文件。
- 术语：UI 中 `"en"` 显示为「全局」；只有跟踪页/关键词语境这样显示，发布工作台语言标签仍用「英文」。
- 每个任务结束时 `npm run typecheck` 与相关测试必须通过，并单独提交。

---

### Task 0: 建分支并验证基线

**Files:**
- Modify: `package.json`（无改动，仅验证）

**Interfaces:**
- Consumes: `origin/master`
- Produces: 干净分支 `codex/tracking-keywords-refactor`

- [ ] **Step 1: 创建分支**

Run:
```bash
git fetch origin
git checkout -b codex/tracking-keywords-refactor origin/master
```

- [ ] **Step 2: 验证基线**

Run: `npm run typecheck && npm test`
Expected: 全部通过（当前 master 基线）。

---

### Task 1: 跟踪关键词生成去掉 submission，页面移除商店关键词编辑

**Files:**
- Modify: `src/engine/ai/keyword-suggester.ts`
- Modify: `tests/keyword-suggester.test.ts`
- Modify: `src/renderer/App.tsx`（KeywordsPage：`applyGenerations`、移除「商店关键词」卡片、`saveSubmission`、`submissionDrafts` 状态）

**Interfaces:**
- Consumes: `KeywordGeneration`（旧：`{ tracking; submission }`）
- Produces: `KeywordGeneration = { tracking: KeywordSuggestion[] }`；`parseKeywordGeneration(raw, fallbackLanguage)` 只解析 `tracking`

- [ ] **Step 1: 写失败测试（engine）**

修改 `tests/keyword-suggester.test.ts`，去掉所有 `submission` 断言，并新增：

```ts
// 7. 响应里即使带 submission 字段也只解析 tracking
const g7 = parseKeywordGeneration(
  '{"tracking":[{"keyword":"flashlight","rationale":"core use case"}],"submission":["flashlight","torch"]}',
);
assert(g7.tracking.length === 1, "parse: ignores submission field");
assert((g7 as any).submission === undefined, "parse: no submission in result");
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx tests/keyword-suggester.test.ts`
Expected: FAIL（`g1.submission` 等旧断言或类型错误）。

- [ ] **Step 3: 实现 engine 改动**

`src/engine/ai/keyword-suggester.ts`：

```ts
export interface KeywordGeneration {
  tracking: KeywordSuggestion[];
}
```

`parseKeywordGeneration` 删除 submission 解析分支，只返回 `{ tracking }`。`generateKeywords` 的 system prompt 删除第 2 条 `submission` 说明与 JSON 示例中的 `"submission":[...]`，保留 tracking 指令。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx tests/keyword-suggester.test.ts`
Expected: PASS。

- [ ] **Step 5: 更新 renderer 编译与 UI**

`src/renderer/App.tsx` KeywordsPage：
1. 本地 `interface KeywordGeneration` 改为 `{ tracking: KeywordSuggestion[] }`。
2. `applyGenerations` 删除 `submissionNext`、`drafts`、`saveSubmissionKeywords` 相关分支，只写 `trackedKeywords`。
3. 删除「商店关键词（提交字段）」卡片、`saveSubmission`、`submissionDrafts`、`charCount` 状态；从 `useProject()` 解构中去掉 `updateSubmissionKeywords`。

保留 `src/main/ipc.ts` 的 `projects:saveSubmissionKeywords` 与 preload 暴露（兼容存量数据与未来发布侧使用；发布工作台目前通过 `release:saveDraft` 写 `submissionKeywords`），本页不再调用。

- [ ] **Step 6: 验证**

Run: `npm run typecheck`
Expected: 无类型错误（`KeywordGeneration` 无 `submission` 引用残留）。

- [ ] **Step 7: 提交**

```bash
git add src/engine/ai/keyword-suggester.ts tests/keyword-suggester.test.ts src/renderer/App.tsx
git commit -m "feat: 跟踪关键词生成去掉提交字段，页面移除商店关键词编辑"
```

---

### Task 2: 语言点亮制 + 「全局」术语

**Files:**
- Create: `src/renderer/lib/matrix.ts`（含 `trackingLanguageOptions`、`matrixFilterKeywords`，后续 Task 3 复用）
- Create: `tests/matrix.test.ts`
- Modify: `src/renderer/App.tsx`（KeywordsPage 语言选择与生成逻辑）

**Interfaces:**
- Produces:
  ```ts
  export function trackingLanguageOptions(supported: { code: string; name: string }[]): { code: string; label: string }[];
  export function matrixFilterKeywords(keywords: { language: string }[], viewLang: string): { language: string }[];
  ```

- [ ] **Step 1: 写失败测试**

`tests/matrix.test.ts`：

```ts
import assert from "node:assert/strict";
import { matrixFilterKeywords, trackingLanguageOptions } from "../src/renderer/lib/matrix";

console.log("✅ PASS: trackingLanguageOptions labels en as 全局");
const opts = trackingLanguageOptions([
  { code: "zh-Hans", name: "简体中文" },
  { code: "en", name: "英文" },
]);
assert.deepEqual(opts, [
  { code: "zh-Hans", label: "简体中文" },
  { code: "en", label: "全局" },
]);
assert.deepEqual(trackingLanguageOptions([{ code: "zh-Hans", name: "简体中文" }]), [
  { code: "zh-Hans", label: "简体中文" },
  { code: "en", label: "全局" },
]);

console.log("✅ PASS: matrixFilterKeywords includes viewLang and global en");
const filtered = matrixFilterKeywords(
  [
    { language: "zh-Hans" },
    { language: "en" },
    { language: "ja" },
  ],
  "zh-Hans",
);
assert.deepEqual(filtered, [{ language: "zh-Hans" }, { language: "en" }]);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx tests/matrix.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/renderer/lib/matrix.ts`**

```ts
export function trackingLanguageOptions(supported: { code: string; name: string }[]): { code: string; label: string }[] {
  const options = supported.map((l) =>
    l.code === "en" ? { code: "en", label: "全局" } : { code: l.code, label: l.name },
  );
  if (!supported.some((l) => l.code === "en")) options.push({ code: "en", label: "全局" });
  return options;
}

export function matrixFilterKeywords(
  keywords: { language: string }[],
  viewLang: string,
): { language: string }[] {
  return keywords.filter((k) => k.language === viewLang || k.language === "en");
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx tests/matrix.test.ts`
Expected: PASS。

- [ ] **Step 5: 接入 KeywordsPage**

`src/renderer/App.tsx` KeywordsPage：
1. 新增状态：`const [litLangs, setLitLangs] = useState<string[]>(defaultLitLangs)`；`defaultLitLangs` = 产品支持 `UI_SOURCE_LANGUAGE` 时为 `[UI_SOURCE_LANGUAGE]`，否则 `[supported[0].code]`。另设 `viewLang` 默认 `litLangs[0]`。
2. 语言 chips 改为可多选（点击切换 `litLangs`），标签用 `trackingLanguageOptions(...)`（en 显示「全局」）；下方再用点亮语言渲染 segmented tabs 作为矩阵视图切换（点击设置 `viewLang`）。
3. 页头按钮改为「为所选语言生成」：`handleGenerateAll` 遍历 `litLangs`（含 `"en"`）逐个调用 `generateOne` 并 `applyGenerations`。

- [ ] **Step 6: 验证**

Run: `npm run typecheck && npx tsx tests/matrix.test.ts`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/renderer/lib/matrix.ts tests/matrix.test.ts src/renderer/App.tsx package.json
git commit -m "feat: 跟踪关键词语言点亮制与全局术语"
```

> 注：`package.json` 在此任务暂不改；Task 3 会把 `matrix.test.ts` 加入 test/test:ci。

---

### Task 3: 矩阵表（行=关键词，列=商店）

**Files:**
- Modify: `src/renderer/lib/matrix.ts`（新增 `STALE_MS`、`MatrixCell`、`matrixCellState`、`matrixColumnMeta`）
- Modify: `tests/matrix.test.ts`
- Modify: `package.json`（test / test:ci 加入 `tsx tests/matrix.test.ts`）
- Modify: `src/renderer/App.tsx`（KeywordsPage 用矩阵替换原跟踪列表行；保留删除/恢复区、采集按钮、点词展开趋势）

**Interfaces:**
- Consumes: `matrixFilterKeywords`（Task 2）
- Produces:
  ```ts
  export const STALE_MS = 36 * 60 * 60 * 1000;
  export interface MatrixSnapshot {
    keyword: string;
    storefront: string;
    rank: number | null;
    totalResults: number;
    checkedAt: string;
  }
  export interface MatrixCell {
    rank: number | null;          // null = 未查询
    beyond200: boolean;           // 已查询但不在前 200
    delta: number | null;
    trend: "none" | "new" | "lost" | "up" | "down" | "same";
    checkedAt: string | null;
    totalResults: number | null;
  }
  export function matrixCellState(snapshots: MatrixSnapshot[], keyword: string, storefront: string): MatrixCell;
  export function matrixColumnMeta(
    snapshots: { storefront: string; checkedAt: string }[],
    storefront: string,
  ): { lastCheckedAt: string | null; stale: boolean };
  ```

- [ ] **Step 1: 写失败测试**

追加到 `tests/matrix.test.ts`：

```ts
// 在文件顶部已有 import 中追加：matrixCellState, matrixColumnMeta, STALE_MS

console.log("✅ PASS: matrixCellState reports rank, delta and beyond200");
const snap = [
  { keyword: "night walk", storefront: "us", rank: 5, totalResults: 200, checkedAt: "2026-08-18T10:00:00.000Z" },
  { keyword: "night walk", storefront: "us", rank: 3, totalResults: 200, checkedAt: "2026-08-19T10:00:00.000Z" },
  { keyword: "deep link", storefront: "us", rank: null, totalResults: 200, checkedAt: "2026-08-19T10:00:00.000Z" },
];
const cell = matrixCellState(snap, "night walk", "us");
assert.equal(cell.rank, 3);
assert.equal(cell.delta, 2); // 5 -> 3
assert.equal(cell.trend, "up");
assert.equal(cell.beyond200, false);
const lost = matrixCellState(snap, "deep link", "us");
assert.equal(lost.rank, null);
assert.equal(lost.beyond200, true);
const none = matrixCellState(snap, "记账", "us");
assert.equal(none.rank, null);
assert.equal(none.beyond200, false);

console.log("✅ PASS: matrixColumnMeta detects stale column");
const now = Date.now();
const metaFresh = matrixColumnMeta(
  [{ storefront: "us", checkedAt: new Date(now - STALE_MS / 2).toISOString() }],
  "us",
);
assert.equal(metaFresh.stale, false);
const staleTime = new Date(now - STALE_MS * 2).toISOString();
const metaStale = matrixColumnMeta([{ storefront: "us", checkedAt: staleTime }], "us");
assert.equal(metaStale.stale, true);
assert.equal(metaStale.lastCheckedAt, staleTime);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx tests/matrix.test.ts`
Expected: FAIL（`matrixCellState` 未定义）。

- [ ] **Step 3: 实现 matrix.ts 新增函数**

```ts
export const STALE_MS = 36 * 60 * 60 * 1000;

export interface MatrixCell {
  rank: number | null;
  beyond200: boolean;
  delta: number | null;
  trend: "none" | "new" | "lost" | "up" | "down" | "same";
  checkedAt: string | null;
  totalResults: number | null;
}

export function matrixCellState(snapshots: MatrixSnapshot[], keyword: string, storefront: string): MatrixCell {
  const list = snapshots
    .filter((s) => s.keyword === keyword && s.storefront === storefront)
    .sort((a, b) => new Date(a.checkedAt).getTime() - new Date(b.checkedAt).getTime());
  const latest = list[list.length - 1];
  if (!latest) {
    return { rank: null, beyond200: false, delta: null, trend: "none", checkedAt: null, totalResults: null };
  }
  const previous = list[list.length - 2];
  let delta: number | null = null;
  let trend: MatrixCell["trend"] = "same";
  if (previous?.rank == null && latest.rank != null) trend = "new";
  else if (previous?.rank != null && latest.rank == null) trend = "lost";
  else if (previous?.rank != null && latest.rank != null) {
    delta = previous.rank - latest.rank;
    if (delta > 0) trend = "up";
    else if (delta < 0) trend = "down";
  }
  return {
    rank: latest.rank,
    beyond200: latest.rank == null,
    delta,
    trend,
    checkedAt: latest.checkedAt,
    totalResults: latest.totalResults,
  };
}

export function matrixColumnMeta(
  snapshots: { storefront: string; checkedAt: string }[],
  storefront: string,
): { lastCheckedAt: string | null; stale: boolean } {
  const times = snapshots
    .filter((s) => s.storefront === storefront)
    .map((s) => new Date(s.checkedAt).getTime());
  if (times.length === 0) return { lastCheckedAt: null, stale: false };
  const last = Math.max(...times);
  return { lastCheckedAt: new Date(last).toISOString(), stale: Date.now() - last > STALE_MS };
}

export interface MatrixSnapshot {
  keyword: string;
  storefront: string;
  rank: number | null;
  totalResults: number;
  checkedAt: string;
}
```

> 说明：`MatrixSnapshot` 需要 `export`（Task 3 Step 6 的单元格组件引用其字段）；字段与 `RankSnapshot` 子集一致。`matrixFilterKeywords`/`trackingLanguageOptions` 已在 Task 2 创建，保持导出不变。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx tests/matrix.test.ts`
Expected: PASS。

- [ ] **Step 5: 接入 package.json 测试脚本**

`test` 与 `test:ci` 均追加 `&& tsx tests/matrix.test.ts`（放在 `tests/keyword-suggester.test.ts` 之后）。

- [ ] **Step 6: 渲染矩阵表**

`src/renderer/App.tsx` KeywordsPage：
1. 用 `matrixFilterKeywords(tracked, viewLang)` 得到矩阵行；列 = `storefrontsForLanguage(viewLang)`。
2. 渲染表格：`<table>`，列头 = `storefrontDisplayName(code)` + 列头下方 `matrixColumnMeta(...)` 的 `HH:mm`（`lastCheckedAt` 为 null 显示「未查询」）；`stale` 时给 `<th>`/单元格加 `opacity-60` 与「过期」小标。
3. 单元格：`matrixCellState(rankSnapshots, kw, storefront)`；`beyond200` 显示 `200+`（灰）；`rank` 显示数字（`<=10` 用 `text-amber-600 dark:text-amber-400 font-semibold`）；变化显示 `▲n/▼n/进榜/掉榜`；单元格 `title` = `最近查询 ${new Date(checkedAt).toLocaleString()} · 结果量 ${totalResults}`。
4. `keyword.language === "en"` 的行，关键词名后加「全局」徽标。
5. 表下方保留说明：「各商店独立采集，时间可能不同」。
6. 原「跟踪关键词与排名」列表替换为矩阵；保留：storefront 下拉（用于手动采集）、「采集排名」、「已删除关键词」区、点行/格设置 `selectedKeyword` 后下方趋势折线（复用现有 `chartSnapshots` 逻辑）。

单元格渲染参考：

```tsx
function MatrixCellView({ cell }: { cell: MatrixCell }) {
  const rankText = cell.beyond200 ? "200+" : cell.rank ?? "—";
  const trendText =
    cell.trend === "new" ? "进榜"
    : cell.trend === "lost" ? "掉榜"
    : cell.trend === "up" ? `▲ ${cell.delta}`
    : cell.trend === "down" ? `▼ ${Math.abs(cell.delta ?? 0)}`
    : null;
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span className={cn("font-mono", cell.rank !== null && cell.rank <= 10 ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-zinc-600 dark:text-zinc-300")}>
        {rankText}
      </span>
      {trendText ? (
        <span className={cn("text-[10px] font-mono", cell.trend === "up" || cell.trend === "new" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
          {trendText}
        </span>
      ) : null}
    </span>
  );
}
```

- [ ] **Step 7: 验证**

Run: `npm run typecheck && npm run test`
Expected: 全绿。

- [ ] **Step 8: 提交**

```bash
git add src/renderer/lib/matrix.ts tests/matrix.test.ts package.json src/renderer/App.tsx
git commit -m "feat: 跟踪关键词矩阵表（排名/变化/200+/时间/全局徽标）"
```

---

### Task 4: 删除发布工作台 trackingKeywordDeltas 链路

**Files:**
- Modify: `src/engine/ai/release-reviewer.ts`
- Modify: `src/engine/store-submission.ts`
- Modify: `docs/superpowers/specs/appilot-architecture.md`
- Modify: `docs/superpowers/specs/appilot-ui.md`

**Interfaces:**
- Consumes: `generateStoreSubmissionContent`（旧返回含 `trackingKeywordDeltas`）
- Produces: `StoreSubmissionContent` 不再含 `trackingKeywordDeltas`；`generateGlobalReleasePlan` 返回 `{ summary; promotionAngles }`

- [ ] **Step 1: 确认当前引用**

Run: `rg -n "trackingKeywordDeltas" src tests`
Expected: 命中 `release-reviewer.ts`、`store-submission.ts`（无 renderer 消费）。

- [ ] **Step 2: 修改 engine**

`src/engine/ai/release-reviewer.ts`：
1. 删除 `TrackingKeywordChange` 的 import。
2. `generateGlobalReleasePlan` 的返回类型改为 `Promise<{ summary: string; promotionAngles: string[] }>`；system prompt 删除 `trackingKeywordDeltas` 的 JSON 示例块与说明行；删除 `trackingKeywordDeltas` 解析分支；return 中删除该字段。
3. `generateStoreSubmissionContent` 的返回对象删除 `trackingKeywordDeltas: globalPlan.trackingKeywordDeltas`。

`src/engine/store-submission.ts`：
1. 删除 `TrackingKeywordChange` 接口。
2. `StoreSubmissionContent` 删除 `trackingKeywordDeltas: TrackingKeywordChange[]` 字段。
3. `createStoreSubmissionDraft` 删除 `trackingKeywordDeltas: input.content.trackingKeywordDeltas` 映射。

- [ ] **Step 3: 同步文档**

`docs/superpowers/specs/appilot-architecture.md`：§3.0.3 表格删除「trackingKeywordDeltas」行；删除「关键词增删不立即写入跟踪集」规则 bullet。
`docs/superpowers/specs/appilot-ui.md`：发布工作台 mock 删除「跟踪关键词调整」区块；删除「跟踪关键词调整以增删建议呈现…」bullet。

- [ ] **Step 4: 验证**

Run: `rg -n "trackingKeywordDeltas|TrackingKeywordChange" src tests`（应无命中）&& `npm run typecheck && npm test`
Expected: 无引用残留，测试全绿。

- [ ] **Step 5: 提交**

```bash
git add src/engine/ai/release-reviewer.ts src/engine/store-submission.ts docs/superpowers/specs/appilot-architecture.md docs/superpowers/specs/appilot-ui.md
git commit -m "refactor: 移除发布工作台跟踪关键词增删建议链路"
```

---

### Task 5: 文档同步与收尾

**Files:**
- Modify: `docs/superpowers/specs/appilot-ui.md`（§8.5 关键词排名按矩阵/点亮制/全局术语更新）
- Modify: `docs/superpowers/specs/tracking-keywords-improvement.md`（如实现有出入，回写）

- [ ] **Step 1: 更新 §8.5**

把「关键词排名」mock 与 bullets 更新为：语言点亮制（默认界面语言）、矩阵表（行=关键词，列=商店）、200+ 语义、列头时间与过期、全局徽标、「为所选语言生成」；注明商店关键词由发布工作台负责。

- [ ] **Step 2: 全量验证**

Run: `npm run typecheck && npm run build && npm test`
Expected: 全绿。

- [ ] **Step 3: 提交**

```bash
git add docs/superpowers/specs/appilot-ui.md docs/superpowers/specs/tracking-keywords-improvement.md
git commit -m "docs: 同步跟踪关键词矩阵与点亮制规格"
```

- [ ] **Step 4: 推送**

Run: `git push -u origin codex/tracking-keywords-refactor`

---

## Phase 2 / 3 说明（不在本计划内）

- **Phase 2（自动屏蔽）**：`KeywordEntry` 扩展字段 → 调度 reconcile 判定连续 10 次未进榜 → `paused` + 停止任务 → 恢复/删除 UI；snapshots 去重与保留窗口；失败重试上限。
- **Phase 3（生成增强）**：提交内容参考区 + 候选词来源标注；diff 增量 + 每语言上限 25；生成上下文（副标题/现有跟踪/排名）。
- 各自作为独立计划产出，遵循同一份 spec。
