# PR #316 review verification

The new React Hooks lint rule runs for pull requests, but the master push build and tag/manual publish preflight omit `npm run lint`. A direct master push or an arbitrary release tag can therefore pass those workflows without the same Hooks gate. Add the existing command to their type-check and preflight jobs.

Verification environment: macOS arm64, Node v26.7.0, dependencies from `npm ci --ignore-scripts --no-audit --no-fund`. Before and after the workflow edit, `npm run lint` exited 0 with 0 errors and 1,835 baseline warnings. The warnings are the PR's deliberate baseline; React Hooks rules are errors. `npm run typecheck`, `npm run build`, and `git diff --check` passed on the repair branch. An actual npm publish is outside verification because it would create public package versions; the workflow path is verified by source and the local preflight commands.

## Integration with current master

- The merge retained the new root test discovery runner and the already repaired KeywordsPage Hooks guard and advisory rank budget. All later test files are picked up automatically.
- On the combined tree, `npm run lint` passed with 0 errors and 1,913 baseline warnings, `npm run typecheck` passed, and `npm run build` passed.
- `npm test > docs/verification/pr316-integration-test.log 2>&1` exited 0. The new root runner reported 56/56 files passing; subsequent scheduler process, CLI, and MCP tests also passed. The committed log is the reproducible end-to-end artifact.
- The macOS and Windows GitHub platform build jobs, native Electron UI, and an actual npm publish remain outside local verification.
