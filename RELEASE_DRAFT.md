# Appilot v0.2.0

## What's New

- Release workbench powered by a local `RELEASE_DRAFT.md`
- Generate App Store copy in the UI language, then translate to selected languages on demand
- Review and regenerate copy based on reviewer feedback
- Native macOS menu with project and release-workbench navigation
- New Appilot application icon

## Fixes & Engineering

- Stabilize release workbench state and hooks
- Prevent duplicate async translations
- Remove dead legacy IPC handlers
- Refresh native menu automatically when projects change
- Clean PostCSS configuration warning

## Deployment Notes

- Version bumped to 0.2.0
- No schema or migration required

## Verification

- Tests: npm test
- Builds: npm run typecheck, npm run build

---

# Appilot v0.2.0

## 新增功能

- 发布工作台改为读取本地 `RELEASE_DRAFT.md`
- 使用界面语言生成 App Store 文案，再按需翻译到其他语言
- 支持根据审核/修改意见重新生成
- 新增原生 macOS 菜单，支持项目和发布工作台导航
- 新增 Appilot 应用图标

## 修复与工程

- 稳定发布工作台状态和 React Hooks 顺序
- 防止异步翻译重复触发
- 清理已废弃的旧 IPC 接口
- 项目变更时自动刷新原生菜单
- 清理 PostCSS 配置警告

## 部署说明

- 版本升级到 0.2.0
- 无需数据库迁移

## 验证

- 测试：npm test
- 构建：npm run typecheck、npm run build
