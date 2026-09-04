<!--
  This is the English README (shown on the npm page).
  Chinese version: [README.zh.md](./README.zh.md)
-->

# @appilot-labs/appilot-mcp

Appilot MCP server (stdio) — exposes the headless service API (projects / rank
snapshots / tasks) as standard [MCP](https://modelcontextprotocol.io) tools for
Claude Desktop, Cursor and any MCP client. Shares the same SQLite DB as
Electron / DSH / daemon.

## Tools

| Tool | Description |
| --- | --- |
| `projects_list` | list registered projects |
| `projects_get` | get a project by name |
| `projects_register` | register a project (path required) |
| `projects_remove` | remove a project |
| `snapshots_latest` | latest rank snapshot per (keyword, language, storefront) |
| `snapshots_history` | recent snapshot series, filterable |
| `snapshots_prune` | prune old snapshots before an ISO time |
| `tasks_list` | shared tasks + state, filterable by source |
| `task_run` | explicitly run a task instance (routes to the scheduler daemon) |

## Client config example (Claude Desktop)

```json
{
  "mcpServers": { "appilot": { "command": "appilot-mcp", "args": [] } }
}
```

## Environment

- `APPILOT_DB_FILE`: override DB path
