# 跟踪关键词 Phase 2（自动屏蔽与采集健壮性）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为跟踪关键词增加自动屏蔽（连续未在榜自动暂停）、采集数据去重与时间窗口、调度失败上限，并把「已暂停」关键词纳入页面折叠区管理。

**Architecture:** 新增两个纯函数模块承载规则：`src/engine/rank-snapshots.ts`（快照去重 + 窗口裁剪）、`src/engine/rank-keywords.ts`（关键词字段补齐、在榜元数据、连续未在榜判定）；主进程在 `reconcileRankTasks` / `runRankTask` / `projects:collectRanks` / `projects:saveTrackedKeywords` 接入；渲染层新增暂停词恢复入口并在矩阵/折叠区过滤展示。

**Tech Stack:** TypeScript / electron-vite；测试沿用 `tsx tests/*.test.ts`（`node:assert/strict`）。

**Spec:** [docs/superpowers/specs/tracking-keywords-improvement.md](../specs/tracking-keywords-improvement.md)（§5 自动屏蔽、§6 采集健壮性）

## Global Constraints

- 分支：从 `origin/master`（已合入 PR #29）新建 `codex/tracking-keywords-phase2`。
- 不做新依赖；不引入 React 测试框架，规则逻辑抽到纯函数测试。
- `KeywordEntry` 新增字段均为可选，旧数据由主进程 normalize 补齐，无需迁移脚本。
- 只屏蔽不删数据：`paused` 仅停止调度采集，恢复后回到 `active`。
- 测试脚本 `package.json` 的 `test` 与 `test:ci` 必须同步加入新测试文件。
- 每个任务结束时 `npm run typecheck` 与相关测试必须通过，并单独提交。

---

### Task 0: 建分支并验证基线

- [ ] **Step 1: 创建分支**

Run:
```bash
git fetch origin
git checkout -b codex/tracking-keywords-phase2 origin/master
```

- [ ] **Step 2: 验证基线**

Run: `npm run typecheck && npm test`
Expected: 全部通过。

---

### Task 1: 快照去重与时间窗口（rank-snapshots）

**Files:**
- Create: `src/engine/rank-snapshots.ts`
- Create: `tests/rank-snapshots.test.ts`
- Modify: `package.json`（test / test:ci 加入 `tsx tests/rank-snapshots.test.ts`）

**Interfaces:**
- Produces:
  ```ts
  export interface RankSnapshotLike {
    keyword: string; language: string; storefront: string;
    rank: number | null; totalResults: number; checkedAt: string;
  }
  export const RANK_SNAPSHOT_WINDOW_MS: number; // 90 天
  export const RANK_SNAPSHOT_MAX_PER_KEY: number; // 120
  export function appendRankSnapshots<T extends RankSnapshotLike>(existing: T[], incoming: T[]): T[];
  ```

- [ ] **Step 1: 写失败测试**

```ts
import assert from "node:assert/strict";
import { appendRankSnapshots, RANK_SNAPSHOT_MAX_PER_KEY } from "../src/engine/rank-snapshots";

const base = { keyword: "night walk", language: "en", storefront: "us", totalResults: 200 };
const now = Date.now();
const snap = (offsetMs: number, rank: number | null, checkedAt = new Date(now - offsetMs).toISOString()) => ({
  ...base, rank, checkedAt,
});

console.log("✅ PASS: appendRankSnapshots dedupes by exact key (incoming wins)");
const merged = appendRankSnapshots([snap(1000, 5)], [snap(1000, 3)]);
assert.equal(merged.length, 1);
assert.equal(merged[0].rank, 3);

console.log("✅ PASS: appendRankSnapshots keeps only the newest per key");
const capped = appendRankSnapshots(
  Array.from({ length: RANK_SNAPSHOT_MAX_PER_KEY + 20 }, (_, i) => snap(i * 1000, i)),
  [],
);
assert.equal(capped.length, RANK_SNAPSHOT_MAX_PER_KEY);

console.log("✅ PASS: appendRankSnapshots drops snapshots outside the 90-day window");
const old = appendRankSnapshots([snap(91 * 24 * 60 * 60 * 1000, 2)], [snap(1000, 4)]);
assert.deepEqual(old.map((s) => s.rank), [4]);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx tests/rank-snapshots.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/engine/rank-snapshots.ts`**

```ts
export interface RankSnapshotLike {
  keyword: string;
  language: string;
  storefront: string;
  rank: number | null;
  totalResults: number;
  checkedAt: string;
}

export const RANK_SNAPSHOT_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
export const RANK_SNAPSHOT_MAX_PER_KEY = 120;

export function appendRankSnapshots<T extends RankSnapshotLike>(existing: T[], incoming: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const snapshot of existing) byKey.set(snapshotKey(snapshot), snapshot);
  for (const snapshot of incoming) byKey.set(snapshotKey(snapshot), snapshot);

  const now = Date.now();
  const perKey = new Map<string, T[]>();
  for (const snapshot of byKey.values()) {
    if (now - new Date(snapshot.checkedAt).getTime() > RANK_SNAPSHOT_WINDOW_MS) continue;
    const key = `${snapshot.keyword}\u0000${snapshot.language}\u0000${snapshot.storefront}`;
    const list = perKey.get(key) || [];
    list.push(snapshot);
    perKey.set(key, list);
  }
  const result: T[] = [];
  for (const list of perKey.values()) {
    list.sort((a, b) => new Date(a.checkedAt).getTime() - new Date(b.checkedAt).getTime());
    result.push(...list.slice(-RANK_SNAPSHOT_MAX_PER_KEY));
  }
  return result;
}

function snapshotKey(snapshot: RankSnapshotLike): string {
  return `${snapshot.keyword}\u0000${snapshot.language}\u0000${snapshot.storefront}\u0000${snapshot.checkedAt}`;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx tests/rank-snapshots.test.ts`
Expected: PASS。

- [ ] **Step 5: 接入 package.json 并提交**

`test` 与 `test:ci` 追加 `&& tsx tests/rank-snapshots.test.ts`。

```bash
git add src/engine/rank-snapshots.ts tests/rank-snapshots.test.ts package.json
git commit -m "feat: 排名快照去重与 90 天时间窗口"
```

---

### Task 2: 关键词字段补齐、在榜元数据与连续未在榜判定（rank-keywords）

**Files:**
- Create: `src/engine/rank-keywords.ts`
- Create: `tests/rank-keywords.test.ts`
- Modify: `package.json`（test / test:ci 加入 `tsx tests/rank-keywords.test.ts`）

**Interfaces:**
- Consumes: `RankSnapshotLike`（Task 1）
- Produces:
  ```ts
  export type KeywordStatus = "active" | "paused";
  export type KeywordSource = "ai" | "submission" | "name" | "subtitle" | "manual";
  export interface TrackedKeywordLike { language: string; keyword: string; rationale?: string; translation?: string; status?: KeywordStatus; source?: KeywordSource; addedAt?: string; bestRank?: number | null; lastSeenAt?: string | null; pausedAt?: string | null; pausedReason?: string | null; }
  export const PAUSE_CONSECUTIVE_MISSES = 10;
  export function normalizeTrackedKeyword(item: any, now?: string): TrackedKeywordLike;
  export function enrichKeywordFromSnapshots<T extends TrackedKeywordLike>(keyword: T, snapshots: RankSnapshotLike[]): T;
  export function evaluatePause<T extends TrackedKeywordLike>(keyword: T, snapshots: RankSnapshotLike[], consecutive?: number): T;
  ```

- [ ] **Step 1: 写失败测试**

```ts
import assert from "node:assert/strict";
import {
  enrichKeywordFromSnapshots,
  evaluatePause,
  normalizeTrackedKeyword,
  PAUSE_CONSECUTIVE_MISSES,
} from "../src/engine/rank-keywords";

const snap = (storefront: string, rank: number | null, i: number) => ({
  keyword: "night walk", language: "en", storefront, rank, totalResults: 200,
  checkedAt: new Date(Date.now() - (100 - i) * 3600_000).toISOString(),
});

console.log("✅ PASS: normalizeTrackedKeyword fills defaults");
const normalized = normalizeTrackedKeyword({ language: "en", keyword: "night walk" });
assert.equal(normalized.status, "active");
assert.equal(normalized.source, "manual");
assert.ok(normalized.addedAt);

console.log("✅ PASS: enrichKeywordFromSnapshots computes bestRank and lastSeenAt");
const enriched = enrichKeywordFromSnapshots(normalized, [snap("us", 8, 1), snap("us", 3, 2), snap("us", null, 3)]);
assert.equal(enriched.bestRank, 3);
assert.ok(enriched.lastSeenAt);

console.log("✅ PASS: evaluatePause pauses only after consecutive misses in every mature storefront");
const misses = Array.from({ length: PAUSE_CONSECUTIVE_MISSES }, (_, i) => snap("us", null, i));
const paused = evaluatePause({ ...normalized, status: "active" }, misses);
assert.equal(paused.status, "paused");
assert.match(paused.pausedReason || "", /连续 10 次未在榜/);

const mixed = [...misses.slice(0, PAUSE_CONSECUTIVE_MISSES - 1), snap("us", 5, 99)];
assert.equal(evaluatePause({ ...normalized, status: "active" }, mixed).status, "active");
assert.equal(evaluatePause({ ...normalized, status: "active" }, [snap("us", null, 1)]).status, "active");
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx tests/rank-keywords.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/engine/rank-keywords.ts`**

```ts
import type { RankSnapshotLike } from "./rank-snapshots";

export type KeywordStatus = "active" | "paused";
export type KeywordSource = "ai" | "submission" | "name" | "subtitle" | "manual";

export interface TrackedKeywordLike {
  language: string;
  keyword: string;
  rationale?: string;
  translation?: string;
  status?: KeywordStatus;
  source?: KeywordSource;
  addedAt?: string;
  bestRank?: number | null;
  lastSeenAt?: string | null;
  pausedAt?: string | null;
  pausedReason?: string | null;
}

export const PAUSE_CONSECUTIVE_MISSES = 10;

export function normalizeTrackedKeyword(item: any, now = new Date().toISOString()): TrackedKeywordLike {
  return {
    language: item.language || "unknown",
    keyword: item.keyword,
    rationale: item.rationale || "",
    translation: item.translation || "",
    status: item.status === "paused" ? "paused" : "active",
    source: (["ai", "submission", "name", "subtitle", "manual"] as const).includes(item.source)
      ? item.source
      : "manual",
    addedAt: item.addedAt || now,
    bestRank: typeof item.bestRank === "number" ? item.bestRank : null,
    lastSeenAt: item.lastSeenAt || null,
    pausedAt: item.pausedAt || null,
    pausedReason: item.pausedReason || null,
  };
}

export function enrichKeywordFromSnapshots<T extends TrackedKeywordLike>(
  keyword: T,
  snapshots: RankSnapshotLike[],
): T {
  let best: number | null = null;
  let lastSeen: string | null = null;
  for (const snapshot of snapshots) {
    if (snapshot.keyword !== keyword.keyword || snapshot.language !== keyword.language) continue;
    if (snapshot.rank == null) continue;
    if (best === null || snapshot.rank < best) best = snapshot.rank;
    if (lastSeen === null || new Date(snapshot.checkedAt).getTime() > new Date(lastSeen).getTime()) {
      lastSeen = snapshot.checkedAt;
    }
  }
  return { ...keyword, bestRank: best, lastSeenAt: lastSeen };
}

export function evaluatePause<T extends TrackedKeywordLike>(
  keyword: T,
  snapshots: RankSnapshotLike[],
  consecutive = PAUSE_CONSECUTIVE_MISSES,
): T {
  const own = snapshots
    .filter((s) => s.keyword === keyword.keyword && s.language === keyword.language)
    .sort((a, b) => new Date(a.checkedAt).getTime() - new Date(b.checkedAt).getTime());
  const byStorefront = new Map<string, RankSnapshotLike[]>();
  for (const snapshot of own) {
    const list = byStorefront.get(snapshot.storefront) || [];
    list.push(snapshot);
    byStorefront.set(snapshot.storefront, list);
  }
  const mature = [...byStorefront.values()].filter((list) => list.length >= consecutive);
  if (mature.length === 0) return keyword;
  const allMissed = mature.every((list) => list.slice(-consecutive).every((s) => s.rank == null));
  if (!allMissed) return keyword;
  return {
    ...keyword,
    status: "paused",
    pausedAt: keyword.pausedAt || new Date().toISOString(),
    pausedReason: `连续 ${consecutive} 次未在榜（${mature.map((l) => l[l.length - 1].storefront).join("、")}）`,
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx tests/rank-keywords.test.ts`
Expected: PASS。

- [ ] **Step 5: 接入 package.json 并提交**

```bash
git add src/engine/rank-keywords.ts tests/rank-keywords.test.ts package.json
git commit -m "feat: 跟踪关键词字段补齐、在榜元数据与连续未在榜判定"
```

---

### Task 3: 主进程接入（调度、采集写入、保存归一化、失败上限）

**Files:**
- Modify: `src/main/ipc.ts`

**Interfaces:**
- Consumes: `appendRankSnapshots`（Task 1）、`normalizeTrackedKeyword` / `enrichKeywordFromSnapshots` / `evaluatePause`（Task 2）
- Produces: `RankScheduledTask.consecutiveFailures?: number`；`projects:resumePausedKeyword` IPC（Task 4 使用）

- [ ] **Step 1: 引入工具函数**

在 `ipc.ts` 顶部按需 import：
```ts
const { appendRankSnapshots } = await import("../engine/rank-snapshots");
const { enrichKeywordFromSnapshots, evaluatePause, normalizeTrackedKeyword } = await import("../engine/rank-keywords");
```
（按现有文件的动态 import 风格在函数内引入，或顶部静态 import，二选一保持一致。）

- [ ] **Step 2: `reconcileRankTasks` 归一化 + 元数据 + 暂停判定**

在每个 product 的 `const tracked: any[] = product.trackedKeywords || [];` 之后：

```ts
let tracked: any[] = (product.trackedKeywords || []).map(normalizeTrackedKeyword);
const snapshots = product.rankSnapshots || [];
tracked = tracked.map((keyword) => evaluatePause(enrichKeywordFromSnapshots(keyword, snapshots), snapshots));
if (JSON.stringify(tracked) !== JSON.stringify(product.trackedKeywords)) {
  product.trackedKeywords = tracked;
}
```

在关键字循环里跳过已暂停词：`if (keyword.status === "paused") continue;`

保留任务字段：`ScheduledTaskBase` 增加 `consecutiveFailures?: number`；重建任务时 `consecutiveFailures: previous?.consecutiveFailures || 0`。

- [ ] **Step 3: `runRankTask` 去重窗口 + 元数据 + 失败上限**

成功分支把
```ts
product.rankSnapshots = [...previous, snapshot].slice(-5000);
```
改为
```ts
product.rankSnapshots = appendRankSnapshots(previous, [snapshot]);
product.trackedKeywords = (product.trackedKeywords || []).map((keyword: any) =>
  enrichKeywordFromSnapshots(keyword, product.rankSnapshots),
);
task.consecutiveFailures = 0;
```

失败分支：
```ts
task.consecutiveFailures = (task.consecutiveFailures || 0) + 1;
task.lastStatus = "failed";
if (task.consecutiveFailures >= 5) {
  task.enabled = false;
}
```

- [ ] **Step 4: `projects:collectRanks` 与 `projects:saveTrackedKeywords` 接入**

`projects:collectRanks` 把 `[...previous, ...result.snapshots].slice(-5000)` 改为 `appendRankSnapshots(previous, result.snapshots)`。
`projects:saveTrackedKeywords` 存储前 `trackedKeywords.map(normalizeTrackedKeyword)`。

- [ ] **Step 5: 验证**

Run: `npm run typecheck && npm test`
Expected: 全绿。

- [ ] **Step 6: 提交**

```bash
git add src/main/ipc.ts
git commit -m "feat: 主进程接入快照去重/自动暂停/失败上限"
```

---

### Task 4: 恢复暂停词 IPC + 渲染层（矩阵过滤与折叠区）

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/stores/project.ts`
- Modify: `src/renderer/App.tsx`（KeywordsPage）

**Interfaces:**
- Consumes: `projects:resumePausedKeyword`（Task 3 或本任务实现）
- Produces: `window.appilot.projects.resumePausedKeyword(productId, language, keyword): Promise<Project>`

- [ ] **Step 1: IPC + preload + store**

`ipc.ts` 新增 handler（参照 `projects:restoreTrackedKeyword`）：
```ts
ipcMain.handle("projects:resumePausedKeyword", async (_event, productId, language, keyword) => {
  const s = await getStore();
  const projects: any[] = s.get("projects") || [];
  const context = findProductContext(projects, productId);
  if (!context) throw new Error("Store product not found");
  const nextProjects = updateProductInProjects(projects, productId, (product) => ({
    ...product,
    trackedKeywords: (product.trackedKeywords || []).map((item: any) =>
      item.language === language && item.keyword === keyword
        ? { ...item, status: "active", pausedAt: null, pausedReason: null }
        : item,
    ),
  }));
  s.set("projects", nextProjects);
  void schedulerTick();
  return nextProjects.find((project) => project.id === context.project.id) || context.project;
});
```

`preload/index.ts` 在 `projects` 下暴露 `resumePausedKeyword`；`src/renderer/stores/project.ts` 增加同名 action（调用 IPC 后用返回的 project 更新 `projects` 状态）。

- [ ] **Step 2: 矩阵过滤暂停词**

`KeywordsPage` 派生值改为：
```ts
const trackedActive = tracked.filter((k) => k.status !== "paused");
const pausedForCurrent = tracked.filter((k) => k.status === "paused");
```
`matrixRows = matrixFilterKeywords(trackedActive, currentLang)`；`chartKeyword` 默认值用 `trackedActive[0]`。

- [ ] **Step 3: 折叠区展示暂停词**

折叠区标题改为「已删除 / 已暂停关键词（{removedForCurrent.length + pausedForCurrent.length}）」；暂停词条目提供「恢复」（调用 `resumePausedKeyword`）与「删除」（复用 `removeTracked`，会移入已删除区）；已删除条目保持「恢复」与「清空」。

- [ ] **Step 4: 验证**

Run: `npm run typecheck && npm test`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add src/main/ipc.ts src/preload/index.ts src/renderer/stores/project.ts src/renderer/App.tsx
git commit -m "feat: 已暂停关键词恢复入口与矩阵过滤"
```

---

### Task 5: 文档同步与收尾

**Files:**
- Modify: `docs/superpowers/specs/tracking-keywords-improvement.md`（§5/§6 补充已落地细节：90 天窗口、120 条/键、失败 5 次暂停、10 次未在榜）
- Modify: `docs/superpowers/specs/appilot-ui.md`（§8.5 补充「已暂停」折叠区）

- [ ] **Step 1: 同步文档**

按实现回写规格与 UI 文档。

- [ ] **Step 2: 全量验证**

Run: `npm run typecheck && npm run build && npm test`
Expected: 全绿。

- [ ] **Step 3: 提交并推送**

```bash
git add docs/superpowers/specs/tracking-keywords-improvement.md docs/superpowers/specs/appilot-ui.md
git commit -m "docs: 同步自动屏蔽与采集健壮性规格"
git push -u origin codex/tracking-keywords-phase2
```
