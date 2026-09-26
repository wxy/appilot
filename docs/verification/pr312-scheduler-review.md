# PR #312 scheduler review verification

Environment: macOS, Node.js 26.7.0, npm lockfile dependencies. No external service or account is required. The script creates an isolated SQLite database and socket under `TMPDIR` and removes them when it ends.

Reproduce from this branch:

```sh
npm ci --ignore-scripts
npm run build:core
node scripts/e2e-scheduler-yield-health.cjs | tee docs/verification/pr312-scheduler-e2e.log
```

Inputs and checks:

1. A live SQLite lease held by the parent process, with no reachable socket. The daemon CLI yields with exit code 0; `ensureScheduler()` must return `false` after the socket probe times out. Before the review fix it returned `true`.
2. A missing daemon executable. `ensureScheduler()` must return `false` without crashing its caller.
3. A real scheduler server started with `umask 000`. Its socket must have mode `0600`, and the client must be able to ping it. `ensureScheduler()` must return `true` for this reachable socket.
4. A real daemon CLI process with `fs.chmodSync` fault injected through `NODE_OPTIONS --require`. Startup must exit 1 and leave no socket file. The injection script is created and removed under the same temporary directory.

The generated log is the check artifact. It records each observed value and the daemon error from the injected failure. On the PR #312 head before the review fix, case 1 failed with `available: true` despite no socket; the assertion stopped the script with exit code 1.
