# PR #316 review verification

The new React Hooks lint rule runs for pull requests, but the master push build and tag/manual publish preflight omit `npm run lint`. A direct master push or an arbitrary release tag can therefore pass those workflows without the same Hooks gate. Add the existing command to their type-check and preflight jobs.

Verification environment: macOS arm64, Node v26.7.0, dependencies from `npm ci --ignore-scripts --no-audit --no-fund`. Before and after the workflow edit, `npm run lint` exited 0 with 0 errors and 1,835 baseline warnings. The warnings are the PR's deliberate baseline; React Hooks rules are errors. `npm run typecheck`, `npm run build`, and `git diff --check` passed. Run the repository suite again on the integrated branch, then require the original PR's GitHub checks to pass. An actual npm publish is outside verification because it would create public package versions; the workflow path is verified by source and the local preflight commands.
