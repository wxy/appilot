# @appilot-labs/appilot 客户端 UI（web）

浏览器端插件：Appilot 工作台 UI，两个入口——

1. **`conversation.view`**（id `appilot`, order 20）— 对话窗口第三个选项卡
   「Appilot」：工作台主界面（内部 tab：总览 / 发布 / 趋势）。
   - **总览页已接通数据**：从会话节点（`useSession(s => s.nodes)` 中的
     `tool-result` 节点）读取最近一次 Appilot 工具运行结果渲染：
     `resolve_current_project`（项目/平台/分支/语言）、
     `check_release_readiness`（通过/警告/失败清单）、
     `sync_release_status`（最新 tag/发布/草稿）。
   - **「刷新数据」按钮**：经 `conversation.send()` 让 agent 重跑三个工具，
     结果同时落在对话里（toolview 卡片）并自动回填总览。
2. **`tool.call.toolview`** — 工具结果卡片：`resolve_current_project` /
   `check_release_readiness` / `sync_release_status`。

（2026-09-01：侧边栏 `sidebar.footer.action` 迷你状态卡已按产品决策移除——入口收敛到
对话窗口的「Appilot」选项卡。）

## 结构

- `client/src/` — 客户端 UI 源码（TS/TSX）：
  - `index.tsx` — 入口：`apply` / `inject` 导出 + 样式注入
  - `workbench.tsx` — 工作台（总览/发布/趋势 tab；数据读**专属会话**节点；
    刷新/简报发到专属会话，不污染当前对话）
  - `dedicated-session.ts` — **专属会话编排**：每工作区一个 `[Appilot] <仓库名>`
    （find → create+rename，幂等）；sendToDedicated / dedicatedSessionObservable
  - `quick-actions.tsx` — 专属会话输入区快捷按钮（刷新总览/发布状态/采集排名/生成简报）
  - `tabs.tsx` — 「发布」「趋势」tab 的数据渲染（latestTag/发布列表/readiness/提交柱状条）
  - `overview-dsh.tsx` — **共享总览包装**：把 appilot_overview 结果映射成 Electron
    Project/StoreProduct 形状，渲染共享组件；注入 scoped tailwind；按宿主主题切 `.dark`
  - `toolcards.tsx` — 工具结果卡片（含 `appilot_overview` 聚合卡）
  - `helpers.ts` — 项目身份解析 / 工具结果解析 / 会话节点收集 / 状态音调
  - `styles.ts` — DSH 侧自有样式（宿主 CSS 变量）
  - `generated/tailwind-css.ts` — 构建生成：共享组件的 scoped tailwind 工具类
- **共享组件（Electron 与 DSH 共用同一套 UI）**：
  `../../src/renderer/components/overview/OverviewContent.tsx`（纯 props；
  Link 经 `LinkComponent` 注入，Electron 用 react-router、DSH 用 DshLink）。
  Electron 的 `OverviewPage.tsx` 已改为取数壳渲染该组件。
- `client/client.js` — **构建产物**（`window.__ModuleLoader__` lazy-CJS），勿手改；
  由 `scripts/build-client.mjs` 生成：先跑 scoped tailwind（preflight 关闭、
  darkMode class，输入 `client/src/tailwind.overview.css` 内含 `.ap-ov` 子树的
  box-sizing/字体/`--radius`/排版 scoped 重置），再 esbuild 内联共享组件 +
  recharts + react-router-dom + core 依赖，`external` 掉 `react` /
  `react/jsx-runtime` / `@deepseek-ai/*`。
- `scripts/smoke-test.mjs` — **SSR 冒烟测试**（`npm run test:client:smoke`）：
  在 Node 里用真实 React 渲染 bundle 注册的工作台组件（空态 + 全量数据两路径），
  抓渲染期崩溃（如无 Router 上下文时的 Link/useNavigate）。
- `scripts/contract-test.mjs` — **契约校验**（`npm run test:client:contract`）：
  双目标（真实仓库 + 商店 fixture）验证 appilot_overview 输出字段与客户端映射
  读取一致（lookup 依赖字段按 null 兜底分类）。
- 声明在 `package.json` 的 `dsh.client`（platform: web）。
  模块导出 `apply` 和 `inject`；当前 `inject = ['slots', 'sessions']`
  （`ctx.slots` 注册入口、`ctx.sessions.scope(id).get('conversation')` 触发刷新）。
  只导出 `apply` 会导致加载器报 `cannot get property "slots" without inject`。

## 加载链路（appilot profile）

1. 插件包被宿主 loader 装载（bundle / profile patch）。
2. `dsh-client-modules` 节点端扫描到 `dsh.client` 声明，编入 `__DSH_BOOT__` 入口图，
   提供 `/plugins/@appilot-labs/appilot/client.js`。
3. 浏览器端 `__ModuleLoader__` 加载本模块；`apply(ctx)` 经 `ctx.slots.inject`
   注册上述入口（React 组件，宿主提供 react / react/jsx-runtime）。

## 数据流（专属会话 + 总览页）

- **专属会话**（`[Appilot] <仓库名>`，每工作区一个）：Appilot 数据流的唯一执行地。
  「刷新数据」「生成简报」、专属会话输入区快捷按钮都经 `conversation.send()` 发到
  专属会话 → agent 运行工具 → 结果落在专属会话的对话里（**审计日志**，侧边栏可见），
  不污染用户正在工作的对话上下文。
- 面板 UI 不直接写 store；数据单一来源是「专属会话中的工具运行结果」。
- 读取：工作台按标题前缀 + cwd 认领专属会话（`findDedicatedId`），订阅其
  `binding.session`（getSnapshot/subscribe）读 `nodes`；`collectToolResults` 取
  `appilot_overview` 节点 → OverviewDsh 映射成 Project/StoreProduct 渲染共享组件。
- **服务端聚合工具** `appilot_overview`（`src/overview.ts`，元插件注册）：按需聚合
  项目身份 / git tags / GitHub releases / readiness 清单 / GitHub 流量（有 token 时）/
  商店元数据与当前版本（README 链接发现 trackId）/ 关键词实时排名（keywords 参数）/
  ASC 状态（凭据门控）/ AI 简报（includeBrief + OPENAI_API_KEY）。
- AI 用量：宿主 `tokenUsage` 会话投影（`useProjection('tokenUsage')`），不走工具。
- 触发：`refresh` / `refreshBrief`（inject 注入）→ `ensureDedicatedSession`（幂等
  创建）→ `conversation.send(prompt)` → 新节点到达 → 面板自动重渲染。

## 部署与验证（本地开发，无需发布 npm）

- 改 `client/src/` 后运行 `npm run build:client`（在 `plugins/dsh-appilot` 下），
  把产物 `client/client.js` 同步进 profile 的已安装副本：
  `~/.dsh/profiles/appilot/node_modules/@appilot-labs/appilot/client/client.js`，
  然后刷新 3099 页面（服务端按请求读盘、`cache-control: no-cache`，一般无需重启；
  若刷新后异常再重启 3099——manifest rev 在启动时计算）。
- 更省事的长期方案：把 profile 里 `node_modules/@appilot-labs/appilot` 换成指向
  工作区的 symlink（`ln -s`），改代码后只需构建 + 刷新，零 npm 步骤。
- 插件集/入口图变更（新增 slot 声明等）必须重启 profile（包元数据按名缓存）。

## 依赖

`react` / `react/jsx-runtime` 与 `@deepseek-ai/*` 客户端包均由宿主前端提供；
组件使用宿主 CSS 变量（`--dsw-alias-*`）适配主题（注入的样式 id：
`@appilot-labs/appilot/client.css`）。
