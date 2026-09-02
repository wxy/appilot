# @appilot-labs/appilot-mcp

Appilot MCP server（stdio）—— 把 headless 服务 API（项目 / 排名快照 / 定时任务）
暴露为标准 [MCP](https://modelcontextprotocol.io) 工具，供 Claude Desktop、Cursor、
任意 MCP 客户端调用。

与 Electron / DSH 共享同一 SQLite 数据库；任务定义与 DSH 一致（`buildHeadlessJobs`）。

## 工具

| 工具 | 说明 |
| --- | --- |
| `projects_list` | 列出已注册项目 |
| `projects_get` | 按名取项目 |
| `projects_register` | 登记项目（path 必填，name 缺省取 basename） |
| `projects_remove` | 移除项目 |
| `snapshots_latest` | 每 (keyword, language, storefront) 最新排名快照，可按 productId 过滤 |
| `tasks_list` | 共享任务定义 + 运行状态 |
| `task_run` | 立即运行共享任务（release-sync / readiness） |

## 客户端接入示例

Claude Desktop `claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "appilot": {
      "command": "appilot-mcp",
      "args": []
    }
  }
}
```

## 环境变量

- `APPILOT_DB_FILE`：覆盖数据库路径
- `GITHUB_TOKEN`：GitHub API 凭据（release-sync 用）

## 协议说明

MCP stdio transport = 换行分隔 JSON-RPC 2.0（每行一个 JSON 消息）。
支持 `initialize` / `notifications/initialized` / `ping` / `tools/list` / `tools/call`。
日志走 stderr，不污染协议流。

## 开发

```bash
npm run build -w @appilot-labs/appilot-mcp   # tsc → dist
npx tsx tests/mcp.test.ts                    # 端到端协议测试（spawn 进程）
```
