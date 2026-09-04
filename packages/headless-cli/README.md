<!--
  This is the English README (shown on the npm page).
  Chinese version: [README.zh.md](./README.zh.md)
-->

# @appilot-labs/appilot-headless-cli

Command-line access to the headless service API (projects / snapshots / tasks /
lease) — no shell dependency. Reads & writes the same shared SQLite DB as
Electron / DSH / daemon.

## Usage

```bash
# show shared DB path
appilot-headless db

# project registry
appilot-headless projects list
appilot-headless projects get <name>
appilot-headless projects register <path> [--name <name>]
appilot-headless projects remove <name>

# rank snapshots
appilot-headless snapshots latest <project> [--product <id>]
appilot-headless snapshots history <project> [--product <id>] [--keyword <kw>] [--limit <n>]
appilot-headless snapshots prune <project> [--before <iso>]   # default: 90 days

# tasks & scheduling
appilot-headless tasks list [--source dsh|electron|cli|scheduler]
appilot-headless lease status          # current lease leader
appilot-headless run <taskId>          # explicit run
```

Output is JSON on stdout; errors go to stderr with non-zero exit — script/agent friendly.

## Environment

| Variable | Meaning |
| --- | --- |
| `APPILOT_DB_FILE` | override DB path (testing/isolation) |
