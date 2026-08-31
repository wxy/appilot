# Appilot → DeepSeek Harness 迁移设计（v1.1）

日期：2026-08-31
状态：待评审（v1.1 已纳入插件组决策 / 交互模式 / UI 能力修正）
作者：codex 会话结论 + 本次盘点核实 + 用户评审讨论

> 决策背景：v0.4.4 已作为独立版 Electron 里程碑发布。产品战略转向
> 「Harness 插件为主」，独立 Electron 版保留并继续发布 DMG。
> 仓库策略已确认：**现有仓库内改造为 npm workspaces monorepo，不新建仓库**。

> **会话分叉记录（v1.1）**：本设计文档是「打包发布」线程（v0.4.4 发布完毕，git 已封印）
> 与「插件版开发」线程的分界。此后工作只围绕插件版：monorepo 化 + DSH 插件。
> 独立版仅保持可发布状态（DMG 流程不变），不再新增独立版专属功能。

> **v1.1 新增决策（用户评审确认）**：
> 1. **插件组形态**：按功能域拆分为一组小插件 + 一个 Group 元插件组合，再配 profile。
>    见 §10「插件组拆分设计」。
> 2. **交互三模式**：AI 对话工具（主）→ Web UI 插件（界面）→ 定制 profile（启动即工作台）。
>    分阶段交付。见 §11「交互模式」。
> 3. **UI 能力修正**：Harness Web 前端是完整浏览器应用（`dsh-web-app` bundle +
>    `dsh-web-frontend` dist + 约 30 个 `dsh-client-ui-*` 浏览器插件 + `webPlugins`
>    装载服务），**可渲染图表/表格/自定义交互**，不存在「只能一对一对话」的硬限制。
>    真实约束是 0.1.x 插件 UI 注册 API 的对外成熟度与工作量。见 §12。

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

## 10. 插件组拆分设计（v1.1）

Harness 原生支持插件组（`cordis-plugin-group` / `Group`，Cordis loader 一等公民；
DSH 自身即由数十个小插件组合而成）。Appilot 按功能域拆分，用户可整装或按需安装：

```text
@appilot/project      项目识别/上下文（resolve_current_project、get_project_context）
@appilot/release      发布草稿/文案生成与修订/readiness（get_release_draft、
                      check_release_readiness、generate_store_copy、revise_store_copy）
@appilot/keywords     关键词/排名/竞品（关键词工具集、竞品查询）
@appilot/reviews      评论洞察/反馈收件箱（主题聚类、反馈查询）
@appilot/workbench-ui 界面插件（后置，注册 conversation 节点/命令/设置页）

组合层：
@appilot/appilot      Group 元插件：组合上面全部（装一个=全功能）
profiles/appilot      定制 profile：bundles=[dsh-base, dsh-web-app, @appilot/*]
                      + 默认 patch，`dsh --profile appilot` 启动即工作台
```

拆分原则：按功能域（数据流天然低耦合），不按文件；core 内的领域逻辑保持单一
代码路径（任何插件调用的生成/修订逻辑与 desktop 完全相同）。

## 11. 交互模式（v1.1）

| 模式 | 机制 | 阶段 |
|---|---|---|
| AI 对话（主） | `dsh-tools` 注册工具，Agent 对话中自动调用 | Phase 2 交付 |
| Web UI 插件 | `dsh-client-ui-*` 同款浏览器插件：注册 conversation 节点/命令/设置页/侧边栏 | Phase 3 交付 |
| 定制 profile | `profiles/appilot` 预装整套 + 默认界面；未来桌面壳包装 | Phase 6 交付 |

三种模式不互斥；profile 决定默认组合，tools 决定 agent 能力，UI 插件决定人机界面。

## 12. UI 能力与风险修正（v1.1）

**已核实**：Harness Web 表层 = `dsh-web-app`（浏览器 bundle）+ `dsh-web-frontend`
（构建好的前端 dist）+ 约 30 个 `dsh-client-ui-*` 浏览器插件（conversation/commands/
settings/sidebar/jobs/workflow-run/plan/deliverables… 各有浏览器端 `client.js` 实现），
装载走 `webPlugins` 服务（`__DSH_BOOT__` 入口图 + lazy-CJS module table）。
→ 前端是完整 Web 应用，**图表（recharts 等）、表格、画布、自定义交互均可实现**。

**真实约束（非能力限制）**：
1. 0.1.x 插件 UI 注册 API 的对外文档与稳定性：第三方插件注册自定义视图的具体入口
   需 spike 验证（webPlugins 对**外部**插件的暴露面）。
2. 工作量：在 Harness Web 内重建关键词矩阵/趋势图 = 完整前端工程投入。
3. 布局/主题集成：初期适配 Harness UI 体系，独立品牌靠 profile 定制。

**Phase 2 spike 新增验证项**：注册一个自定义 conversation 节点渲染 recharts 图表
的最小 demo，证明图表/表格可行性后，再定 workbench UI 路线。

## 13. Phase 1 范围调整（v1.1）

- T5（desktop 整体迁入 `apps/desktop`）**推迟**到 core 抽取验证通过之后单独执行，
  降低一次性改动风险。
- core 发布形态：`packages/core` 用 tsc 编译到 `dist/`（declaration 开启），
  desktop 通过 `dependencies: {"@appilot/core": "workspace:*"}` 引用；
  electron-vite `externalizeDepsPlugin` 外部化后运行时加载编译产物；
  electron-builder 会把 workspace 包打进 asar。
- 引用改写量实测：`@engine` 别名仅配置层 2 处（可删除）；`src/` 内相对路径
  `../engine` 43 处；renderer 不直接引用 engine（0 文件）；测试经
  `../src/engine/*` 引用（随测试迁移一并改写）。

## 14. Phase 2 进度（2026-08-31）

**已交付并验证**：`plugins/dsh-appilot`（`@appilot/dsh`）首个插件，4 个只读工具
（resolve_current_project / get_project_context / get_release_draft /
check_release_readiness），全部走 `@appilot/core` 同一代码路径。

- 形态：ESM 插件；`@deepseek-ai/cordis` + `dsh-tools` 为 peer 依赖（宿主提供）。
- 验证：tsc 零错误；单元测试 5 断言；**真实 Harness headless 端到端**——模型调用
  `resolve_current_project` 返回正确项目信息（会话日志含工具调用记录）。
- 本机验证方式：`dsh --profile headless --patch plugins/dsh-appilot/dev.cordis.yml "…"`
  （需先 `npm run build -w @appilot/dsh` 生成 dist）。

**工具已补齐（2026-08-31，插件共 7 个工具）**：新增 `sync_release_status`
（git tag + GitHub release 状态）、`generate_store_copy` / `revise_store_copy`
（@appilot/core AI 管线；凭据走 `APILOT_AI_*` 环境变量，不接受参数传 key 防泄漏）。
`sync_release_status` 已在真实 Harness headless 会话端到端验证（正确返回
v0.4.4 / v0.3.0 等 tag）。

**待办（后续轮次）**：
- 插件组拆分（域插件 + Group 元插件 + profile）
- 存储/凭据适配（ctx.storage / ctx.credentials，Phase 4：AI/GitHub/ASC 凭据迁入）
- UI spike：conversation 节点渲染 recharts 图表（验证 §12 结论）
