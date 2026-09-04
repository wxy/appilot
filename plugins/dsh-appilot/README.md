<!--
  This is the English README (shown on the npm page).
  Chinese version: [README.zh.md](./README.zh.md)
-->

# @appilot-labs/appilot

Meta plugin for the DeepSeek Harness (DSH): App Store operations inside your
agent conversations. After architecture convergence it is a **lightweight query
& command surface** — no big GUI, no scheduler bootstrap.

## What you get

- **Agent tools** — `appilot_tasks` (task state, by-kind), `appilot_snapshots`
  (rank snapshots), `appilot_task_run` (explicit run, routed to the scheduler
  daemon), `appilot_overview` (aggregate overview); plus the project/release
  domain tools from `appilot-project` / `appilot-release`
- **Slash command `/appilot`** — direct DB reads with zero model tokens:
  `projects`, `rank [project]`, `release [project]`, `task [clear|reschedule]`;
  results render as themed, always-expanded cards with tables
- **Tool result cards** in the conversation

## Install in a DSH profile

```bash
# profile root (pnpm): add the dependency + declare the bundle
npm i @appilot-labs/appilot
# dsh: bundle id '@appilot-labs/appilot'
```

Requires host peer `@deepseek-ai/cordis@4.0.2` (provided by the DSH profile).
Scheduling & data collection are owned by the Electron app / scheduler daemon,
not by this plugin.

## Environment (optional)

- `APPILOT_DB_FILE` — shared DB path override
