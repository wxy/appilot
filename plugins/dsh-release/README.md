<!--
  This is the English README (shown on the npm page).
  Chinese version: [README.zh.md](./README.zh.md)
-->

# @appilot-labs/appilot-release

Release domain tools for the DeepSeek Harness (DSH) Appilot plugin family:
GitHub release sync, readiness checks and release copy workflows.

## Tools

| Tool | Description |
| --- | --- |
| `sync_release_status` | sync git tags & GitHub releases for a repo |
| `check_release_readiness` | readiness checklist before a release |
| `get_release_draft` | current release draft |
| `revise_store_copy` / `generate_store_copy` | App Store copy drafting |

## Install in a DSH profile

```bash
npm i @appilot-labs/appilot-release
```

Consumed by the meta plugin `@appilot-labs/appilot`.
