# Appilot → DeepSeek Harness 迁移设计（v1）

日期：2026-08-31
状态：待评审
作者：codex 会话结论 + 本次盘点核实

> 决策背景：v0.4.4 已作为独立版 Electron 里程碑发布。产品战略转向
> 「Harness 插件为主」，独立 Electron 版保留并继续发布 DMG。
> 仓库策略已确认：**现有仓库内改造为 npm workspaces monorepo，不新建仓库**。

---

## 1. 目标

把 Appilot 从「Electron 单宿主应用」重构为「单一核心 + 多宿主」：

```text
Appilot Core（纯 TS，零宿主依赖）
   ├── Electron 宿主（apps/desktop）→ 继续发布 DMG
   └── DSH 插件（plugins/dsh-appilot）→ Harness 主形态，npm 发布
        └── 未来 profile（profiles/appilot）→ 定制 Harness 发行版
```

核心纪律（继承自上次 Codex 会话）：

1. **@appilot/core 永远不绑定任何宿主**（Electron / Harness 都不绑定），可脱离宿主独立测试。
2. **不再把核心逻辑写进 Electron 主进程或 renderer**——新采集器、指标、AI prompt、
   release 状态机一律进 core。
3. **状态单一所有权**：迁移期间明确 Electron 与插件各自的存储 owner，禁止双写同一份数据。

## 2. 现状盘点（已核实）

### 2.1 代码分层

| 层 | 位置 | 规模 | 依赖 | 归属 |
|---|---|---|---|---|
| 核心 | `src/engine/` + `src/engine/ai/` | 30 个文件 | 仅 `openai`、`@octokit/rest` + node 内置 | → `@appilot/core` |
| 宿主 | `src/main/`（IPC/窗口/调度/存储）、`src/preload/`、`src/renderer/` | 23 个文件引用 engine（108 处 import） | electron、electron-store、react、recharts 等 22 项 | → `apps/desktop` |
| 测试 | `tests/` | 51 个文件 | tsx + node:assert | 随 core 迁移，desktop 保留宿主相关 |

### 2.2 engine 纯净性（已验证）

- `src/engine/` 无任何 `from "electron"` / electron-store / electron-log 实际引用
  （仅 `logger.ts` 注释提及 electron-log 的宿主实现）。
- engine 模块为**注入式纯函数/异步函数**：如 `runReadinessChecks(input)`、
  `buildProjectProfile(input)`、`deriveVersionStatus(input)`——数据由宿主提供，
  engine 不直接访问存储。这是 Phase 1 几乎零重构的直接依据。
- `src/engine/index.ts` 文件头已自声明 `// @appilot/engine — Core engine logic
  (pure TypeScript, zero Electron/React dependency)`，迁移意图已埋好。

### 2.3 依赖归属（package.json 全量核实）

- **core 专属（2 项）**：`openai`、`@octokit/rest`
- **desktop 专属（22 项）**：`electron`、`electron-log`、`electron-store`、
  `electron-vite`、`electron-builder`、`react`、`react-dom`、`react-markdown`、
  `react-router-dom`、`recharts`、`remark-gfm`、`tailwind-merge`、`zustand`、
  `clsx`、`@vitejs/plugin-react`、`postcss`、`autoprefixer`、`tailwindcss`、
  `typescript`、`tsx`、`@types/react`、`@types/react-dom`
- **插件专属（新增）**：`@deepseek-ai/cordis`（DSH 运行时已随 `@deepseek-ai/dsh`
  安装；插件 SDK 依赖以 Phase 2 实际 API 为准）

## 3. 目标布局（npm workspaces monorepo）

```text
appilot/
├── package.json                  # workspaces: ["packages/*", "apps/*", "plugins/*"]
├── .gitignore                    # + node_modules 各层、.build-cache/
├── docs/                         # 保持现状
├── packages/
│   └── core/                     # ← src/engine + src/engine/ai 迁入
│       ├── package.json          #   name: "@appilot/core", deps: openai, @octokit/rest
│       ├── tsconfig.json
│       ├── src/                  #   engine 全部模块（保留相对结构）
│       └── tests/                #   engine 相关测试（约 40 个文件）迁入
├── apps/
│   └── desktop/                  # ← 现 Electron 应用整体移入
│       ├── package.json          #   依赖 @appilot/core (workspace:*)
│       ├── electron-builder.yml
│       ├── electron.vite.config.ts
│       ├── tailwind.config.ts / postcss.config.cjs
│       ├── resources/
│       ├── src/main/ src/preload/ src/renderer/
│       └── tests/                #   desktop 宿主相关测试（如有）
└── plugins/
    └── dsh-appilot/              # ← 新建（Phase 2）
        ├── package.json          #   name: "@appilot/dsh", dsh.bundle 字段
        ├── cordis.patch.yml
        ├── src/
        │   ├── index.ts          #   apply(ctx)：注册 tools/jobs/storage
        │   └── tools/            #   resolve_current_project 等
        └── tests/
```

### 3.1 根级工程配置迁移

| 现在（根） | 迁往 |
|---|---|
| `package.json`（scripts/deps） | 根保留 workspaces + 聚合脚本；desktop 相关进 `apps/desktop/package.json` |
| `tsconfig.json` | 各包独立 tsconfig + 根 references |
| `electron.vite.config.ts`、`electron-builder.yml`、`tailwind.config.ts`、`postcss.config.cjs`、`resources/`、`vite-env.d.ts` | `apps/desktop/` |
| `.release.env`、`.release.env.example`、`.secrets/` | 保持根或随 desktop（release 只对 desktop） |
| `tests/` | 按 engine/desktop 归属拆分到对应包 |

## 4. core 接口盘点（Phase 2 工具映射的依据）

### 4.1 纯函数（无 IO，直接可测）

| 模块 | 主要导出 | Phase 2 用途 |
|---|---|---|
| `errors.ts` | `AppError`/`EngineError`/`ApiError`/`apiErrorFromStatus`/`isAppError`/`formatError` | 工具错误规范化 |
| `readiness-check.ts` | `runReadinessChecks(input)` | `check_release_readiness` |
| `project-profile.ts` | `buildProjectProfile(input)`、`profileToPromptBlock`、`archiveSystemPrompt` | `get_project_context` |
| `version-status.ts` | `deriveVersionStatus(input)`、`ascStoreLiveVersion` | release 状态查询 |
| `rank-keywords.ts` | `normalizeTrackedKeyword`、`enrichKeywordFromSnapshots`、`evaluatePause` | 关键词工具 |
| `rank-snapshots.ts` | 快照去重/窗口裁剪 | 排名查询 |
| `storefronts.ts` | `storefrontsForLanguage`、`sortLanguageCodes` | 商店参数校验 |
| `build-status.ts` | `mapBuildState`、`buildStatusForVersion`、`suggestedNextStep` | build 状态 |
| `overview-summary.ts` | `computeRankMovers`、`buildBriefInput` | 简报摘要 |
| `pre-release.ts` | 权限/能力标签、plist 解析 | 清单审计 |
| `store-submission.ts` | 字段限制、文案结构 | 文案工具 |
| `competitor-radar.ts` | `createCompetitor`、`normalizeCompetitorName` 等 | 竞品工具 |

### 4.2 异步 IO（Node 环境可用，DSH 插件同为 Node 运行时，可直接复用）

| 模块 | 主要导出 | IO 类型 |
|---|---|---|
| `git-info.ts` | `collectRepoInfo`、`getRemoteUrl`、`getCommitActivity` | git 子进程 |
| `github-api.ts` | `fetchRepoCapabilities`、`listGitHubReleases`、`fetchGitHubRelease`、`fetchMergedPullRequests` | 网络 |
| `gh-traffic.ts` | `fetchTrafficSnapshot`、`fetchReleaseAssetDownloads` | 网络 |
| `asc-api.ts` | `createAscClient`、`ascJwt` | 网络 + 密钥 |
| `review-collector.ts` | `parseReviewEntries`、`fetchAllStorefrontReviews` | 网络 |
| `feedback-inbox.ts` | `fetchIssues`、`mergeFeedbackItems` | 网络 |
| `rank-collector.ts` | `searchAppStoreRank`、`collectKeywordRankings` | 网络 |
| `release-watcher.ts` | release 检查（git tag / GitHub） | git + 网络 |
| `ai-provider.ts` / `ai-request.ts` / `ai/release-reviewer.ts` | `AIProvider`、`requestJson`、`reviewRelease`、`generateStoreSubmissionContent`、`translateStoreSubmissionContent` | AI 请求 |

### 4.3 需要宿主注入的边界

- **存储**：engine 无存储访问；宿主（Electron `electron-store` / DSH `ctx.storage`）负责
  读写并传入参数。Phase 1 保持该模式，Phase 4 为插件实现 storage 适配器。
- **凭据**：ASC key / GitHub token / AI key 由宿主凭据层持有（Electron store /
  DSH `ctx.credentials`），**不进模型上下文**。
- **调度**：`src/main/scheduler.ts` 的周期任务逻辑属宿主职责；其调用的 engine 纯函数
  可复用。Phase 4 映射为 DSH `ctx.jobs`/schedule。

## 5. Phase 1 迁移步骤（机械操作，目标：零行为变更）

> 原则：一次 `git mv` + 路径改写，**不做任何逻辑重构**；每步验证
> `npm run typecheck` + `npm test` 全绿。

- **T1 建 workspaces 骨架**：根 `package.json` 加 `workspaces` 字段；新建
  `packages/core/package.json`（name `@appilot/core`，version 与主版本一致，deps 仅
  openai + @octokit/rest + 开发用 typescript/tsx）。
- **T2 迁移 engine**：`git mv src/engine packages/core/src`（含 `ai/` 子目录）。
- **T3 改写 import**：全仓库 23 个文件、108 处 `../engine` 引用改为
  `@appilot/core` 包名导入（`git mv` 后由 desktop 引用 `@appilot/core`）。
  需要 engine 补一个完整的 `index.ts` 导出面（当前只有 5 个导出，模块均直接深路径
  引用——迁移时统一从 `@appilot/core` 入口导出，或先保深路径再收敛）。
- **T4 迁移测试**：`git mv tests/*.test.ts` 中 engine 相关 → `packages/core/tests/`；
  desktop 相关留在 `apps/desktop/tests/`。根 `test` 脚本改为聚合两处。
- **T5 移动 desktop 配置**：`git mv electron-builder.yml electron.vite.config.ts
  tailwind.config.ts postcss.config.cjs resources/ vite-env.d.ts` → `apps/desktop/`；
  相应改 script 路径。
- **T6 验证**：`npm run typecheck`、`npm test`、`npm run build`（desktop）全绿；
  与 v0.4.4 tag 的产物做一次 diff 冒烟（可选：`npm run dist:mac` 复验）。

**工作量估计**：T1–T6 均为机械迁移，核心风险是 import 路径遗漏（108 处）与
electron-vite 的 root 配置调整；预计可在数轮内完成，无逻辑改动。

## 6. DSH 插件设计（Phase 2 预览）

### 6.1 插件形态（已对照本机 `@deepseek-ai/dsh@0.1.1-rc.2` 确认）

- Cordis 插件：`apply(ctx)` 注册服务/事件/副作用；无特权内核。
- 分发：npm 包 + `package.json` 的 `dsh.bundle` + `cordis.patch.yml`。
- Profile：`dsh.profile` 声明 bundles 列表，`cordis.patch.yml` 为 patch 层。

### 6.2 首批工具（高价值、与 core 直接对应）

| 工具 | core 函数 | 说明 |
|---|---|---|
| `resolve_current_project` | `collectRepoInfo` + 宿主存储 | 识别当前仓库 → 项目 |
| `get_project_context` | `buildProjectProfile`、`profileToPromptBlock` | 平台/语言/商店/README 摘要 |
| `get_release_draft` | `release-watcher` + 存储 | 当前 release 草稿/最新 release |
| `check_release_readiness` | `runReadinessChecks` | 发布准备度清单 |
| `sync_release_status` | `deriveVersionStatus`、`github-api` | 刷新 ASC/商店/GitHub 状态 |
| `generate_store_copy` | `generateStoreSubmissionContent` | AI 生成文案 |
| `revise_store_copy` | 同上（baseLocalization 路径，0.4.4 已合并） | 按反馈修订 |

### 6.3 边界映射

| Electron 宿主职责 | DSH 插件职责 |
|---|---|
| `electron-store` 读写 | `ctx.storage`（Phase 4 适配器；MVP 可先用插件本地存储） |
| IPC handlers | `ctx.tools.register()` 工具 |
| `src/main/scheduler.ts` | `ctx.jobs` / schedule（Phase 4） |
| 凭据（ASC/GitHub/AI key） | `ctx.credentials`，不进模型上下文 |
| React UI | 初期不做 UI；后续用 Harness Web UI / conversation nodes |

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 108 处 import 改写遗漏 | T3 用 `grep -rn` 全量清单 + typecheck 兜底（漏一处即编译失败） |
| electron-vite root 调整破坏桌面构建 | T5 后立即 `npm run build` + 可选 dist:mac 复验 |
| engine 深路径引用依赖内部文件布局 | 迁移保留 `src/` 内部结构不变；index.ts 导出面逐步收敛 |
| Harness API 仍在迭代（0.1.1-rc） | core 与插件严格分层：core 不 import 任何 cordis/dsh 类型；API 变动只改插件层 |
| Electron 与插件双写同一存储 | 迁移期明确 owner（MVP：插件只读/独立存储）；Phase 4 后 desktop 退役或只读 |
| 凭据泄漏进模型上下文 | 凭据仅由凭据服务持有，工具只返回结构化结果 |

## 8. 发布策略

- **desktop**：继续 `npm run dist:mac` → DMG（v0.4.4 流程已跑通，含 DMG 手动公证+贴票）。
- **插件**：`plugins/dsh-appilot` 独立发布 npm（Phase 5）；用户通过
  `dsh plugin --profile appilot add @appilot/dsh` 安装。
- **profile**（Phase 6）：`profiles/appilot` 打包定制 Harness 发行版，面向非 Harness
  用户；未来可选桌面壳。
- **版本同步**：monorepo 单次提交原子更新 core/desktop/plugin，避免三份版本漂移。

## 9. 验收标准

1. Phase 1 完成后：`@appilot/core` 无任何 Electron/cordis 依赖；desktop 通过
   workspace 引用 core；51 个测试全绿；`npm run build` 通过。
2. Phase 2 完成后：`plugins/dsh-appilot` 可被安装到本机 DSH，`resolve_current_project`
   等 7 个工具可用，且 `generate_store_copy` 与 desktop 走同一 core 代码路径。
3. 迁移期间 desktop 版本可持续发布（v0.4.4 已发布；v0.4.5+ 均从 monorepo 出包）。
