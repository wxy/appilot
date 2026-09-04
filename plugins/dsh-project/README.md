<!--
  This is the English README (shown on the npm page).
  Chinese version: [README.zh.md](./README.zh.md)
-->

# @appilot-labs/appilot-project

Project domain tools for the DeepSeek Harness (DSH) Appilot plugin family:
register and resolve repositories that App Store operations track.

## Tools

| Tool | Description |
| --- | --- |
| `register_project` | register (or refresh) a repository path in the registry |
| `list_projects` | list registered projects |
| `resolve_current_project` | resolve the current workspace/project |
| `get_project_context` | project context (GitHub, platform, languages) |

Registry is shared with Electron via the shared SQLite DB.

## Install in a DSH profile

```bash
npm i @appilot-labs/appilot-project
```

Consumed by the meta plugin `@appilot-labs/appilot`.
