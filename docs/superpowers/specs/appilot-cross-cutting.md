# Appilot — MVP 设计文档


> 所属：[Appilot MVP 设计文档集](./README.md) | 状态：已确认 | 日期：2025-07-14 | 修订：2026-07-14
> 姊妹文件：[产品规格](./appilot-product.md) · [架构设计](./appilot-architecture.md) · [UI 设计](./appilot-ui.md) · [构建计划](./appilot-build-plan.md) · [横切关注点](./appilot-cross-cutting.md) · [评审记录](./appilot-review-log.md)
> 本文档定义 Appilot 的**横切关注点**：错误处理与韧性、国际化、后台策略、安全模型、项目文件结构。


## 9. 错误处理与韧性

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


## 10. 国际化 (i18n)

- **框架**: Flutter 原生 `flutter_localizations` + ARB 文件
- **MVP 语言**: 英文 + 中文
- **Phase 1 建立框架**: 所有用户可见文本通过 `AppLocalizations` 获取，后续添加翻译只需加 ARB 条目，不动架构代码
- ARB 文件按模块组织：`app_en.arb`、`app_zh.arb`、`engine_en.arb`、`engine_zh.arb`

---


## 11. 后台策略

### 11.1 MVP 方案：纯本地 + 追赶同步

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

### 12.1 MVP：基础加密

- OAuth Token 存储在系统原生 Keychain（macOS）/ Credential Manager（Windows）
- 草稿和历史记录存储在本地 SQLite（不加密）
- 不存储明文密码（使用 OAuth 2.0 授权码流程）

### 12.2 安全升级路径

- **付费层**：SQLCipher 加密数据库 + 主密码解锁
- 凭据仅内存解密，从不落盘明文

---


## 14. 项目文件结构

```
appilot/
├── app/                          # Flutter 应用 (UI)
│   ├── lib/
│   │   ├── main.dart
│   │   ├── app.dart
│   │   ├── features/
│   │   │   ├── composer/         # 发布编辑器
│   │   │   ├── inbox/            # 统一收件箱
│   │   │   ├── analytics/        # 统计仪表盘
│   │   │   └── settings/         # 设置/插件管理
│   │   ├── shared/
│   │   │   ├── widgets/          # 共享 UI 组件
│   │   │   ├── theme/            # 主题
│   │   │   └── i18n/             # 国际化 ARB 文件
│   │   └── router.dart
│   └── pubspec.yaml
├── engine/                       # Core Engine (Dart package)
│   ├── lib/
│   │   ├── plugin_registry.dart
│   │   ├── task_scheduler.dart
│   │   ├── event_bus.dart
│   │   ├── post_queue.dart
│   │   ├── content_store.dart
│   │   ├── analytics_engine.dart
│   │   ├── credential_vault.dart
│   │   ├── repo_analyzer.dart        # 代码仓库分析器
│   │   ├── project_registry.dart     # 项目注册中心
│   │   ├── ai/
│   │   │   ├── ai_engine.dart        # AI Engine 入口
│   │   │   ├── ai_provider.dart      # Provider 接口
│   │   │   ├── ai_config.dart        # 配置模型
│   │   │   ├── context_builder.dart  # 上下文组装
│   │   │   └── reply_rules.dart      # 半自动回复规则引擎
│   └── pubspec.yaml
├── plugins/                      # 平台插件
│   ├── plugin_interface/         # 插件接口定义 (Dart package)
│   │   └── lib/
│   │       └── platform_plugin.dart
│   ├── twitter/
│   ├── reddit/
│   ├── discord/
│   └── youtube/
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2025-07-14-appilot-mvp-design.md
└── README.md
```

### 桌面端技术风险与缓解

| 依赖能力 | 核心度 | Flutter 桌面成熟度 | 风险 | 缓解策略 |
|----------|--------|---------------------|------|----------|
| 安全存储 (Keychain/Credential Manager) | 🔴 核心 | 中等 | `keychain_rs`/`win32_cred` 可能在 macOS 大版本升级后不兼容 | 优先使用 `flutter_secure_storage`（社区活跃度更高，跨平台统一 API）；若不可行，回退到加密 SQLite |
| OAuth Loopback Server | 🔴 核心 | 良好 | Windows 防火墙可能拦截 127.0.0.1 | Phase 1 必须同时在 Windows 验证；备选自定义 URL Scheme |
| 系统托盘 | 🟡 增强 | 中等 | `system_tray` 包维护不活跃，Windows/macOS 兼容性不稳定 | Phase 0 先以普通窗口运行；系统托盘推迟到 Phase 1 基础设施阶段验证后再启用 |
| 开机自启动 | 🟢 非核心 | 一般 | macOS 需 Login Items 权限，Windows 需注册表操作，各有平台差异 | Phase 1 实现，若受阻可降级为用户手动启动 |
| HTTP 客户端 (dio) | 🔴 核心 | 成熟 | 无显著风险 | — |
| SQLite (drift) | 🔴 核心 | 成熟 | 无显著风险 | — |

**核心原则**：上述"增强"和"非核心"能力不应阻塞 Phase 0 交付。若某个平台 API 在 Windows 上验证失败，优先保证 macOS 可用，Windows 作为 known issue 记录。

---

