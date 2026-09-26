# Appilot 1.3.0 npm release verification

Date: 2026-09-26. Base: `origin/master` at `892c99e` (after PR #316). Scope: nine public `@appilot-labs/*` packages. The macOS DMG remains v1.2.0 and is not an output of this run.

## Environment and inputs

- macOS arm64, Node v26.7.0, npm 11.19.0. Dependencies were already installed in the isolated worktree; the lockfile was regenerated with `npm install --package-lock-only --ignore-scripts --no-audit --no-fund --offline`.
- npm registry `latest` was 1.2.0 for each of the nine public packages before this release. Git tag `v1.3.0` did not exist.
- All eleven workspace/root manifests, the lockfile, and internal `@appilot-labs/*` ranges were checked: public package versions are 1.3.0 and internal ranges are `^1.3.0`.
- Process tests need a short socket path on macOS. Create `"$TMPDIR/a13"` for reproducible runs, then remove that task directory when finished. The first full test attempt used `"$TMPDIR/appilot-npm-1.3.0-20260926"`; its scheduler socket path was 107 bytes, and `cli-process.test.ts` could not connect. The scheduler suite passed with `"$TMPDIR/a13"`, then the full suite passed with the same setting.

## Commands and results

| Command | Input / observation | Result |
| --- | --- | --- |
| `npm test --workspace=@appilot-labs/appilot-mcp` before the MCP fix | Real stdio initialize response reported `serverInfo.version=0.1.0` while the package was 1.2.0 | Failed as expected; the end-to-end assertion exposed the existing drift. |
| `npm run build --workspace=@appilot-labs/appilot-mcp && TMPDIR="$TMPDIR/a13" npm test --workspace=@appilot-labs/appilot-mcp` | Real MCP child process, temporary SQLite database, initialize → tools/list → tool calls | Passed after deriving serverInfo.version from the package manifest. |
| `npm run lint` | Entire repository | Passed: 0 errors, 1,913 existing warnings. |
| `npm run typecheck` | Entire workspace | Passed. |
| `TMPDIR="$TMPDIR/a13" npm test` | Full workspace suite, including real scheduler/CLI/MCP child processes | Passed. |
| `npm run build` | Production core, plugins and Electron bundle | Passed. |
| `npm pack --dry-run --json --ignore-scripts` in each public package directory | Nine package manifests and built `dist/` output; DSH appilot also requires `client/` | Passed for all nine; each pack reports version 1.3.0 and includes `package.json` plus `dist/`. |
| `xmllint --noout assets/readme/*.svg`, then `render_svg.sh assets/readme/hero.svg ... 1280 480` and `render_svg.sh assets/readme/download-github.svg ... 420 96` | README hero shows source version 1.3.0; download button continues to name the published DMG 1.2.0 | XML passed; rendered labels and spacing were inspected in both PNGs. |
| `git diff --check` | Release branch changes | Passed. |

The npm pack check used the order in `docs/publishing.md`: core, headless, common, project, release, appilot, headless-cli, scheduler, mcp. Actual publication and registry propagation are verified separately by the tag-triggered GitHub Actions workflow and npm registry reads.
