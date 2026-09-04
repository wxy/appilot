<!--
  This is the English README (shown on the npm page).
  Chinese version: [README.zh.md](./README.zh.md)
-->

# @appilot-labs/appilot-headless

Shared data + scheduling core: one SQLite database (`appilot.db`, WAL) plus an
instance task engine with lease-based single-leader scheduling. Every Appilot
shell reads/writes the same DB and executes the same task instances.

## Highlights

- **Single shared DB** — default path `~/Library/Application Support/Appilot/appilot.db`
  (override with `APPILOT_DB_FILE`); WAL + busy_timeout for multi-process safety
- **Store namespaces** — `projects`, `products`, `snapshots`, `tasks`, `lease`,
  `meta` (repo state), `releaseCache`
- **Lease single-leader** — `acquire / heartbeat / release`; heartbeat freshness decides
  takeover; same-id exclusivity prevents double daemons; TTL window is caller-supplied
  (all shells use 60s)
- **Instance task engine** — DB rows of `kind + instance` (github-sync / rank …),
  executed by the elected leader via registered executors; rate-limit (403/429)
  backoff and an in-flight concurrency cap are built in
- **Query service** — `createHeadlessService` for read-only views (tasks, rank progress…)
- **Legacy migration** — `importLegacyRegistry` imports old JSON registry once

## Install

```bash
npm i @appilot-labs/appilot-headless
```

## Usage

```ts
import { openStore, defaultDbPath } from '@appilot-labs/appilot-headless';
const store = openStore(process.env.APPILOT_DB_FILE || defaultDbPath());

store.lease.acquire('worker', 60_000);           // become leader
store.lease.heartbeat('worker');                 // renew while leader
store.projects.save({ name: 'demo', path: '/x', githubUrl: null, platform: 'ios',
  languages: ['en'], lastResolvedAt: new Date().toISOString(), artworkUrl: null,
  updatedAt: new Date().toISOString() });
store.tasks.upsert({ id: 'github-sync:demo', title: 'GitHub 发布同步', intervalMinutes: 60,
  lastRunAt: null, nextRunAt: new Date().toISOString(), lastStatus: 'never',
  lastSummary: null, runCount: 0, source: 'worker', kind: 'github-sync',
  instance: { projectName: 'demo', path: '/x' } });
store.snapshots.add([{ projectName: 'demo', productId: 'x:ios', keyword: 'kw',
  language: 'en', storefront: 'us', rank: 1, totalResults: 9,
  checkedAt: new Date().toISOString() }]);
store.lease.release('worker');
store.close();
```

CLI: `@appilot-labs/appilot-headless-cli`.

## Related

- `@appilot-labs/appilot-scheduler` — standalone daemon that drives this engine
- Repo docs: `docs/headless-architecture.md`, `docs/architecture-scheduler-daemon.md`
