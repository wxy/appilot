<!--
  This is the English README (shown on the npm page).
  Chinese version: [README.zh.md](./README.zh.md)
-->

# @appilot-labs/appilot-scheduler

Standalone App Store task scheduler daemon. It keeps collecting and running
scheduled task instances (github-sync, rank …) from the shared DB even when no
shell UI is open, and arbitrates a single leader with the other shells.

## Highlights

- **Runs headless** — no UI required; daemon stays resident (launchd `install` supported)
- **Single-leader lease** — only the lease owner ticks tasks; shells/daemon arbitrate
- **Socket control plane** — Unix socket JSON-RPC: status / runNow / accelerate /
  shutdown / checkUpdate (clients: shells `ensureScheduler`, CLI commands below)
- **Code self-update** — watches its own + `headless`/`core` dist; restarts itself
  automatically when files change (deploys take effect within ~60s)
- **Resilience** — rate-limit (403/429) exponential backoff on failures, in-flight cap

## Install & run

```bash
npm i @appilot-labs/appilot-scheduler
# start the daemon (shared DB by default)
npx appilot-scheduler
```

## CLI

```bash
appilot-scheduler            # run the daemon
appilot-scheduler status     # who is the current scheduler leader
appilot-scheduler stop       # graceful shutdown via socket
appilot-scheduler accel on|off [seconds]   # temporary fast drain
appilot-scheduler checkUpdate   # force a code self-check
appilot-scheduler install|uninstall   # launchd KeepAlive (macOS)
```

## Embedding in a shell

```ts
import { ensureScheduler, defaultSocketPath } from '@appilot-labs/appilot-scheduler';
await ensureScheduler({ socketPath: defaultSocketPath(), timeoutMs: 3000 });
```

## Environment

| Variable | Meaning |
| --- | --- |
| `APPILOT_DB_FILE` | shared DB path |
| `APPILOT_SCHEDULER_INCLUDE_RANK` | `0` to disable rank executor |
| `APPILOT_SCHEDULER_UPDATE_CHECK_MS` | code self-check interval (default 60s) |
| `APPILOT_SCHEDULER_MONITOR_DIRS` | override monitored dirs (testing) |

## Related

- `@appilot-labs/appilot-headless` — data + task engine this daemon drives
- Repo docs: `docs/architecture-scheduler-daemon.md`
