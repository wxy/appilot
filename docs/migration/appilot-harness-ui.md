# Appilot × Harness Web UI 扩展研究（UI spike）

日期：2026-08-31
状态：结论已验证（API 级证据），骨架已落地（待 web profile 部署验证）
结论：**Harness Web 前端可渲染图表/表格/自定义交互**——用户在评审中坚持的判断成立。

## 1. 客户端插件机制（已核实，基于本机 @deepseek-ai/dsh@0.1.1-rc.2）

- **声明**：包的 `package.json` 写 `dsh.client`（`{ inject: [...], platform: 'web' }`）。
  示例：`dsh-client-ui-tool`。
- **发现**：`dsh-client-modules` 节点端扫描宿主 loader 条目中声明 `dsh.client` 的包，
  编入 `window.__DSH_BOOT__` 入口图，并通过 webserver 提供 `/plugins/<id>/client.js`。
  包元数据按名缓存，**插件集变化需重启生效**；bundle 内容经 `ClientModuleRegistry.rebuilt`
  更新。
- **加载**：浏览器端经 `window.__ModuleLoader__.load({ id, factory: (require) => ... })`
  （lazy-CJS 模块表），依赖（react、@deepseek-ai/* 客户端包）由宿主前端提供。
- **插件体**：模块命名导出 `apply` / `inject`（与宿主插件同约定）。

## 2. UI 扩展点：keyed slots

客户端插件通过 `ctx.slots.inject(slotName, () => ctx.slots.register({...}, Component))`
注册到 keyed slot；slot 键命中即替换默认渲染。与 Appilot 相关的槽位：

| slot | 用途 | 参考实现 |
|---|---|---|
| `tool.call.toolview` | 按工具名渲染**工具调用卡片**（键 = 工具名，命中替换通用行） | `dsh-client-ui-tool`（read/search/bash/edit 卡片） |
| `conversation.chat.node` | 按消息/节点类型渲染对话节点（user/assistant-step/command…） | `dsh-client-ui-conversation` |
| `conversation.input.dock` | 输入区停靠件（按钮等） | 同上 |
| `conversation.commandview` / `conversation.details.tool` | 命令视图 / 工具详情 | 同上 / ui-tool |

注册形状（照抄 `dsh-client-ui-tool` 的 FileMutationRow 模式）：

```js
ctx.slots.inject('tool.call.toolview', function* () {
  yield ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'resolve_current_project',   // 我们的工具名
    locale: 'en',
  }, ProjectCard);                    // React 组件
});
```

## 3. 图表可行性（核心结论）

- 卡片组件是**普通 React 组件**（`react` / `react/jsx-runtime` 由宿主提供），
  渲染任意 JSX——**recharts / SVG / 表格 / 画布均可**，不存在「只能一对一对话」的硬限制。
- 骨架已落地 `plugins/dsh-appilot/client/client.js`：为 `resolve_current_project` /
  `check_release_readiness` / `sync_release_status` 注册自定义卡片，内含**纯 SVG 条形图**
  组件（零新依赖，证明图表渲染）。
- 本前端已内置 dsh-client-ui-* 全家桶（约 30 个浏览器插件），卡片可用宿主 CSS 变量
  （`--dsw-alias-*`）适配主题。

## 3.5 可见入口 demo 已实现（2026-08-31）

`client/client.js` 新增两类可见入口（对照 Harness 自带插件模式）：

1. **`conversation.input.dock`**（输入区可展开面板）：头部点击展开/收起；展开后
   两列布局——左列操作按钮（经 `conversation.send()` 触发 agent 执行 Appilot
   工具，结果以 toolview 卡片呈现），右列信息面板（项目概览 + SVG 图表）。
   注入模式参照 QueueDock（`ctx.sessions.scope(sessionId).get('conversation')`）。
2. **`settings.section`**（设置页）：出现在设置导航的 Appilot 页（项目/凭据概览）。
   注册模式参照 dsh-client-ui-agent-preset。

已验证：Web 表层以 HTTP 200 服务更新后的 client.js（含新入口代码）。
浏览器端实际渲染需在真实 Web 会话中查看（本环境无浏览器）。

## 4. 待办/开放项（后续 UI 阶段）

1. **第三方 client bundle 构建路径**：web profile 需要该包的已构建 client 导出；
   `@appilot/dsh` 的 `client/client.js` 是手写 __ModuleLoader__ 格式，需确认 profile
   打包/重启流程能收录（在 dev:web 环境验证 HMR 链路）。
2. **部署验证**：把插件装进 web profile（`dsh plugin --profile web add …`）+ 重启后，
   在真实 Web UI 里看自定义卡片与图表（当前 headless 无 web 表层）。
3. **工作台路线**（§11 的 Phase 3）：
   - 第一阶段：tool.call.toolview 卡片（项目卡/清单卡/发布状态卡，本骨架）
   - 第二阶段：conversation.chat.node 注册 Appilot 专用节点（矩阵/趋势图）
   - 第三阶段：命令与设置页（凭据引导、项目注册表管理）
4. 图表数据绑定：从工具结果（`block`）解析出结构化数据喂给图表组件（骨架先用示例数据
   占位，UI 阶段接真实 result）。

## 5. 与 desktop 的关系

Electron 渲染层（recharts 等）的图表逻辑在 core 侧的数据结构（rank snapshots、趋势序列、
readiness 清单）保持单一来源；Web 端图表只是同一数据的另一种渲染宿主，不复制业务逻辑。
