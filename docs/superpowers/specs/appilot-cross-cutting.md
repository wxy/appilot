# Appilot — MVP 设计文档


> 所属：[Appilot MVP 设计文档集](./README.md) | 状态：已确认 | 日期：2025-07-14 | 修订：2026-07-16（技术栈切换为 Electron/Node.js/TypeScript）
> 姊妹文件：[产品规格](./appilot-product.md) · [架构设计](./appilot-architecture.md) · [UI 设计](./appilot-ui.md) · [构建计划](./appilot-build-plan.md) · [横切关注点](./appilot-cross-cutting.md) · [评审记录](./appilot-review-log.md)
> 本文档定义 Appilot 的**横切关注点**：错误处理与韧性、国际化、后台策略、安全模型、项目文件结构。标注了 **Phase 0 简化版** vs **完整版**的差异。


## 9. 错误处理与韧性

> **Phase 0**：仅实现基础错误处理——API 调用失败提示 + 文件日志记录。不包含日志脱敏框架、诊断包导出、崩溃上报。详细日志策略（§9.3）推迟到 Phase 1。

### 9.1 分层错误模型

```
平台层 (Plugin)         →  PlatformException  (特定平台的错误)
引擎层 (Engine)         →  EngineException    (队列、调度、存储错误)
应用层 (Application)    →  转化为用户可读消息
展示层 (Presentation)   →  Toast / 内联错误 / 错误面板
```

### 9.2 关键场景处理

| 场景 | 处理策略 |
|------|----------|
| Token 过期 | Plugin 自动用 refresh_token 刷新，失败则引导用户重新授权 |
| API 限频 | Post Queue 暂停该平台队列，展示"限频等待中 (X 秒后重试)" |
| 网络断连 | 发布请求入队，网络恢复后自动重试。UI 显示"离线 — 3 篇待发送" |
| 发布部分成功 | 3/4 平台成功 → 展示成功列表 + 失败列表，失败的可单独重试 |
| 插件加载失败 | 记录日志 + 通知栏提示，其他插件正常工作 |
| 数据库损坏 | 启动时自动运行完整性检查，发现损坏 → 备份旧文件 + 新建数据库 + 从平台重新拉取数据 |
| AI API 调用失败 | 展示具体错误（超时/余额不足/Key 无效等），内容回退到本地草稿状态；支持重试和切换备用 Provider |
| 仓库扫描超时 | 大仓库（> 10,000 文件）可能扫描较慢 → 展示进度条 + 后台执行 + 支持取消；超时后使用已有缓存 |
| AI 返回空/异常内容 | 自动重试一次（调整 temperature），仍失败则降级为用户手动编写；记录 WARN 日志供排查 |

### 9.3 日志策略（全面可追踪）

由于 Appilot 作为桌面工具需要社区用户参与测试反馈，日志不仅是调试工具，更是收集用户反馈时定位问题的关键依据。

- **文件日志**：`~/.appilot/logs/` 下按天滚动（`appilot-2026-07-14.log`），保留 14 天
- **日志分级与覆盖范围**：

| 级别 | 记录内容 |
|------|----------|
| DEBUG | 所有 Engine 层操作入口/出口（Repo Analyzer 扫描开始/结束、AI Engine 调用、Plugin 方法调用）、状态变更、文件 I/O 操作 |
| INFO | 用户可见操作（项目创建、仓库连接、推广计划生成、文案生成、发布完成、URL 回填提取、PR 建议生成）、AI 每次调用的 token 用量和耗时、应用启动/退出 |
| WARN | 重试操作（API 限频重试、网络恢复重试）、AI 返回空内容、URL 提取降级、仓库扫描跳过超大文件 |
| ERROR | 所有异常堆栈、API 调用失败、数据库操作失败、OAuth 授权失败、插件加载失败 |

- **用户操作审计日志**：单独记录到 `~/.appilot/logs/audit.log`，包含 AI 操作（输入上下文摘要、输出内容摘要）、平台发布操作、PR 创建操作，用于用户自查"AI 帮我做了什么事"
- **日志不含凭据**：Token、密码、API Key 自动脱敏（替换为 `[REDACTED]`）
- **近期日志面板**：设置页内嵌"日志查看器"，用户可在应用内直接查看最近 200 条日志，无需找到文件路径
- **导出诊断包**：一键打包 `logs/` + 系统信息（OS 版本、Flutter 版本、已安装插件列表）+ 数据库统计（表行数、最后迁移版本），不含凭据和用户数据，生成 ZIP 供反馈 Bug 时使用

---


## 10. 国际化 (i18n) — Phase 1+

- **框架**: Flutter 原生 `flutter_localizations` + ARB 文件
- **MVP 语言**: 英文 + 中文
- **Phase 0**: 仅英文硬编码字符串。不做 ARB 文件，不做翻译框架
- **Phase 1**: 建立 ARB 框架（`app_en.arb`、`app_zh.arb`），所有用户可见文本通过 `AppLocalizations` 获取

---


## 11. 后台策略 — Phase 1+

**Phase 0**：无后台策略。应用关闭即退出，不做系统托盘、不做开机自启、不做定时轮询。所有数据操作由用户手动触发（点击"刷新分析"、"提交统计"等）。

### 11.1 Phase 1+ 方案：纯本地 + 追赶同步

- 应用开机自启动 + 系统托盘常驻
- 前台运行时定期轮询（默认每 5 分钟）
- 应用重新打开后执行"追赶式"数据拉取
- 凭据全程不离开本地

### 11.2 为未来后端预留

- `TaskScheduler` 和 `DataFetcher` 定义为接口
- 当前提供本地实现（`LocalTaskScheduler` + `LocalDataFetcher`）
- 将来可替换为远程实现（`RemoteTaskScheduler` + `RemoteDataFetcher`）
- 轻量后端仅做两件事：定时调度 + 数据暂存，不存储凭据

---


## 12. 安全模型

### 12.0 Phase 0：最小安全（无 OAuth、无凭据管理）

- AI API Key 通过 **electron-store** 持久化（明文 JSON 文件存储），Phase 1 迁移到 **safeStorage** 加密
- 无 OAuth Token（Phase 0 仅使用 Twitter Web Intent，不涉及平台 OAuth 授权）
- 草稿和历史记录存储在本地 SQLite（不加密）
- GitHub 公开仓库读取不需要 Token
- Electron 安全最佳实践：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，renderer 通过 `contextBridge` 暴露有限 API

### 12.1 Phase 1+：基础加密

- OAuth Token 通过 **safeStorage** 加密存储（macOS Keychain / Windows DPAPI）
- API Key 从 electron-store 明文迁移到 safeStorage 加密
- 草稿和历史记录存储在本地 SQLite（不加密）
- 不存储明文密码（使用 OAuth 2.0 授权码流程，Electron BrowserWindow 处理）

### 12.2 安全升级路径

- **付费层**：SQLCipher 加密数据库 + 主密码解锁
- 凭据仅内存解密，从不落盘明文

---


## 14. 项目文件结构

### 14.0 Phase 0 文件结构（最小）

```
appilot/
├── packages/
│   ├── desktop/                    # Electron 桌面应用
│   │   ├── src/
│   │   │   ├── main/               # Electron Main Process
│   │   │   │   ├── index.ts        #   应用入口、BrowserWindow 创建
│   │   │   │   └── store.ts        #   electron-store 初始化
│   │   │   ├── preload/
│   │   │   │   └── index.ts        #   contextBridge（暴露 engine API 给 renderer）
│   │   │   └── renderer/           # React UI
│   │   │       ├── index.html
│   │   │       ├── main.tsx        #   React 入口
│   │   │       ├── App.tsx         #   根组件 + 路由
│   │   │       ├── features/
│   │   │       │   ├── setup/      #   项目设置向导
│   │   │       │   ├── composer/   #   推文编辑器
│   │   │       │   ├── tracking/   #   帖子追踪
│   │   │       │   └── settings/   #   基础设置
│   │   │       ├── components/     #   共享 UI 组件 (shadcn/ui)
│   │   │       └── stores/         #   Zustand stores
│   │   ├── package.json
│   │   └── electron-builder.yml    #   打包配置
│   └── engine/                     # 纯 TypeScript 包（零 Electron 依赖）
│       ├── src/
│       │   ├── repo-analyzer.ts    #   Phase 0: 仅 GitHub 公开仓库
│       │   ├── content-store.ts    #   Phase 0: 草稿保存/加载
│       │   ├── analytics-engine.ts #   Phase 0: 仅手动填报
│       │   ├── database/
│       │   │   ├── schema.ts       #   drizzle-orm Schema 定义（5 张表）
│       │   │   └── index.ts        #   better-sqlite3 连接 + migration
│       │   ├── ai/
│       │   │   ├── ai-engine.ts    #   Phase 0: 产品摘要 + 推文生成
│       │   │   ├── ai-provider.ts  #   OpenAI 兼容 Provider
│       │   │   ├── ai-config.ts    #   配置模型
│       │   │   └── context-builder.ts # 单仓库上下文组装
│       │   └── index.ts            #   统一导出
│       ├── package.json
│       └── tsconfig.json
├── docs/
│   └── superpowers/specs/          # 设计文档
├── package.json                    # npm workspace root
└── README.md
```

**Phase 0 不存在的目录（Phase 1+ 添加）：**
- `packages/desktop/src/renderer/features/inbox/` — Phase 1
- `packages/desktop/src/renderer/i18n/` — Phase 1
- `packages/engine/src/plugin-registry.ts` — Phase 1
- `packages/engine/src/task-scheduler.ts` — Phase 1
- `packages/engine/src/event-bus.ts` — Phase 1
- `packages/engine/src/post-queue.ts` — Phase 1
- `packages/engine/src/credential-vault.ts` — Phase 1
- `packages/engine/src/project-registry.ts` — Phase 1
- `packages/engine/src/ai/reply-rules.ts` — Phase 5
- `packages/plugins/` — Phase 1
- `packages/server/` — 云端中转（独立项目，Phase 5+）

### 14.1 完整文件结构（Phase 5 完成后）

```
appilot/
├── packages/
│   ├── desktop/                    # Electron 桌面应用（全功能）
│   │   ├── src/main/               # Electron Main Process
│   │   ├── src/preload/
│   │   └── src/renderer/           # React UI（composer/inbox/analytics/settings）
│   ├── engine/                     # 纯 TypeScript 包（零依赖特定平台）
│   │   └── src/                    # 全部 Engine 组件
│   ├── plugins/                    # 平台插件（npm workspace packages）
│   │   ├── plugin-interface/       # Plugin 接口定义
│   │   ├── plugin-twitter/
│   │   ├── plugin-reddit/
│   │   ├── plugin-discord/
│   │   └── plugin-youtube/
│   └── server/                     # 云端中转（Phase 5+，独立可选项目）
├── docs/
├── package.json                    # npm workspace root
└── README.md
```

### 桌面端技术风险与缓解

| 依赖能力 | Phase 0 需要？ | 核心度 | 成熟度 | 风险 | 缓解策略 |
|----------|:---:|--------|--------|------|----------|
| Electron BrowserWindow | ✅ | 🔴 核心 | 成熟 | 无显著风险（Chromium 120+ 内嵌，macOS/Windows 一致） | — |
| better-sqlite3 | ✅ | 🔴 核心 | 成熟 | 原生 C++ addon，需在 Electron 环境下重新编译 | 使用 `electron-rebuild` 或 `@electron/rebuild` 自动处理 |
| GitHub REST API（公开） | ✅ | 🔴 核心 | N/A（HTTP） | 60 req/h 未认证限制 | 提示用户提供 PAT（5,000 req/h） |
| simple-git | ✅ | 🔴 核心 | 成熟 | 依赖系统 git CLI，Windows 上需安装 Git for Windows | 应用启动时检查 git 是否可用，不可用时给出下载链接 |
| octokit | ✅ | 🟡 | 成熟 | GitHub 官方 SDK，无显著风险 | — |
| 系统托盘 (Tray API) | ❌ Phase 1+ | 🟡 | **一等公民 API** | 无风险 | Electron Tray API 成熟稳定 |
| 自动更新 (electron-updater) | ❌ Phase 1+ | 🟡 | **一等公民** | S3/GitHub Releases 托管更新 | 10 万+ Star，Slack/VS Code/Discord 等千万级应用验证 |
| OAuth (BrowserWindow) | ❌ Phase 1+ | 🔴 | **零成本** | 无风险 | Electron BrowserWindow 直接打开授权页→监听 redirect URI→自动解析 code |
| 安全存储 (safeStorage) | ❌ Phase 1+ | 🔴 | 良好 | macOS Keychain / Windows DPAPI | Electron 原生加密 API |

**核心原则**：Phase 0 仅依赖 Electron BrowserWindow + better-sqlite3 + simple-git + octokit + fetch，全部为生产级成熟方案。

---

