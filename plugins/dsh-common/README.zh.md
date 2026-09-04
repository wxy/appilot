<!-- 中文版说明（仓库内提供）。English: [README.md](./README.md) -->
# @appilot-labs/appilot-common

DeepSeek Harness（DSH）Appilot 工具插件的共享基建：凭据读取器、JSON/SQLite
项目存储、注册表工具与进程级共享 headless store 句柄。

## 亮点

- `ctxCredentialReader` / `envCredentialReader` — 供插件使用的凭据读取
- `fileProjectStore` / `sqliteProjectStore` / `createProjectStore` — 项目注册表存储
- `openSharedHeadlessStore` — 每进程一份共享 headless store
- `resolveProjectRecord` / `mergeRegistry` / `jsonify` — 记录与注册表辅助

面向插件开发者；由 `@appilot-labs/appilot-project`、`@appilot-labs/appilot-release`
与 `@appilot-labs/appilot` 消费。
