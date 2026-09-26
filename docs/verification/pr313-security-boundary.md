# PR #313 review: security boundary and verification

The review covers stored AI credentials and copied credential files. A compromised renderer's arbitrary IPC calls and operating-system permission failures cannot be reproduced reliably through normal UI automation. The targeted isolated tests below exercise those specific boundaries; the PR's existing CI still covers the ordinary app workflows.

Failure modes identified before writing the review tests and fixes:

1. `listModels` or `testConnection` requests a different valid HTTPS endpoint with `useStoredKey`; the old Key is sent to that endpoint.
2. `saveConfig` changes the endpoint with an empty Key; the old Key remains and a later AI request sends it to the new endpoint.
3. An unchanged endpoint with an empty Key should retain the saved Key and keep connection/model discovery working.
4. An explicit new Key with a changed endpoint should replace the old Key.
5. Equivalent URL spelling (trailing slash, default port, host case) should not lose a valid Key; different host, port, path, or protocol must not inherit it.
6. Invalid or disallowed provider URLs should be rejected before any stored configuration is changed.
7. The Settings page must refresh its stored-Key state after saving and must not keep a stale `hasStoredKey` value in the model-list callback.
8. A new `.p8` copy must not be returned if owner-only permission setup fails; a partially copied file must not remain.
9. An already managed or deduplicated `.p8` file must be tightened before use; a tightening failure must not be reported as successful import.
10. A legacy config file must be made owner-only before it is renamed as a migration artifact. On permission failure, migration must leave the source and completion marker untouched. On Windows, POSIX mode is not an access-control guarantee, so this review does not claim a Windows ACL change.
11. Screenshot paths saved before #313 are absent from the new allowlist, so old previews disappear. Finalized history is read-only, leaving no way to reselect and restore them.
12. Reauthorization must require an exact file selection in a native dialog. Canceling or selecting a different/missing file must not add an arbitrary renderer-supplied path to the allowlist; choosing the matching existing image should restore its preview without editing finalized content.

## Verification record

Environment: macOS 26.6.2 arm64, Node.js 26.7.0, lockfile dependencies installed with `npm ci --ignore-scripts`. The test inputs are synthetic Key strings and files in system temporary directories; no production credential or database was used.

Commands from this branch:

```sh
./node_modules/.bin/tsx tests/url-policy.test.ts
./node_modules/.bin/tsx tests/asc-key-file.test.ts
./node_modules/.bin/tsx tests/kv-migrate.test.ts
npm run typecheck
npm run build
npm test
./node_modules/.bin/tsc --noEmit
git diff --check
```

Before the fix, the new endpoint policy test could not import its module; the private-key test reported five failed checks (managed-path tightening, three chmod-failure paths, and partial-copy cleanup); the migration test found that chmod failure did not throw. After the fix, all three targeted files passed. `npm run typecheck`, `npm run build`, and the final `tsc --noEmit` passed. `npm test` exited 0 with 1,244 output lines; its CLI and MCP process-level suites ended with `CLI 端到端测试全部通过 ✓` and `MCP 端到端测试全部通过 ✓`. `git diff --check` passed.

`docs/verification/pr313-test-summary.log` is the retained log excerpt with line numbers from the 1,244-line run. The full output was captured in the task's temporary directory during the run; the command above regenerates it. The native screenshot dialog interaction still requires a visual app check; automated build and type checks verify its wiring but do not prove the user interaction.
