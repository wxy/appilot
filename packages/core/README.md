<!--
  This is the English README (shown on the npm page).
  Chinese version: [README.zh.md](./README.zh.md)
-->

# @appilot-labs/appilot-core

App Store operations domain library — pure functions shared by every Appilot shell
(Electron app, DSH plugin, CLI, MCP). No shell or storage dependencies of its own;
lower layers (`headless`) provide persistence and scheduling.

## Highlights

- **Storefronts** — display names & language→storefront maps (`/storefronts`)
- **Rank collection** — App Store / iTunes search ranking collector (`/rank-collector`)
- **Project sync** — GitHub release inspection & sync (`/project-sync`)
- **Release & copy** — readiness checks, release drafts, store copy drafting
- **Reviews** — review stats / clustering helpers
- **AI helpers & logger** — provider abstraction and structured logging (`/logger`)

## Install

```bash
npm i @appilot-labs/appilot-core
```

## Usage (ESM subpath exports)

```ts
import { storefrontDisplayName } from '@appilot-labs/appilot-core/storefronts';
storefrontDisplayName('us'); // -> '美国'

import { searchAppStoreRank } from '@appilot-labs/appilot-core/rank-collector';
const r = await searchAppStoreRank({ term: 'flashlight', country: 'us', trackId: '…' });

import { inspectProjectRelease } from '@appilot-labs/appilot-core/project-sync';
const insp = await inspectProjectRelease('/path/to/repo', { token });
```

## Related

- `@appilot-labs/appilot-headless` — shared SQLite data + task engine (persistence)
- `@appilot-labs/appilot-scheduler` — standalone scheduler daemon
- Repo docs: `docs/headless-architecture.md`, `docs/architecture-convergence.md`
