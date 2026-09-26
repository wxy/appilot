# PR #314 review verification

Known and reasonably foreseeable failure paths, recorded before review tests and implementation:

1. With a release boundary and multiple divergent frontier refs, selecting one heuristic “union tip” omits files from another ref. A stale side ref can even replace the active main ref and make `diffStat` describe only stale files.
2. Existing commits before the boundary on a stale side ref must stay excluded, while post-boundary commits on separate active refs must both appear. Single-ref and unbounded behavior must remain coherent.
3. A PR created long before the others but merged most recently can be excluded when Search results are sorted by creation time and the code stops at 50 results. Results must be ordered by actual merge time after retrieval.
4. Search pagination, missing `pull_request.merged_at` with valid `closed_at`, token fallback, and the no-cutoff path must retain their current contracts.
5. The iTunes request may stall before headers or during body decoding. Both phases need the same finite timeout; success, non-OK, malformed JSON, and network failure still need their current null/success behavior.

The frontier check uses a temporary real Git repository. The GitHub and iTunes network failure cases require local response substitution because public services cannot reliably be made to return a chosen order or hang after headers. These isolated checks target only those external boundaries. Commands, inputs, and observed results follow after execution.

## Reproduction and result

- Environment: macOS arm64, Node v26.7.0, dependencies from `npm ci --ignore-scripts --no-audit --no-fund`; PR #314 head `abdc472` plus this repair. The Git test creates and removes its own repository in the system temporary directory. No GitHub or App Store credential is needed.
- Input: one release boundary, a stale side branch with an older commit, and then a new commit on each of two active branches; 60 merged PR responses with an old-created PR merged most recently; iTunes responses whose headers or body stall beyond 25 ms.
- Before implementation: `npx tsx packages/core/tests/release-watcher-frontier.test.ts`, `npx tsx packages/core/tests/github-merged-prs.test.ts`, and `npx tsx packages/core/tests/app-store-lookup-timeout.test.ts` each failed on the new assertion.
- After implementation: all three commands passed. `npm run typecheck`, full `npm test` (including real scheduler process, CLI, and MCP checks), and `git diff --check` passed.
- This report is the durable reproduction artifact: rerun the commands above from a clean checkout after `npm ci --ignore-scripts --no-audit --no-fund`. Public GitHub pagination beyond the first 300 Search results is still a documented partial-result boundary; the code logs a warning when it occurs. Visual release-workbench interaction and live iTunes response timing were not established by these automated checks.

## Integration with #311

- Combined the #314 React Hooks empty-project guard with #311's advisory rank budget. The single budget value is computed after the guard, without introducing a conditional hook.
- Retained both new top-level test commands in `package.json` (`ai-stream-retry` and `screenshot-paths`).
- `npm run typecheck` passed after resolving the integration conflicts. `npm test > docs/verification/pr314-integration-test.log 2>&1` exited 0, including CLI/MCP process checks. The committed log records this integrated run.
