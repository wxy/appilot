# PR #311 review verification

Known and reasonably foreseeable failure paths, recorded before repair tests and implementation:

1. Removing a source screenshot leaves the saved source image in place; removing a localized override fails to restore inheritance from the source image. An image edit must preserve text, translations, other languages, and the persisted draft's newest state.
2. A renderer-supplied image path can bypass the image preview allowlist through the new save IPC. Selected paths should save, but arbitrary, missing, and non-image paths should be rejected. A removal has no incoming path and must still work.
3. Image edits against a confirmed batch, an unknown screenshot type, or an unselected language must be rejected. A late image dialog must not overwrite AI text saved meanwhile.
4. Combining PR #311 with #313 must retain the native picker authorization and the exact preview allowlist behavior. Type checking and the existing screenshot path checks guard this integration; visual Electron interaction remains a separate gate.

The image patch is isolated because the native Electron picker cannot reliably reproduce a late dialog, AI save, and per-language image removal in a headless run. The integrated code will also be checked with the full repository suite. Commands, inputs, and observed results follow after verification.

## Reproduction and result

- Environment: macOS, Node and dependencies from `npm ci --ignore-scripts --no-audit --no-fund`; PR #311 integrated with current `master` (including #312 and #313). No live ASC or AI credential is required.
- Input: a screenshot copy with source language `en`, localized `zh-Hans`, one selected source image, and one localized override. The test removes the override and source image while checking preserved translations, inheritance, immutable prior snapshots, and confirmed batch rejection.
- Before implementation: `npx tsx packages/core/tests/screenshot-material.test.ts` failed at “移除覆盖时删除键而非存入空值”.
- After implementation: the same command and `npx tsx tests/screenshot-paths.test.ts` passed. `npm run typecheck` passed.
- Repository run: `npm test > docs/verification/pr311-full-test.log 2>&1` exited 0, including scheduler process tests and CLI/MCP end-to-end checks. The committed log is the reproducible artifact. `git diff --check` passed.
- Native Electron interaction with the system image picker, actual App Store Connect credentials, and the visual release workbench are not established by these automated checks.
