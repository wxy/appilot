# @appilot-labs/dsh 客户端 UI（web）

浏览器端插件：为 Appilot 工具注册自定义 toolview 卡片（含 SVG 图表）。

## 结构

- `client/client.js` — 手写 `window.__ModuleLoader__` 模块（无需构建工具链），
  声明在 `package.json` 的 `dsh.client`（platform: web）。

## 加载链路（web profile）

1. 插件包被宿主 loader 装载（bundle / profile patch）。
2. `dsh-client-modules` 节点端扫描到 `dsh.client` 声明，编入 `__DSH_BOOT__` 入口图，
   提供 `/plugins/@appilot-labs/dsh/client.js`。
3. 浏览器端 `__ModuleLoader__` 加载本模块；`apply(ctx)` 经 `ctx.slots.inject`
   注册 `tool.call.toolview` 卡片（键 = 工具名）。

## 部署与验证

- **插件集变更需重启** profile（包元数据按名缓存）。
- client bundle 内容变更经 `ClientModuleRegistry.rebuilt`（dev:web HMR 链路）。
- 当前 headless 无 web 表层，卡片在真实 Web UI 中的渲染待 web profile 部署验证
  （见 `docs/migration/appilot-harness-ui.md` §4）。

## 依赖

`react` / `react/jsx-runtime` 与 `@deepseek-ai/*` 客户端包均由宿主前端提供；
卡片组件使用宿主 CSS 变量（`--dsw-alias-*`）适配主题。
