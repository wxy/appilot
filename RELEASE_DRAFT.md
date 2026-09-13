# Appilot v1.2.0 — Evidence to action

## What's New

- Copilot is now an actionable workspace: suggestions retain product and storefront context, support contextual follow-ups, define measurable outcomes, and dispatch only registered actions.
- The release workbench now starts with a fresh GitHub release check, separates copy-plan and submission states, and makes release progress easier to verify.
- Screenshot production now covers localized copy, Keynote document generation, image replacement, and localized PNG export.
- Overview recommendations are grounded in current product and ranking evidence, while deterministic rank diagnostics explain actionable anomalies.
- Task scheduling is safer: automatic work can be balanced earlier without delaying cadence, daemon restart is atomic, and schedule provenance survives restarts.
- Trends and Reviews were removed because the available data did not yet justify standalone modules.

## Fixes & Engineering

- Release drafts, copy plans, checklists, and screenshot materials now use more stable product/version identities and migration paths.
- Copilot suggestions preserve lifecycle state and avoid recomputing user-visible identities from list order.
- Scheduler startup, self-update, signal handling, task execution facts, and Windows plugin build gates were hardened.
- The package family and all internal `@appilot-labs/*` dependency ranges move together to 1.2.0.

## Deployment Notes

- Target: `master` after the release pull request is merged.
- Public packages: nine `@appilot-labs/*` packages, published through npm Trusted Publishing with provenance.
- Database: schema 15 adds `tasks.scheduleJson`; migration runs automatically when the shared SQLite store opens.
- macOS screenshot generation asks for Apple Events permission to automate Keynote.
- Trends/reviews routes and their collectors are intentionally unavailable after upgrade.

## Verification

- Tests: `npm test` passed, including multiprocess, daemon, migration, Copilot, release-material, and Keynote automation coverage.
- Typecheck: `npm run typecheck` passed.
- Build: `npm run build` passed on macOS; GitHub Actions remains the merge gate.
- Visual assets: all SVGs rendered successfully; hero and banner text bounds, icon edge alpha, XML validity, and README constraints passed.

---

# Appilot v1.2.0 — 从证据到行动

## 新增功能

- 副驾升级为可执行工作区：建议会保留产品与商店上下文，支持上下文追问，定义可衡量结果，并且只分派已注册行动。
- 发布工作台会先执行实时 GitHub 发布检查，区分文案计划与提交状态，并让发布进度更容易核验。
- 截图生产流程覆盖本地化文案、Keynote 文稿生成、图片替换与多语言 PNG 导出。
- 总览建议基于当前产品与排名证据；确定性排名诊断用于解释值得行动的异常。
- 调度更加安全：自动任务可以提前削峰而不延后原节奏，守护进程原子重启，计划来源在重启后仍可追溯。
- 趋势与评论模块已移除，因为当前可用数据尚不足以支撑独立模块。

## 修复与工程

- 发布草稿、文案计划、检查清单和截图素材使用更稳定的产品/版本身份与迁移路径。
- 副驾建议保留生命周期状态，不再从列表顺序重新计算用户可见身份。
- 强化调度器启动、自更新、信号处理、任务执行事实与 Windows 插件构建门禁。
- 包家族及全部内部 `@appilot-labs/*` 依赖范围统一升级到 1.2.0。

## 部署说明

- 目标：发布 PR 合并后的 `master`。
- 公开包：9 个 `@appilot-labs/*` 包，通过 npm Trusted Publishing 携带 provenance 发布。
- 数据库：schema 15 新增 `tasks.scheduleJson`；共享 SQLite 存储打开时会自动迁移。
- macOS 截图生成会请求 Apple Events 权限以自动化 Keynote。
- 升级后趋势/评论路由及其采集器将不可用，这是有意的产品收敛。

## 验证

- 测试：`npm test` 已通过，覆盖多进程、守护进程、迁移、副驾、发布素材与 Keynote 自动化。
- 类型检查：`npm run typecheck` 已通过。
- 构建：`npm run build` 已在 macOS 通过；GitHub Actions 仍作为合并门禁。
- 视觉资产：全部 SVG 已成功渲染，Hero/横幅文字边界、图标边缘 alpha、XML 有效性与 README 约束均已通过。
