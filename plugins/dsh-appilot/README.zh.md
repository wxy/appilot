<!-- 中文版说明（仓库内提供）。English: [README.md](./README.md) -->
# @appilot-labs/appilot

DeepSeek Harness（DSH）元插件：把 App Store 运营带进 agent 会话。架构收敛后它是
**轻量查询与命令面**——没有大型 GUI、不自行拉起调度器。

## 提供的能力

- **Agent 工具** — `appilot_tasks`（任务状态，按 kind 聚合）、`appilot_snapshots`
  （排名快照）、`appilot_task_run`（显式运行，路由到调度 daemon）、
  `appilot_overview`（总览聚合）；以及 `appilot-project` / `appilot-release`
  的项目与发布域工具
- **斜杠命令 `/appilot`** — 直读共享库、零模型 token：
  `projects`、`rank [项目]`、`release [项目]`、`task [clear|reschedule]`；
  结果渲染为主题色、默认全展开的卡片与表格
- 会话内**工具结果卡片**

## 在 DSH profile 安装

```bash
# profile 根（pnpm）：加依赖并声明 bundle
npm i @appilot-labs/appilot
# dsh：bundle id '@appilot-labs/appilot'
```

需要宿主 peer `@deepseek-ai/cordis@4.0.2`（由 DSH profile 提供）。
调度与数据采集由 Electron / 调度 daemon 负责，本插件不承担。

## 环境变量（可选）

- `APPILOT_DB_FILE` — 共享库路径覆盖
