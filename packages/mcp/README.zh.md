<!-- 中文版说明（仓库内提供）。English: [README.md](./README.md) -->
# @appilot-labs/appilot-mcp

Appilot MCP server（stdio）——把 headless 服务 API（项目 / 排名快照 / 定时任务）
暴露为标准 [MCP](https://modelcontextprotocol.io) 工具，供 Claude Desktop、Cursor
及任意 MCP 客户端调用。与 Electron / DSH / daemon 共享同一 SQLite 数据库。

## 工具

| 工具 | 说明 |
| --- | --- |
| `projects_list` | 列出已注册项目 |
| `projects_get` | 按名取项目 |
| `projects_register` | 登记项目（path 必填） |
| `projects_remove` | 移除项目 |
| `snapshots_latest` | 每 (keyword, language, storefront) 最新排名快照 |
| `snapshots_history` | 最近时间序列点（可过滤） |
| `snapshots_prune` | 清理早于指定 ISO 时间的旧快照 |
| `tasks_list` | 共享任务 + 状态，可按来源过滤 |
| `task_run` | 显式运行任务实例（路由到调度 daemon） |

## 客户端接入示例（Claude Desktop）

```json
{
  "mcpServers": { "appilot": { "command": "appilot-mcp", "args": [] } }
}
```

## 环境变量

- `APPILOT_DB_FILE`：覆盖数据库路径
