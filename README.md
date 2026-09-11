# Appilot

Appilot 是面向独立开发者的本地优先应用运营工作台：把代码仓库、App Store 商品、关键词排名、评价反馈、发布状态和 GitHub 运营数据放进一个桌面应用里。

当前版本：`1.0.1`。主界面由 Electron + React 提供，业务能力拆分为可复用的 TypeScript 包；SQLite 是跨桌面端、CLI、MCP 和调度进程共享的事实源。

## 已有能力

- 多项目与 iOS/macOS 产品管理，本地 Git 仓库信息解析
- App Store 关键词池、全球商店排名采集、竞品雷达与历史趋势
- 免费 RSS 评价同步、GitHub Issues 反馈聚合
- GitHub 发布、PR、流量与 Release 下载数据
- App Store Connect 版本、构建和本地化状态读取
- 商店文案草稿、AI 辅助生成与上线前检查
- 任务中心：状态、立即执行、失败清理/重排、暂停与加速
- SQLite 备份、清理和压缩
- 轻量 DSH 插件、Headless CLI 与 MCP 服务

## 架构

```text
packages/core          纯业务能力与外部 API
packages/headless      SQLite store、任务实例与无头服务
packages/scheduler     常驻调度 daemon 与控制 socket
src/main               Electron 主进程、凭据与系统集成
src/renderer           React 桌面界面
plugins                Appilot / Project / Release 等 DSH 插件
packages/mcp           MCP stdio 服务
packages/headless-cli  命令行入口
```

Electron 是唯一完整 GUI。DSH 只保留工具、结果卡片和 `/appilot` 命令；CLI/MCP 复用同一 SQLite 数据。详细边界见 [架构收敛说明](docs/architecture-convergence.md)。

## 本地开发

要求 Node.js 22 和 npm。

```bash
npm ci
npm run dev
```

常用校验：

```bash
npm run typecheck
npm test
npm run build
```

打包：

```bash
npm run dist:mac
```

## 数据与安全

- 默认数据库：`~/Library/Application Support/Appilot/appilot.db`
- GitHub、AI 和 App Store Connect 凭据通过 Electron `safeStorage` 加密；macOS 使用 Keychain，Windows 使用 DPAPI
- App Store Connect 私钥保存在应用数据目录，不提交到仓库
- 排名/评价等读取型能力默认不修改 App Store Connect 或 GitHub 远端状态
- `.env`、数据库、构建产物和用户凭据不得提交

产品路线和未完成事项见 [产品 Backlog](docs/product-backlog.md)，更多设计文档见 [docs](docs/README.md)。
