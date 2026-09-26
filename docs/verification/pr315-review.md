# PR #315 review verification

Known and reasonably foreseeable failure paths, recorded before repair tests and implementation:

1. The prune boundary accepts a timezone offset but compares its original text with UTC `checkedAt` values; a row newer than the actual instant can be counted or deleted. Existing rows also mix seconds and millisecond precision, so a canonical boundary alone cannot fix lexical ordering. Preview and deletion must compare actual instants.
2. Calendar-invalid dates (for example February 30) and timezone-less local datetimes are syntactically accepted but lack the intended absolute boundary. Reject them; date-only input means UTC midnight.
3. A concurrent snapshot insert between the preview count and the deletion can cross the 50% threshold without `force`. Recount and delete under one immediate SQLite transaction. A fully deterministic process race is unsuitable as a normal regression test; code inspection and real SQLite behavior checks cover the transaction boundary.
4. Keep existing contracts: unknown projects error; dry run never deletes; over-50% requires `force`; exactly 50% is allowed; other projects remain untouched; CLI/MCP route through the guarded service.

The CLI scenario uses a real SQLite database and process. Commands, environment, inputs, results, and retained artifacts follow after execution.

## Reproduction and result

- Environment: macOS arm64, Node v26.7.0; dependencies installed with `npm ci --ignore-scripts --no-audit --no-fund`. No live service credentials are required.
- Input: a temporary SQLite project with snapshots at `2026-08-31T23:00:00.000Z` and `2026-09-01T00:00:00Z`; dry-run boundaries `2026-09-01T00:00:00+08:00` and `2026-09-01T00:00:00.500Z`; invalid `2026-02-30T00:00:00Z` and timezone-less `2026-09-01T00:00:00`.
- Before repair: `npm run build -w @appilot-labs/appilot-headless && npm run build -w @appilot-labs/appilot-headless-cli && npx tsx packages/headless-cli/tests/cli.test.ts` failed because the offset boundary matched one row instead of zero. `npx tsx packages/headless/tests/snapshots-prune-guard.test.ts` failed because February 30 was accepted.
- After repair: both commands passed, including unknown project, dry run, exactly 50%, over 50% with/without force, mixed timestamp precision, and no deletion on rejected inputs. `npm run typecheck` and `git diff --check` passed.
- The CLI output above is the end-to-end run; this report preserves the command, environment, inputs, and results. The race is closed by using the existing `BEGIN IMMEDIATE` transaction wrapper for the count, threshold decision, and delete. A deterministic cross-process insertion at precisely the former gap would require a test-only hook and is not claimed as observed.

## Integration with current master

- The repair and PR #315 merged cleanly with the current master that includes #311–#314.
- `npm run typecheck` passed. `npm test > docs/verification/pr315-integration-test.log 2>&1` exited 0; the committed log captures scheduler process, CLI, MCP, and repository test results from the combined tree.
