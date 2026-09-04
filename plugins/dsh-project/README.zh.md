<!-- 中文版说明（仓库内提供）。English: [README.md](./README.md) -->
# @appilot-labs/appilot-project

DeepSeek Harness（DSH）Appilot 插件族的项目域工具：登记并解析运营所跟踪的仓库。

## 工具

| 工具 | 说明 |
| --- | --- |
| `register_project` | 注册（或刷新）仓库路径到注册表 |
| `list_projects` | 列出已注册项目 |
| `resolve_current_project` | 解析当前工作区/项目 |
| `get_project_context` | 项目上下文（GitHub、平台、语言） |

注册表经共享 SQLite 与 Electron 共用。

## 在 DSH profile 安装

```bash
npm i @appilot-labs/appilot-project
```

由元插件 `@appilot-labs/appilot` 消费。
