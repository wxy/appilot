# Appilot v1.3.0 — npm packages

This release publishes the nine public `@appilot-labs/*` packages. It does not include a new desktop installer; the latest downloadable macOS DMG remains v1.2.0.

## What's New

- Release preparation now keeps store copy and Keynote screenshot suites separate by platform. Final copy can be revised without overwriting the prior approved version, and the workbench shows release facts across platforms.
- Post-release promotion has its own X series workflow with per-storefront copy and final image selection.
- Rankings adds keyword localization suggestions, collection budget controls, and comparisons across several keywords.

## Reliability and Security

- Scheduler startup verifies a connectable control socket; arbitration, permissions, self-update, and process-exit handling are more robust.
- AI credentials, App Store Connect private keys, screenshot previews, and proxied requests have tighter main-process boundaries.
- Release change boundaries, merged PR ordering, iTunes timeouts, AI streaming retries, screenshot removal, and snapshot retention are corrected.
- CI now runs lint, type checking, and the full test suite before npm publishing. MCP initialization reports the package's actual version.

## Upgrade Notes

- All nine public packages and their internal dependency ranges move together to `1.3.0` / `^1.3.0`.
- Shared SQLite schema 16 adds `lease.leaderPid`; migration runs when the shared store opens.
- No new signed, notarized, or downloadable desktop build is part of this npm release.

---

# Appilot v1.3.0 — npm 包

本次发布九个公开的 `@appilot-labs/*` 包，不包含新的桌面安装包；目前可下载的 macOS DMG 仍是 v1.2.0。

## 新增功能

- 发布工作台按平台隔离商店文案与 Keynote 截图套件；已定稿文案可以修订并保留旧版，多平台发布事实可一并查看。
- 上架后推广有独立的 X 系列流程，按商店平台准备文案并选择最终配图。
- 排名模块增加关键词本地化建议、采集预算治理和多词对比。

## 可靠性与安全

- 调度器启动检查可连接的控制 socket，并强化仲裁、权限、自更新与退出处理。
- 收紧 AI 凭据、App Store Connect 私钥、截图预览和代理请求的主进程边界。
- 修复发布变更范围、合并 PR 排序、iTunes 超时、AI 流式重试、截图移除与快照保留清理。
- npm 发布前 CI 执行 lint、类型检查和完整测试；MCP 初始化报告实际包版本。

## 升级说明

- 九个公开包统一升级到 `1.3.0`，内部依赖范围同步为 `^1.3.0`。
- 共享 SQLite schema 16 新增 `lease.leaderPid`，打开存储时自动迁移。
- 本次 npm 发布不包含新的已签名、公证或可下载的桌面安装包。
