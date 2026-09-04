<!--
  This is the English README (shown on the npm page).
  Chinese version: [README.zh.md](./README.zh.md)
-->

# @appilot-labs/appilot-common

Shared infrastructure for the DeepSeek Harness (DSH) Appilot tool plugins:
credential readers, JSON/SQLite project stores, registry helpers and the
process-wide shared headless store handle.

## Highlights

- `ctxCredentialReader` / `envCredentialReader` — credential access for plugins
- `fileProjectStore` / `sqliteProjectStore` / `createProjectStore` — project registry stores
- `openSharedHeadlessStore` — one shared `headless` store instance per process
- `resolveProjectRecord` / `mergeRegistry` / `jsonify` — record & registry helpers

Not intended for direct end-user use; consumed by `@appilot-labs/appilot-project`,
`@appilot-labs/appilot-release` and `@appilot-labs/appilot`.
