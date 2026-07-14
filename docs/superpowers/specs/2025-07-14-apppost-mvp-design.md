# AppPost — MVP 设计文档（原始完整版 · 历史参考）

> ⚠️ **此文件已拆分，不再更新。** 请使用拆分后的文档集：[设计文档索引](../README.md)
> 
> 拆分文件：
> - [产品规格](./apppost-product.md) — §1, §2, §15, §17
> - [架构设计](./apppost-architecture.md) — §3, §4, §5, §6, §7
> - [UI 设计](./apppost-ui.md) — §8
> - [构建计划](./apppost-build-plan.md) — §13
> - [横切关注点](./apppost-cross-cutting.md) — §9, §10, §11, §12, §14
> - [评审记录](./apppost-review-log.md) — §16, §18
>
> 状态：已确认 | 日期：2025-07-14 | 作者：@xingyuwang | 最后修订：2026-07-14 第四次修订

## 1. 产品概述

### 1.1 定位与愿景

AppPost 是一个 **AI 优先**的桌面工具，帮助独立开发者（OPC — 一人公司）在各大社交媒体平台上推广自己的应用。通过读取项目代码仓库（本地或 GitHub），AI 自动理解软件的功能、技术栈和最新变更，据此生成精准的推广文案和发布计划，并在各大平台发布后跟踪互动反馈。

**发展路径：** 自用 → 开源社区驱动 → 商业化（买断/订阅）

### 1.2 解决的问题

开发者完成应用开发后，最大的痛点不是开发或审核，而是**推广**——独立开发者（OPC）自己既是开发者也是运营者，缺乏时间和技能来撰写有效的推广文案。AppPost 通过 AI 读取代码仓库来理解产品，自动生成贴合实际功能的多平台推广文案和发布计划，并提供统一的发布和互动追踪界面，避免在多个平台之间来回切换。

### 1.3 核心原则

- **AI 优先** — AI 贯穿全流程：从读取代码仓库理解产品、生成推广文案、建议发布平台与时机，到发布后的互动回复建议。用户始终在决策回路中（Human-in-the-loop），AI 负责分析和建议，用户负责确认和执行
- **代码即真相** — 推广内容源自对代码仓库的阅读分析（README、提交历史、技术栈、功能模块），而非用户凭空想象或手动填写产品描述。AI 从代码中提取真实的特性、更新和亮点
- **本地优先** — 数据归用户掌控，凭据不离开用户设备。代码仓库可来自本地路径或 GitHub（私有仓库需授权令牌），AI 分析在本地执行
- **插件化** — 所有平台集成都是插件，社区可贡献
- **API 优先** — 优先使用平台官方 API，确保稳定合规
- **分级可用** — 发布与追踪按平台能力分级（手动 / 只读追踪 / 全自动），未申请或未获得第三方 API Key 时仍可使用基础功能，详见 [第 17 节](#17-手动发布与分级追踪能力模型-2026-07-14)

---

## 2. MVP 范围

### 2.1 支持平台

| 平台 | 内容类型 | 发布方式 | 追踪能力（浏览量/回复） | API 状态 |
|------|----------|----------|--------------------------|----------|
| Twitter/X | 文本、图片 | 自动发布（OAuth）或 Web Intent 预填跳转 | Tier 2 自动拉取（付费）；Tier 0 回填 URL 后尝试从公开页面提取（受 JS 渲染限制，可能需降级为手动填报） | 官方 API（OAuth 2.0，v2 读写均按量付费） |
| Reddit | 文本、链接 | 自动发布（OAuth）或预填提交页手动发布 | 评论数/点赞可免费只读 API 自动追踪；Tier 0 回填 URL 后通过 `.json` 后缀免费获取结构化数据 | 官方 API（OAuth，只读免费 100 QPM） |
| Discord | 文本、嵌入消息 | 自动发布（Bot/Webhook）或手动发送 | 回复可用免费 Bot 自动追踪；Tier 0 回填消息链接后受登录墙限制，无法自动提取 | 官方 Bot/Webhook API（免费） |
| YouTube | 视频 | 手动上传 / API 上传（Tier 2，受配额限制） | 浏览量/点赞/评论可用免费 API Key 自动追踪；Tier 0 回填 URL 后可通过 oEmbed + 公开页面提取基础数据 | YouTube Data API v3（读取仅需 API Key，写入需 OAuth + 配额） |

> 📌 上表的"发布方式/追踪能力"来自新的三级能力模型（Tier 0 手动 / Tier 1 只读追踪 / Tier 2 全自动），逐平台可行性结论与设计细节见 [第 17 节](#17-手动发布与分级追踪能力模型-2026-07-14)。

> ⚠️ **已核实的平台侧约束（2026-07-14 补充）**：
> - **Twitter/X**：v2 API 已切换为「按量付费、购买 credit」模式，不再有稳定的免费读取额度；发帖、拉取评论/提及都会计费，需在设计阶段预留预算与用量上限，而非假设可零成本长期运行。Tier 0 URL 回填方案：推文页面重度 JS 渲染，简单 HTTP 请求无法提取数据；需评估是否引入轻量 headless browser 或降级为手动填报。
> - **YouTube**：默认配额 10,000 单位/天，`videos.insert`（发布视频）单次 1600 单位 → 默认额度下每天最多约 6 次上传，其余配额还要覆盖评论/统计轮询；需规划配额监控与官方提升配额申请流程。
> - **Reddit**：免费层限制 100 QPM/OAuth client，个人使用足够；但强制要求「内容被删除后 48 小时内必须清除本地留存的对应数据」，需要在 Content Store / Interaction 存储设计中落地定期清理任务，否则违反 Data API Terms。Tier 0 URL 回填方案：Reddit 帖子 URL 追加 `.json` 后缀即可免费获取结构化 JSON（无需 API Key），是四个平台中 Tier 0 追踪可行性最高的。

### 2.2 核心功能

| 功能模块 | MVP 范围 | 后续版本 |
|----------|----------|----------|
| 项目配置 | 添加应用项目（名称、发布 URL、代码仓库路径或 GitHub URL）；支持本地仓库和 GitHub 仓库（私有仓库需 Personal Access Token）；AI 自动读取仓库内容（README、提交历史、技术栈、代码结构） | 多项目管理、GitLab/Bitbucket 支持 |
| AI 推广引擎 | **代码→文案**：AI 读取仓库后自动提取关键特性、最近更新、技术亮点，生成多平台适配的推广文案草稿；**推广计划**：AI 根据代码变更频率和功能成熟度建议发布阶段与目标平台；**回复辅助**：AI 根据仓库上下文生成个性化互动回复建议 | 全自动代理模式、发布策略优化、多模态素材生成 |
| 跨平台发布 | 按 AI 生成的推广计划 → 按平台能力自动推送（Tier2）/ Web Intent 预填跳转（Tier0/1）/ 手动发布清单打勾回填 URL | 定时发布、批量发布 |
| 统一收件箱 | 聚合具备追踪能力平台的评论互动，集中查看回复；AI 根据仓库上下文提供回复建议 | 智能分类、情感分析 |
| 基础统计 | 浏览量、点赞、评论数：具备追踪能力的平台自动拉取，Tier 0 回填 URL 自动提取，不可用时降级为手动填报 | 趋势分析、对比报告 |
| 插件管理 | 安装、启用、配置平台插件（含手动模式下的能力声明展示） | 插件市场浏览 |

### 2.3 MVP 不做的事情

- **网页爬虫/DOM 批量抓取自动化** — 不通过非官方手段大规模爬取平台页面数据（如全站搜索、自动发现新帖子）。但**用户主动回填帖子 URL 后，程序访问该单一公开 URL 提取可见统计数据（浏览量/点赞/评论数）属于 Tier 0 追踪的正常实现方式**——这不同于"爬虫"，类似浏览器打开一个公开链接并读取页面上的数字，只是由程序代为执行。各平台可行性不同（见 [第 17 节](#17-手动发布与分级追踪能力模型-2026-07-14)），不可行时降级为手动填报
- 手机客户端
- 完整后端服务（定时任务在本地运行）
- 团队协作 / 多账号管理（**决策，2026-07-14**：验证阶段单账号即可满足自用需求，`accounts` 表已是多行设计，多账号仅缺 UI/Engine 层暴露，留到 Phase 4 插件生态阶段根据社区反馈再评估，详见 [实施方案](./2026-07-14-apppost-implementation-plan.md) 第 0 节）

---

## 3. 架构设计

### 3.1 方案选择：Hub-and-Spoke

```
┌─────────────────────────────────────────────────────┐
│                   Presentation Layer                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│  │Composer  │ │  Inbox   │ │Analytics │ │Settings│ │
│  │  编辑器  │ │  收件箱  │ │  仪表盘  │ │  设置  │ │
│  └──────────┘ └──────────┘ └──────────┘ └────────┘ │
├─────────────────────────────────────────────────────┤
│                   Application Layer                  │
│  ┌──────────────────────────────────────────────┐   │
│  │            State Management (Riverpod)        │   │
│  └──────────────────────────────────────────────┘   │
│  ┌────────────┐ ┌────────────┐ ┌───────────────┐   │
│  │   Router   │ │  Theme &   │ │  Shortcuts &  │   │
│  │  (GoRouter)│ │    i18n    │ │  System Tray  │   │
│  └────────────┘ └────────────┘ └───────────────┘   │
├─────────────────────────────────────────────────────┤
│                    Core Engine                       │
│  ┌──────────────────────────────────────────────┐   │
│  │            Plugin Registry                    │   │  ← 插件发现、加载、生命周期
│  └──────────────────────────────────────────────┘   │
│  ┌───────────────┐ ┌──────────────┐ ┌────────────┐  │
│  │Task Scheduler │ │ Event Bus    │ │Post Queue  │  │  ← 调度、事件、发布队列
│  └───────────────┘ └──────────────┘ └────────────┘  │
│  ┌───────────────┐ ┌──────────────┐ ┌────────────┐  │
│  │Content Store  │ │ Analytics    │ │Credential  │  │
│  │ (草稿/历史)   │ │ Engine       │ │ Vault      │  │  ← 内容、统计、凭据
│  └───────────────┘ └──────────────┘ └────────────┘  │
│  ┌──────────────────────────────────────────────┐   │
│  │               Repo Analyzer                   │   │  ← 读取本地/GitHub仓库，提取代码特征
│  └──────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────┐   │
│  │                 AI Engine                     │   │  ← 代码→文案生成、推广计划、回复建议
│  │            (依赖 Repo Analyzer + Content Store) │   │
│  └──────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────┤
│                   Data Layer                         │
│  ┌────────────────┐  ┌────────────────────────────┐  │
│  │  SQLite (drift)│  │  System Keychain / Cred Mgr│  │
│  └────────────────┘  └────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 3.2 层间规则

- **Presentation 不直接访问 Data** — 所有数据通过 Application 层的 State Management 获取
- **Plugin 只能被 Core Engine 调用** — UI 层不直接和 Plugin 交互，通过 Engine 中转
- **Event Bus 是单向的** — Plugin → Event Bus → UI 订阅更新，Plugin 不感知 UI 存在

### 3.3 技术栈

| 层 | 技术选型 | 理由 |
|----|----------|------|
| 框架 | Flutter 3.x | 跨平台桌面（Mac/Windows），未来移动端/web |
| 状态管理 | Riverpod | 编译安全、可测试、无 BuildContext 依赖 |
| 路由 | GoRouter | 声明式路由，支持深层链接 |
| 本地数据库 | drift (SQLite) | 类型安全的 Dart ORM，支持流式查询 |
| 凭据存储 | keychain_rs (macOS) / win32_cred (Windows) | 系统原生安全存储 |
| 插件接口 | Dart abstract class + pubspec 引用 | 编译期类型检查 |
| HTTP 客户端 | dio | 拦截器、重试、日志 |
| OAuth 流程 | oauth2 包 + 系统浏览器 | 标准 OAuth 2.0 流程 |

---

## 4. Core Engine 核心组件

### 4.1 Plugin Registry（插件注册中心）

```
职责: 插件发现、验证、加载、生命周期管理

加载来源:
  - 内置目录 (app/plugins/*/)
  - 用户插件目录 (~/.apppost/plugins/*/)  [MVP 后支持]

加载流程:
  scan() → validate(version, interface) → load() → onInit()
  任何一个插件加载失败不影响其他插件
```

### 4.2 Task Scheduler（任务调度器）

```dart
abstract class TaskScheduler {
  Future<void> schedule(Task task);
  Future<void> cancel(String taskId);
  Stream<TaskEvent> get events;
}

// MVP 本地实现: 使用 Dart Timer + Isolate
// 未来远程实现: 通过 gRPC 连接轻量后端
```

```
MVP 支持的任务类型:
  - 定时轮询 (fetchNewInteractions，默认每 5 分钟)
  - 应用启动追赶 (startupCatchUp，批量拉取自上次关闭后的遗漏)
  - 即时发布 (立即 publish，最高优先级)
  - 到期提醒检查 (reminderCheck，扫描 reminders 表，触发 UI 通知，供 Tier 0 手动填报场景使用)
  - 仓库自动刷新 (repoAutoRefresh，应用启动 + 每 30 分钟检查关联仓库是否有新 tag/release；有变更则更新 ai_product_summary 缓存)
  - Release 监控 (releaseMonitor，检测到新 GitHub Release 或 git tag → 触发 UI 通知："MyApp v2.1.0 已发布，建议创建推广任务"；这是新推广任务的主要自动触发器，而非每次 commit/PR)
```

### 4.3 Event Bus（事件总线）

```
事件流向: Plugin/Engine → EventBus → UI 订阅者

事件类型:
  - PostPublished(platformId, postId, permalink)
  - NewInteraction(platformId, postId, interaction)
  - PostStatsUpdated(platformId, postId, stats)
  - PluginStatusChanged(pluginId, status)  // connected, error, rate_limited
  - TaskFailed(taskId, error)
```

### 4.4 Post Queue（发布队列）

```
职责: 发布请求的排队、重试、冲突处理

策略:
  - 每个平台独立队列（一个平台限频不影响其他平台）
  - 发布失败自动重试（指数退避，最多 3 次）
  - 限频时暂停该平台队列，等待窗口恢复
```

### 4.5 Content Store（内容存储）

```
职责: 草稿版本管理 + 发布历史记录

功能:
  - 草稿自动保存（30秒无操作触发）
  - 发布历史按平台/时间检索
  - 内容模板（重复使用的高频文案）
```

### 4.6 Credential Vault（凭据保险箱）

```
职责: 凭据的存储、读取、刷新

实现:
  - 存储: macOS Keychain / Windows Credential Manager
  - OAuth Token 过期前自动刷新（如果有 refresh_token）
  - 提供统一的 read/write/delete 接口
  - 凭据仅在内存中持有，不落盘明文
```

### 4.7 Analytics Engine（统计分析引擎）

```dart
abstract class AnalyticsEngine {
  /// Tier 1/2：插件通过 API 拉取到的统计写入（source = api）
  Future<void> recordApiStats(String postId, InteractionStats stats);

  /// Tier 0：用户回填 URL 后自动提取的统计写入（source = url_backfill）
  Future<void> recordUrlBackfillStats(String postId, InteractionStats stats);

  /// Tier 0 降级：用户在手动填报表单中提交的统计写入（source = manual）
  Future<void> submitManualStats(ManualStatsEntry entry);

  /// Tier 0：通过插件访问公开 URL 提取互动数据
  /// 各平台插件实现各自的 URL 解析逻辑（.json / oEmbed / 页面解析）
  Future<PostStatsFromUrl> extractFromPublicUrl(String url, String platformId);

  /// 按帖子/平台查询历史快照，供 Analytics 仪表盘画趋势图
  Stream<List<PostAnalyticsSnapshot>> watchTrend(String postId);
}
```

职责: 统一接收三种来源的统计数据——URL 回填自动提取（`url_backfill`）、API 自动拉取（`api`）、用户手动填报降级（`manual`）——写入 `post_analytics` 表（`source` 字段区分来源），并为 UI 层提供趋势查询。`extractFromPublicUrl` 通过 Plugin 的 `parsePublicPostUrl` 能力实现，是 Tier 0 追踪的核心入口。

### 4.8 Repo Analyzer（代码仓库分析器）

```dart
abstract class RepoAnalyzer {
  /// 连接仓库并建立索引
  Future<RepoIndex> connect(RepoSource source);

  /// 刷新索引（拉取最新提交、更新文件列表）
  Future<RepoIndex> refresh(String projectId);

  /// 获取仓库的结构化摘要（供 AI 作为上下文）
  /// 包含：README、技术栈、目录结构、最近提交、关键文件内容
  Future<RepoSummary> summarize(String projectId, {int maxFiles = 50});

  /// 提取可推广的功能亮点（基于代码特征的启发式分析 + AI 提炼）
  Future<List<FeatureHighlight>> extractHighlights(String projectId, AIContext aiContext);

  /// 自动识别发布渠道（从 README 中的 App Store 徽章、Google Play 链接等提取）
  /// 返回结构化列表供用户确认，无需手动填写
  Future<List<DistributionPlatform>> detectDistributionPlatforms(String projectId);

  /// 自动识别项目关联链接（官网、文档、社区、支持论坛等）
  /// 从 README、package 文件、GitHub repo metadata 中提取
  Future<ProjectLinks> detectProjectLinks(String projectId);

  /// 跨仓库分析：对比各仓库 README/网站内容与 AppPost 已知信息
  /// 返回缺失项列表 → AI Engine 据此生成 PR 建议
  Future<ReadmeCompleteness> checkReadmeCompleteness(String projectId);

  /// 获取最近变更摘要（自上次推广以来的新提交/新功能）
  /// 跨仓库聚合：若 app_source 和 website 仓库都有变更，合并为一份摘要
  Future<ChangelogSummary> getRecentChanges(String projectId, {DateTime? since});
}

/// README/官网完整性检查结果
class ReadmeCompleteness {
  final String repoId;
  final String repoRole;
  final List<MissingInfo> missingItems;   // 缺失的信息项
  final int completenessScore;            // 0-100，完整性评分
}

class MissingInfo {
  final String category;       // "app_store_badge" / "download_link" / "feature_description" / "screenshot" / "getting_started"
  final String description;    // "README 中未找到 Google Play 下载徽章，但 AppPost 项目已确认 Google Play 为发布渠道"
  final String? existingInAppPost; // AppPost 中已有的对应信息
  final String? suggestedFix;  // AI 建议的修改内容
}
```
支持的仓库来源:
  - 本地路径: /Users/xxx/projects/myapp  → 直接读取文件系统 + 执行 git 命令
  - GitHub (公开): github.com/user/repo   → GitHub API (不需要 Token，但限 60 req/h)
  - GitHub (私有): github.com/user/repo + Personal Access Token → GitHub API (需 Token，存在 Keychain 中)

大仓库处理策略:
  - 文件过滤: 默认遵循 .gitignore，自动跳过 node_modules / .git / build / dist / vendor 等目录
  - 文件大小: 单文件 > 500KB 只提取文件名和大小，不读取内容（避免大二进制文件撑爆 AI 上下文）
  - 二进制跳过: 图片、wasm、编译产物等自动识别为二进制并跳过
  - 深度限制: 目录树扫描最大深度 5 层（足够覆盖 src/lib/app 等典型结构）
  - Monorepo: 若检测到多个 package.json / pubspec.yaml / Cargo.toml，提示用户选择主项目目录或确认所有子项目
  - 文件上限: summarize() 的 maxFiles 默认 50，最大可配置 200；超出时按文件重要性排序（README > CHANGELOG > package 文件 > src 目录）
```

```
AI 上下文组装流程（RepoAnalyzer → AI Engine）:
  1. 遍历所有关联仓库（app_source / website / docs），按角色分别读取
  2. 从各仓库 README.md → 提取产品描述、安装说明、徽章链接
  3. 从 package.json / pubspec.yaml / Cargo.toml 等 → 提取技术栈和依赖
  4. 识别发布渠道:
     - 扫描所有仓库 README 中的 App Store 徽章图片链接 (apps.apple.com)
     - 识别 Google Play 链接 (play.google.com) 和徽章
     - 检测独立下载链接 (GitHub Releases / 官网 / 第三方市场)
     - 正则匹配常见分发 URL 模式
  5. 提取项目链接: 官网、文档站点、Discord 邀请、支持论坛、Twitter/X 账号等
     - website 仓库中的链接权重更高（官网源码中的信息更权威）
  6. git log --since="上次推广日期"（跨仓库聚合）→ 提取变更摘要
  7. 扫描目录结构 → 识别主要功能模块
  8. 读取 CHANGELOG.md（如存在）→ 提取版本更新内容
  9. ⭐ README 完整性检查: 对比仓库中的 README/网站内容与 AppPost 已知信息
     - 用户已在 AppPost 确认了 Google Play 链接 → README 里有对应徽章吗？
     - 用户在 AppPost 填写了项目 Discord → README/官网 里有链接吗？
     - → 生成 MissingInfo 列表 → AI Engine 据此生成 PR 建议
  10. 组装为结构化 System Prompt 注入 AI 对话
```

### 4.9 Project Registry（项目注册中心）

```dart
abstract class ProjectRegistry {
  /// 添加新项目（至少连接一个仓库后，AI 自动填充大部分字段）
  Future<Project> addProject(ProjectConfig config);

  /// 为已有项目添加更多仓库（如 iOS 源码仓库、官网仓库等）
  Future<ProjectRepo> addRepo(String projectId, RepoConfig config);

  /// 列出所有已配置项目
  Future<List<Project>> listProjects();

  /// 获取项目的完整上下文（项目信息 + 所有仓库摘要 + 历史推广记录）
  Future<ProjectContext> getContext(String projectId);
}

/// 仓库角色
enum RepoRole {
  appSource,          // 主应用源码
  appSourceAndroid,   // Android 平台源码
  appSourceIos,       // iOS 平台源码
  website,            // 官网/营销站点源码
  docs,               // 文档站点源码
}
```

```dart
/// 发布渠道（AI 自动识别 + 用户确认）
class DistributionPlatform {
  final String platform;   // "google_play" / "app_store" / "huawei_appgallery" / "independent" / "other"
  final String url;        // 下载/安装链接
  final String? label;     // 显示名称，如 "Google Play" / "App Store" / "官网下载"
  final bool autoDetected; // 是否由 AI 自动识别（false = 用户手动添加）
  final bool confirmed;    // 用户是否已确认
}

/// 项目关联链接（AI 自动识别 + 用户确认）
class ProjectLinks {
  final String? website;
  final String? documentation;
  final String? supportForum;
  final String? discord;
  final String? twitter;
  final String? github;
  final String? otherCommunity; // Reddit / Telegram / Slack 等
  final Map<String, String> customLinks; // 用户手动添加的其他链接
}
```

```
项目配置（用户首次使用时设置）:
  - 项目名称: "MyApp"                    ← 用户输入
  - 项目状态: 预热中 / 已发布 / 维护中    ← 用户选择（影响 AI 推广策略）
  
  主代码仓库 (至少一个):
  - 仓库来源: 本地路径 或 GitHub URL      ← 用户输入
  - 仓库角色: app_source                 ← 默认
  - GitHub Token (可选): 私有仓库需要     ← 用户输入（存 Keychain）
  
  可选额外仓库 (可稍后添加):
  - iOS 源码仓库 (如果独立于主仓库)
  - Android 源码仓库 (如果独立于主仓库)
  - 官网/营销站点仓库 (website)
  - 文档站点仓库 (docs)
  
  — 以下由 AI 跨仓库自动识别，用户确认即可 —
  - 发布渠道: Google Play / App Store / 独立分发 / ...  ← AI 从 README 徽章和链接中识别
  - 官网 / 文档 / Discord / 支持论坛 / Twitter 等       ← AI 识别
  - ⭐ README 完整性报告: AI 对比仓库内容与 AppPost 已知信息，
    自动发现遗漏 → 建议 PR 补齐
  
  - AI API 配置: Provider URL + API Key（全局配置，所有项目共享）
```

---

## 5. Plugin 接口设计

### 5.1 核心接口

```dart
abstract class PlatformPlugin {
  /// 插件唯一标识
  String get id;

  /// 显示名称
  String get name;

  /// 版本号（语义化版本）
  String get version;

  /// 插件描述
  String get description;

  /// 图标路径（相对于插件包）
  String get iconPath;

  // ── 认证 ──
  Future<bool> authenticate(Credential credential);
  Future<bool> isAuthenticated();
  Future<void> disconnect();

  // ── 能力声明 ──
  List<ContentType> get supportedContentTypes;
  /// 文本、图片、视频、链接

  Map<String, int> get rateLimits;
  /// 各操作的频率限制

  PublishMode get publishMode;
  /// apiAuto：通过 API 自动发布
  /// webIntent：打开系统浏览器预填内容，由用户手动点击发布
  /// manualOnly：无预填能力，仅提供文案复制 + 发布清单打勾

  TrackingMode get trackingMode;
  /// apiAuto：已认证后自动拉取
  /// apiReadOnly：仅需免费/只读凭据即可自动拉取（不要求发布权限）
  /// manualEntry：平台无免费只读接口，需用户手动填报
  /// unavailable：平台本身不提供该指标（如浏览量）

  // ── 发布 ──
  Future<PostResult> publish(PostContent content);

  /// 当 publishMode == webIntent 时使用：返回预填充内容的平台 URL，由 Engine 调用系统浏览器打开
  Uri? buildWebIntentUrl(PostContent content) => null;

  // ── 互动追踪 ──
  /// 仅当 trackingMode 为 apiAuto/apiReadOnly 时会被 Engine 调用
  Future<List<Interaction>> fetchNewInteractions(String postId, {DateTime? since});
  Future<InteractionStats> getStats(String postId);

  // ── Tier 0 URL 回填追踪 ──
  /// 从公开帖子 URL 提取统计数据，无需 API Key
  /// 各平台实现不同：Reddit 用 .json 后缀、YouTube 用 oEmbed + 页面解析、Twitter 用 headless browser
  /// 返回 null 表示该平台不支持 URL 提取，Engine 应降级为手动填报表单
  Future<PostStatsFromUrl?> parsePublicPostUrl(String url) => Future.value(null);

  // ── 生命周期 ──
  Future<void> onInit();
  Future<void> onDispose();
}
```

### 5.2 设计要点

- **能力声明是自描述的** — 引擎通过 `supportedContentTypes` 知道该插件能否发视频，发布编辑器的 UI 据此动态调整（例：选 YouTube 时显示视频上传区域）
- **认证留白** — `Credential` 不规定具体字段（OAuth Token / API Key / Webhook URL 各平台不同），由插件自行解析。基类定义如下：

```dart
/// 凭据的抽象基类。各平台插件根据需要扩展。
/// 例：Twitter 用 OAuthToken，YouTube 用 ApiKey，Discord 用 BotToken。
abstract class Credential {
  /// 凭据类型标识，用于 Keychain 序列化/反序列化
  String get type;
  /// 序列化为 JSON，供 Keychain 存储
  Map<String, dynamic> toJson();
  /// 从 JSON 反序列化
  Credential fromJson(Map<String, dynamic> json);
}

class OAuthToken extends Credential {
  final String accessToken;
  final String? refreshToken;
  final DateTime expiresAt;
  // ...
}

class ApiKey extends Credential {
  final String key;
  // ...
}
```
- **生命周期挂钩** — `onInit` 用于初始化连接池、验证 Token 有效性；`onDispose` 用于清理资源
- **发布/追踪能力分级** — `publishMode`/`trackingMode` 让 Engine 和 UI 知道该平台此刻是"全自动"还是"手动兜底"，Composer/Inbox/Analytics 据此切换成"一键预填跳转"或"手动填报表单"，用户无需先申请到 API Key 才能用起来基础功能（详见 [第 17 节](#17-手动发布与分级追踪能力模型-2026-07-14)）
- **手动统计不经过 Plugin** — Tier 0 手动填报的统计数据（`ManualStatsEntry`）不经过 `PlatformPlugin` 接口（因为没有调用平台 API），而是直接由 UI 层通过 Engine 的 `AnalyticsEngine.submitManualStats()` 写入 `post_analytics` 表。Tier 0 的 URL 回填提取（`extractFromPublicUrl`）则通过 Plugin 的 `parsePublicPostUrl` 方法实现——各平台插件负责 URL 解析，Engine 负责统一调度与降级

### 5.3 数据模型

```dart
class PostContent {
  final String title;
  final String body;
  final List<Attachment> attachments;
  final Map<String, dynamic> platformOptions; // 平台特有参数（如 tags、flairs）
}

class PostResult {
  final String platformPostId;
  final String permalink;
  final DateTime publishedAt;
  final bool success;
  final String? errorMessage;
  /// 当发布需要用户在浏览器/客户端中手动完成时返回 true（如 webIntent / manualOnly 模式）
  final bool requiresManualStep;
  /// requiresManualStep 为 true 时，提供引导用户去完成的 URL
  final String? manualStepUrl;
}

class Interaction {
  final String platformId;
  final String postId;
  final InteractionType type; // comment, like, share, retweet, etc.
  final String authorName;
  final String body;
  final DateTime createdAt;
  final bool isReplied;
}

class InteractionStats {
  final int viewCount;
  final int likeCount;
  final int commentCount;
  final int shareCount;
  final DateTime fetchedAt;
}

enum PublishMode { apiAuto, webIntent, manualOnly }

enum TrackingMode { apiAuto, apiReadOnly, urlBackfill, manualEntry, unavailable }

/// Tier 0：从公开 URL 提取到的帖子统计（无需 API Key）
class PostStatsFromUrl {
  final String url;
  final int? viewCount;
  final int? likeCount;
  final int? commentCount;
  final int? shareCount;
  final List<Interaction>? recentComments; // 最近评论（如果能提取到）
  final DateTime extractedAt;
  final String extractionMethod; // "json_endpoint" / "oembed" / "headless_browser" / "html_parse"
}

/// 手动模式下用户自行填报的统计快照（URL 回填不可用时的降级方案）
class ManualStatsEntry {
  final String postId;
  final int? viewCount;
  final int? likeCount;
  final int? commentCount;
  final DateTime reportedAt;
  final String? note; // 用户备注，例如粘贴的最新评论摘录
}
```

### 5.4 插件加载策略

- **内置插件** — 4 个官方平台插件随应用内置，通过 `pubspec.yaml` 本地路径引用
- **社区插件** — 后续支持从指定目录（`~/.apppost/plugins/`）动态加载 `.dart` 插件包
- **版本兼容** — 插件通过 `version` 字段 + 语义化版本号与 Engine 版本校验

---

## 6. AI 智能推广引擎

### 6.1 系统定位：代码 → 文案 → 推广计划

```
                         ┌──────────────────────┐
                         │     Repo Analyzer     │
                         │  (本地/GitHub 仓库)    │
                         └──────────┬───────────┘
                                    │ README / git log / 代码结构 / 技术栈
                                    ▼
                         ┌──────────────────────┐
                         │      AI Engine        │
                         │  ┌─────────────────┐  │
                         │  │ 产品理解         │  │  ← 跨仓库提取特性、亮点、受众定位
                         │  ├─────────────────┤  │
                         │  │ 推广计划生成     │  │  ← 建议发布阶段(含预热/预告)、平台、频率
                         │  ├─────────────────┤  │
                         │  │ 多平台文案生成   │  │  ← 按各平台格式和风格适配
                         │  ├─────────────────┤  │
                         │  │ 回复辅助         │  │  ← 根据仓库上下文生成个性化回复
                         │  ├─────────────────┤  │
                         │  │ README 完善建议  │  │  ← 对比仓库与 AppPost 信息，生成 PR
                         │  └─────────────────┘  │
                         └──────┬───────┬───────┘
                                │       │ PR 建议 → 用户确认 → 创建 PR
                                │       ▼
                                │  ┌────────────┐
                                │  │  GitHub API │  (若仓库在 GitHub 上)
                                │  └────────────┘
                                │ 通过 Plugin 接口
           ┌───────────────┬────┼────┬───────────────┐
           ▼               ▼    ▼    ▼               ▼
      ┌─────────┐    ┌─────────┐ ┌──────┐ ┌──────┐    ┌──────────┐
      │Twitter/X│    │ Reddit  │ │Discord│ │YouTube│    │  (社区)  │
      └─────────┘    └─────────┘ └──────┘ └──────┘    └──────────┘
```

AI Engine 是 AppPost 的核心差异化组件，**通过 Repo Analyzer 读取代码仓库来理解产品**，而非依赖用户手动填写产品描述。AI 从 README、git 提交历史、代码结构和技术栈中自动提取真实的特性、更新和亮点，据此生成推广文案和发布计划。AI Engine 通过现有的 Plugin 接口与各平台交互，不直接操作平台 API。

未来演进方向（Phase 5+）：AI 可在生成推广文案时进行**竞品差异化分析**——基于项目的技术栈和功能特性，搜索相似项目并建议差异化角度（如"你的项目有 Plugin 架构，GitHub 上 top 3 的竞品都没有，应该强调这一点"），使推广文案更具竞争力。

### 6.2 核心工作流

```
步骤 1: 配置 AI API
  → 用户设置 OpenAI 兼容 API 的 URL + Key（全局配置）
  → 支持: OpenAI / DeepSeek / Groq / Ollama (本地) / LM Studio (本地)

步骤 2: 添加项目 + 连接仓库
  → 项目名称 + 发布 URL
  → 仓库来源: 本地路径 或 GitHub URL (+ Token if private)
  → AI 自动扫描仓库，生成产品摘要

步骤 3: AI 生成推广计划
  → AI 分析仓库后建议:
    - 目标平台 (根据受众特征推荐 Reddit/HN vs Twitter vs YouTube)
    - 发布阶段 (首发公告 / 功能更新 / 技术分享)
    - 推广频率 (基于 Release 发布节奏，而非每次 commit)
  → 自动触发：Release 监控检测到新 GitHub Release 或 git tag → 通知用户"v2.1.0 已发布，建议创建推广任务"
  → 用户审阅、调整、确认 → 创建发布任务

步骤 4: AI 生成多平台文案
  → AI 根据各平台格式和风格自动适配:
    - Twitter/X: 280 字限制 + hashtags + 图片建议
    - Reddit: 标题党 + 正文详情 + subreddit 建议
    - Discord: 富文本嵌入 + 社区语气
    - YouTube: 视频标题 + 描述 + 标签
  → 用户逐平台审阅、修改、确认

步骤 5: ⭐ README 完善建议 (持续进行的后台任务)
  → AI 对比仓库中的 README/官网内容与 AppPost 已知信息
  → 发现缺失 → 生成 PR 建议 (如"README 中未找到 App Store 徽章")
  → 用户审阅 diff → 一键创建 PR (若仓库在 GitHub 上) 或复制建议手动更新
  → 仓库更新后 → AI 重新扫描 → 推广内容质量随之提升

步骤 6: 发布 + 追踪
  → 按平台能力执行 (Tier 2 自动 / Tier 0 Web Intent + 回填 URL)
  → 预热阶段 (pre_launch) 发布预告帖，引导潜在用户关注/Star/预注册
  → 收集互动反馈

步骤 7: AI 辅助回复
  → 分析评论内容 + 仓库上下文 → 生成个性化回复建议
  → "有人问这个项目支不支持 Docker → AI 检查 Dockerfile 是否存在 → 建议回复"
```

### 6.3 AI 上下文组装（Repo → System Prompt）

```dart
class RepoContextBuilder {
  final RepoAnalyzer _repoAnalyzer;

  /// 组装发给 AI 的完整 System Prompt，包含仓库分析结果
  Future<AIContext> buildContext(String projectId) async {
    final repo = await _repoAnalyzer.summarize(projectId);
    final highlights = await _repoAnalyzer.extractHighlights(projectId);
    final changes = await _repoAnalyzer.getRecentChanges(projectId);
    final distPlatforms = await _repoAnalyzer.detectDistributionPlatforms(projectId);
    final links = await _repoAnalyzer.detectProjectLinks(projectId);

    return AIContext(
      systemPrompt: '''
你是 AppPost 的 AI 推广助手。以下是你要推广的软件项目的真实信息，所有推广内容必须基于这些信息生成。

## 产品信息
- 名称: ${repo.projectName}
- 一句话描述 (来自 README): ${repo.tagline}
- 技术栈: ${repo.techStack}
- 许可证: ${repo.license}

## 发布渠道 (用户在哪里可以下载/安装)
${distPlatforms.map((p) => '- ${p.platform}: ${p.url}').join('\n')}

## 项目链接
${links.website != null ? '- 官网: ${links.website}' : ''}
${links.documentation != null ? '- 文档: ${links.documentation}' : ''}
${links.discord != null ? '- Discord 社区: ${links.discord}' : ''}
${links.twitter != null ? '- Twitter/X: ${links.twitter}' : ''}
${links.supportForum != null ? '- 支持论坛: ${links.supportForum}' : ''}

## 关键特性 (从代码中提取)
${highlights.map((h) => '- ${h.title}: ${h.description}').join('\n')}

## 最近更新 (自上次推广以来)
${changes.summary}

## 目标受众
${repo.inferredAudience}

## 风格要求
- 专业但不生硬，接地气但有干货
- 针对开发者群体，可以使用技术术语
- 每次推广内容应有所不同，避免重复
- 根据目标平台调整格式和语气
- 推广文案中自然融入下载链接和社区入口
''',
      repoSnapshot: repo,
      highlights: highlights,
      recentChanges: changes,
      distributionPlatforms: distPlatforms,
      projectLinks: links,
    );
  }
}
```

用户无需手动填写产品描述、关键特性或品牌语气——AI 从代码仓库中自动提取。用户可在设置中补充偏好（如"强调开源/免费特性"、"避免夸张营销用语"），这些会合并到 System Prompt 中。

### 6.4 AI Engine 接口（仓库驱动）

```dart
class AIEngine {
  final AIConfig _config;
  final RepoContextBuilder _contextBuilder;
  final AIProvider _provider;

  // ── 产品理解 ──
  /// 分析仓库后生成产品摘要（名称、一句话描述、技术栈、关键特性、受众定位）
  Future<ProductSummary> analyzeProduct(String projectId);

  // ── 推广计划 ──
  /// AI 根据代码变更频率、功能成熟度和受众特征，建议推广阶段与目标平台
  Future<PromotionPlan> generatePromotionPlan(String projectId, {
    List<PlatformTarget>? preferredPlatforms,
    String? focusArea, // "launch" / "update" / "tech_blog" / "tutorial"
  });

  // ── 内容生成 ──
  /// 为指定平台生成推广文案（自动适配平台格式和字数限制）
  Future<GeneratedPost> generatePost({
    required String projectId,
    required PlatformTarget platform,
    required PromotionStage stage,     // launch / feature_update / tech_share / tutorial
    String? customPrompt,              // 用户额外指令
    List<FeatureHighlight>? focusFeatures, // 本次推广侧重哪些特性
  });

  /// 批量生成多平台文案（基于同一推广主题）
  Future<Map<PlatformTarget, GeneratedPost>> generateCrossPlatformPosts({
    required String projectId,
    required List<PlatformTarget> platforms,
    required PromotionStage stage,
  });

  // ── 回复生成 ──
  /// 根据评论内容 + 仓库上下文生成个性化回复建议
  Future<GeneratedReply> generateReply({
    required String projectId,
    required Interaction interaction,
    String? customInstruction,
  });

  // ── 推广时机建议 ──
  Future<PostingSuggestion> suggestPostingTime({
    required PlatformTarget platform,
    required DateTime window,
  });

  // ── README / 官网完善建议 ──
  /// 跨仓库对比：AppPost 已知的项目信息 vs 仓库 README/网站实际内容
  /// 返回缺失项 → 生成 PR 建议
  Future<List<PRSuggestion>> generateReadmePRs(String projectId);

  /// 为指定 PR 建议生成完整的 diff 内容
  Future<String> generateDiffContent(String suggestionId);
}
```

### 6.5 Provider 接口与 AI 用量追踪

```dart
abstract class AIProvider {
  Future<String> chat(List<ChatMessage> messages, {
    double temperature = 0.7,
    int maxTokens = 2000,
  });

  Future<void> validateConnection();

  /// 返回最近一次调用的 token 用量，供 UI 展示给用户
  TokenUsage? get lastUsage;
}

class TokenUsage {
  final int promptTokens;
  final int completionTokens;
  final int totalTokens;
  final double estimatedCost; // 基于当前模型定价估算（USD）
}

class OpenAICompatibleProvider implements AIProvider {
  // 支持: OpenAI, DeepSeek, Groq, Ollama (本地), LM Studio (本地)
  // 通过 base_url + api_key 配置。API Key 存储在系统 Keychain。
  // Ollama/LM Studio 本地模型 estimatedCost = 0
}
```

> 📊 **AI 用量透明原则**：不限制用户的 API 调用量（预算控制在 API Provider 侧由用户自行管理），但 AppPost 会**实时追踪和展示每次调用的 token 消耗与预估费用**。设置页展示累计用量统计（本月总 token 数、预估总费用），每次 AI 操作完成后在 UI 中显示本次消耗（如"本次文案生成消耗 1,247 tokens，约 $0.02；本月累计 45,320 tokens，约 $0.68"），让用户清楚知道每笔推广的 AI 成本。

### 6.6 推广计划与阶段模型

```dart
enum PromotionStage {
  teaser,        // 预热 — "我们正在开发一个很酷的东西…" 项目初期制造期待
  preLaunch,     // 预告 — "X 即将发布！先来看看它能做什么" 发布前 1-2 周
  launch,        // 首发公告 — "我们的新产品 X 正式发布了"
  featureUpdate, // 功能更新 — "X 刚刚支持了 Y 功能"
  techShare,     // 技术分享 — "我们如何用 Rust 重写了核心引擎"
  tutorial,      // 教程/用例 — "用 X 在 5 分钟内搭建一个 Y"
  milestone,     // 里程碑 — "X 在 GitHub 上达到了 1000 Star"
}

class PromotionPlan {
  final String projectId;
  final List<PromotionTask> tasks;      // 按时间排列的推广任务列表
  final String rationale;               // AI 的建议理由（供用户理解）
  final Map<PlatformTarget, String> platformRecommendations; // 平台→推荐理由
}

class PromotionTask {
  final PromotionStage stage;
  final List<PlatformTarget> targetPlatforms;
  final List<FeatureHighlight> suggestedFeatures;
  final DateTime suggestedDate;
  final String aiRationale;
}
```

用户审阅 AI 生成的推广计划后可以：
- 调整推广阶段和平台
- 增减侧重特性
- 修改建议时间
- 手动添加自定义推广任务

### 6.7 多平台文案适配

AI 根据各平台特征和推广阶段自动调整生成内容：

| 平台 | 字数限制 | 格式特点 | AI 适配策略 | 预热/预告阶段特殊处理 |
|------|----------|----------|-------------|------------------------|
| Twitter/X | 280 字符 | hashtags + 链接 + 图片 | 精简为一句话亮点 + 链接；自动生成 3-5 个 hashtags | 预告帖引导关注/Star："🚧 We're building something exciting..." |
| Reddit | 40,000 字符 (标题 300) | 标题党 + 详细正文 + subreddit | 生成吸引点击的标题 + 结构化正文；根据技术栈建议 subreddit | 技术预告："Show HN: We're rewriting X in Rust, here's why" |
| Discord | 2,000 字符 | 富文本嵌入 + @提及 + Emoji | 社群语气；可使用 Markdown 格式；建议嵌入预览 | 社区预热："Hey everyone! We're working on v2.0..." |
| YouTube | 100 字符 (标题) + 5,000 (描述) | SEO 标题 + 详细描述 + 标签 | 生成 SEO 友好标题 + 时间戳章节描述 + 15-20 个标签 | 预告片/开发日志 vlog："Building X — Dev Log #1" |

### 6.8 README 完善与 PR 建议（代码即真相 · 逆向闭环）

**背景**：当项目处于预热/预告阶段（`teaser` / `preLaunch`），仓库 README 可能缺少应用发布后才会有的信息（App Store 徽章、下载链接、功能截图等）。即使用户已在 AppPost 中确认了这些信息（发布渠道、项目链接），仓库中可能仍未更新。AI Engine 发现这种不一致后，自动生成 PR 建议。

```
工作流:
  1. Repo Analyzer.checkReadmeCompleteness()
     → 对比仓库 README/网站 vs AppPost 已知信息
     → 发现: README 中有 Google Play 徽章 ✅ 但没有 App Store 徽章 ❌
     → 而 AppPost 中用户已确认 App Store 为发布渠道

  2. AI Engine.generateReadmePRs()
     → 对每个 MissingInfo 生成 PR 建议
     → PR 标题: "Add App Store download badge to README"
     → PR 描述: 解释为什么需要（用户已在 App Store 上线，README 应告知用户在哪下载）
     → diff 内容: 在 README 对应位置插入 App Store 徽章 Markdown

  3. 用户审阅
     → 查看建议的 diff → 编辑（可选）→ 确认

  4. 创建 PR (若仓库在 GitHub 上且有 Token)
     → 通过 GitHub API 创建 Pull Request → 记录 pr_url
     → 或: 用户复制建议内容，手动更新（仓库不在 GitHub 或为本地仓库）
```

```
AI 可检测的常见缺失:
  📱 下载徽章缺失    — 用户在 AppPost 确认了某渠道但 README 无对应徽章
  🔗 社区链接缺失    — Discord/Twitter 在 AppPost 中有但 README 无
  📖 文档链接缺失    — docs 仓库已连接但主 README 未引用
  🖼 截图缺失        — 项目已发布但 README 无产品截图
  📋 功能特性过时    — git log 显示新增了功能但 README Feature List 未更新
  🌐 官网仓库不同步  — website 仓库中的下载页缺少 AppPost 中已知的某些发布渠道
```

### 6.9 安全约束

- **代码隐私** — 仓库内容仅在本地分析，发送给 AI 的是 Repo Analyzer 提取的结构化摘要（特性列表、技术栈、变更说明），而非完整源代码。用户可在预览中看到即将发送给 AI 的上下文并手动删减
- **私有仓库保护** — GitHub Token 存储在系统 Keychain 中，仅用于 API 调用，不发送给 AI Provider
- **发布频率上限** — 用户设定每小时/每天最大自动发帖数，超限则暂停并通知
- **回复频率上限** — 同样设限，防止 AI 刷屏
- **人工回退** — 用户可在 Inbox 中随时"接管"某个对话
- **操作日志** — 所有 AI 操作记录到 `ai_actions` 表，包括输入上下文摘要和输出内容，可审计
- **AI 幻觉标记** — AI 生成的每条内容中，根据信息来源标注可信度：
  - ✅ **代码验证**（绿色）— 信息直接从代码中提取，如"支持 Docker（检测到 Dockerfile）"
  - ⚠️ **AI 推测**（黄色）— AI 基于上下文推断但未在代码中直接确认，如"可能支持实时协作"；需用户人工核查
  - 💡 **AI 润色**（灰色）— 仅为表达优化，不涉及事实性声明，如将"fast"润色为"blazingly fast"
  - 用户在 Composer 中审阅时，推测项以黄色高亮显示，点击可查看 AI 的推断依据

### 6.10 AI 相关数据库表

`ai_config`、`ai_actions`、`projects` 的完整字段与 ER 图统一维护在 [7.1 核心表](#71-核心表)，此处不再重复绘制。

---

## 7. 数据模型与数据库 Schema

### 7.1 核心表

```
projects
┌──────────────────────┐
│ id (PK)              │
│ name                 │  项目显示名称
│ status               │  pre_launch / launched / maintenance
│ primary_app_url      │  主发布 URL（官网或首选下载渠道；pre_launch 阶段可为 null）
│ distribution_platforms│  JSON (AI 自动识别 + 用户确认的发布渠道列表)
│ links                │  JSON (AI 自动识别 + 用户确认的项目链接)
│ ai_product_summary   │  JSON (AI 跨仓库分析后生成的产品摘要缓存)
│ created_at           │
└──────────────────────┘
         │
         │ 1:N
         ▼
project_repos                       pr_suggestions
┌──────────────────────┐           ┌──────────────────────┐
│ id (PK)              │           │ id (PK)              │
│ project_id (FK)      │──────┐    │ project_id (FK)      │
│ repo_source          │      │    │ target_repo_id (FK)  │── 目标仓库
│ repo_path            │      │    │ suggestion_type      │   readme_update / website_update / badge_add
│ repo_role            │      │    │ title                │   如 "添加 App Store 下载徽章"
│                      │      │    │ description          │   AI 解释为什么需要这个改动
│  app_source          │      │    │ diff_content         │   建议的 diff 内容
│  app_source_android  │      │    │ status               │   pending / approved / pr_created / dismissed
│  app_source_ios      │      │    │ pr_url               │   创建 PR 后的链接
│  website             │      │    │ created_at           │
│  docs                │      │    └──────────────────────┘
│                      │      │
│ repo_token_ref       │      │
│  → keychain          │      │
│ is_primary           │      │
│ last_indexed_at      │      │
└──────────────────────┘      │
         │                    │
         │ 1:N (posts)        │
         ▼                    │
accounts                    posts
┌──────────────────┐       ┌──────────────────┐
│ id (PK)          │       │ id (PK)          │
│ platform         │──┐    │ platform         │
│ platform_user_id │  │    │ platform_post_id │
│ display_name     │  │    │ title            │
│ token_ref (keychain)│◄──┤ body             │
│ connected_at     │  │    │ permalink        │
│ status           │  │    │ account_id (FK)  │──────────────┐
└──────────────────┘  │    │ project_id (FK)  │              │
                       │    │ status           │              │
                       │    │ publish_mode     │  api_auto / web_intent / manual
                       │    │ published_at     │              │
                       │    └──────────────────┘              │
interactions             │         content_templates          │
┌──────────────────┐     │    ┌──────────────────┐            │
│ id (PK)          │     │    │ id (PK)          │            │
│ post_id (FK)─────┼─────┘    │ name             │            │
│ platform         │          │ body             │            │
│ platform_user_id │          │ platforms (JSON) │  多平台标记 │
│ author_name      │          │ use_count        │            │
│ body             │          │ created_at       │            │
│ type (comment/like/..)│    │ updated_at       │            │
│ is_read          │          └──────────────────┘            │
│ is_replied       │                                          │
│ created_at       │         post_analytics                   │
└──────────────────┘    ┌──────────────────────┐              │
                        │ post_id (FK) ────────┼──────────────┘
                        │ platform             │
                        │ view_count           │
                        │ like_count           │
                        │ comment_count        │
                        │ share_count          │
                        │ source               │  api / url_backfill / manual
                        │ fetched_at           │
                        └──────────────────────┘

reminders
┌──────────────────────┐
│ id (PK)              │
│ post_id (FK) ────────┼──────────────┐
│ remind_at            │              │
│ message              │              │
│ dismissed            │              │
│ created_at           │              │
└──────────────────────┘              │
                                      │
ai_config                             │
┌──────────────────┐                  │
│ id (PK)          │                  │
│ provider_url     │                  │
│ api_key_ref      │  → keychain      │
│ model_name       │                  │
│ user_preferences │  JSON (语气偏好、禁用语、额外说明) │
│ autonomy_mode    │                  │
│ max_posts_per_day│                  │
│ max_replies_per_hour│              │
└──────────────────┘                  │
                                      │
ai_actions                            │
┌──────────────────┐                  │
│ id (PK)          │                  │
│ project_id (FK)  │                  │
│ action_type      │  analyze_product / generate_plan / generate_post / generate_reply
│ autonomy_mode    │                  │
│ input_context    │  (发给 AI 的 repo 摘要快照) │
│ output_content   │  (AI 生成的内容) │
│ user_modified    │                  │
│ platform_post_id │                  │
│ interaction_id   │                  │
│ created_at       │                  │
└──────────────────┘
```

### 7.2 设计说明

- **projects 表是顶层实体** — 一个项目可以有多个帖子（1:N）和多个代码仓库（1:N）；`status` 标记项目处于 `pre_launch`（预热/预告阶段）、`launched`（已发布）还是 `maintenance`（维护阶段），影响 AI 生成的推广策略；`primary_app_url` 在预热阶段可为 null；`distribution_platforms`（JSON）和 `links`（JSON）均由 AI 从仓库中自动识别后经用户确认填入；`ai_product_summary` 缓存跨仓库分析结果
- **project_repos 支持多仓库关联** — 一个项目可关联多个仓库，通过 `repo_role` 区分角色：
  - `app_source` — 主应用源码仓库
  - `app_source_android` / `app_source_ios` — 跨平台独立仓库
  - `website` — 官网/营销站点仓库
  - `docs` — 文档站点仓库
  - 各仓库独立存储 `repo_token_ref`（不同仓库可能需要不同权限的 Token）；`is_primary` 标记主仓库（通常为 `app_source`）
- **pr_suggestions 是 AI → 仓库的闭环** — AI 跨仓库分析后，发现 README/官网缺少 AppPost 已知的信息（如用户已在 AppPost 确认了 App Store 链接但 README 中没有对应徽章），自动生成改进建议（`diff_content`）。用户确认后可直接创建 PR（若仓库在 GitHub 上且有写入权限），或复制建议内容手动更新。这是"代码即真相"的逆向应用：AppPost 中的项目信息反向推动仓库文档的完善
- **凭据不入库** — `accounts` 表只存 `token_ref`（Keychain 引用键），实际 Token/OAuth 凭据在系统安全存储中；`projects.repo_token_ref` 同理
- **ai_config 不再存储产品描述** — `product_desc`、`target_audience`、`brand_voice`、`key_features` 等字段已移除。这些信息由 Repo Analyzer 从代码仓库中自动提取并通过 AI Context Builder 组装。`user_preferences`（JSON）仅存储用户额外补充的偏好（如"强调开源免费"、"禁用词列表"）
- **interactions 与 posts 关联** — 通过 `post_id` 外键，支持"按帖子查看所有互动"
- **post_analytics 是可追加时序** — 同一 `post_id` 可有多条记录（不同时间点的快照），`fetched_at` 标记采样时间
- **content_templates 存复用文案** — AI 生成且用户确认过的高质量文案可保存为模板，`platforms` 用 JSON 标记适用平台
- **posts.publish_mode** — 记录该帖子是 `api_auto`（引擎自动发布）还是 `web_intent` / `manual`（用户手动完成），手动模式下 `platform_post_id`/`permalink` 由用户回填，其余字段照常记录
- **post_analytics.source** — 标记该条统计快照来自 `api`（自动拉取）、`url_backfill`（URL 回填自动提取）还是 `manual`（用户手动填报降级），三者混存同一张表，图表按最新快照展示，不区分来源，但导出/审计时可追溯
- **新增 reminders 表** — `id / post_id (FK) / remind_at / message / dismissed`，供手动模式下"到期提醒去看看反馈"任务使用，详见 [第 17 节](#17-手动发布与分级追踪能力模型-2026-07-14)

---

## 8. UI 设计

### 8.1 首次使用流程：项目设置向导

```
┌─ Step 1: 配置 AI API ────────────────────────────┐
│ AI Provider: [OpenAI ▼]  (或 Ollama 本地 / LM Studio)│
│ API URL: [https://api.openai.com/v1           ]   │
│ API Key: [••••••••••••••••••••••] [测试连接]      │
│ 模型:    [gpt-4o ▼]                              │
│                                                   │
│ 💡 推荐使用本地模型 (Ollama) 以避免数据出境        │
├─ Step 2: 添加项目 + 连接仓库 ───────────────────┤
│ 项目名称: [MyApp                          ]       │
│ 项目状态: ● 预热中 (尚未发布)                     │
│           ○ 已发布    ○ 维护中                     │
│                                                   │
│ 📦 主代码仓库:                                    │
│   来源:   ● GitHub  ○ 本地路径                    │
│   URL:    [github.com/user/myapp          ]       │
│   访问:   ● 公开  ○ 私有 (需要 Token)             │
│   Token:  [                                ] (可选)│
│   角色:   [app_source ▼]                          │
│                                                   │
│ 📦 其他仓库 (可选，稍后可添加):                    │
│   [+ 添加 iOS 源码仓库]                           │
│   [+ 添加 Android 源码仓库]                       │
│   [+ 添加官网/营销站点仓库 (website)]              │
│   [+ 添加文档站点仓库 (docs)]                      │
│                                                   │
│ [连接仓库并分析]  → AI 跨仓库扫描...               │
├─ Step 3: AI 分析结果 ─────────────────────────────┤
│ AI 已从仓库中自动识别以下信息（可编辑）：          │
│                                                   │
│ 📝 产品摘要: "MyApp is a cross-platform desktop   │
│    tool for indie developers to..."               │
│                                                   │
│ 🔧 技术栈: Flutter, Dart, SQLite, Riverpod       │
│                                                   │
│ 📱 发布渠道 (AI 从 README 徽章和链接中识别):       │
│    ✅ Google Play: play.google.com/.../myapp       │
│    ✅ App Store:   apps.apple.com/.../myapp        │
│    ✅ 官网下载:    https://myapp.com/download      │
│    [+ 手动添加渠道]                                │
│                                                   │
│ 🔗 项目链接 (AI 自动识别):                         │
│    ✅ 官网:    https://myapp.com                   │
│    ✅ 文档:    https://docs.myapp.com              │
│    ✅ Discord: https://discord.gg/myapp            │
│    ✅ GitHub:  github.com/user/myapp               │
│    ✅ Twitter: @myapp                              │
│    [+ 手动添加链接]                                │
│                                                   │
│ ✨ 关键特性 (AI 从代码中提取):                      │
│    ✓ AI-powered promotion content generation      │
│    ✓ Multi-platform publishing (4 platforms)      │
│    ✓ Plugin-based architecture                    │
│    ✓ Local-first, privacy-respecting              │
│                                                   │
│ 📊 最近更新 (自 3 天前): 2 次提交                 │
│    - "Add repo analyzer component"                │
│    - "Fix OAuth callback on Windows"              │
│                                                   │
│ 🎯 建议受众: Indie developers, solo founders      │
│                                                   │
│ ⭐ README 完整性检查 (跨仓库对比):                  │
│    ⚠️ 主仓库 README 缺少 App Store 下载徽章        │
│       → [查看 PR 建议]  [忽略]                     │
│    ⚠️ 官网仓库首页未包含 Discord 社区链接           │
│       → [查看 PR 建议]  [忽略]                     │
│    ✅ Google Play 徽章已存在                       │
│    ✅ GitHub 链接已存在                            │
│                                                   │
│ [信息正确，生成推广计划 →]  [手动编辑 →]           │
└───────────────────────────────────────────────────┘

┌─ PR 建议预览 (点击 Step 3 中的 "查看 PR 建议") ────┐
│ 目标仓库: github.com/user/myapp (app_source)       │
│ 建议类型: 添加 App Store 下载徽章                   │
│                                                    │
│ 📝 AI 生成的 diff 预览:                            │
│ ┌──────────────────────────────────────────────┐   │
│ │  ## Download                                 │   │
│ │                                              │   │
│ │  [![Google Play](badge-google-play.png)]...  │   │
│ │ +[![App Store](badge-app-store.png)](url)    │   │
│ │ +[![Direct Download](badge-dl.png)](url)     │   │
│ └──────────────────────────────────────────────┘   │
│                                                    │
│ 💡 AI 解释: 用户在 AppPost 中已确认 App Store 和   │
│    官网下载两个发布渠道，但 README 仅展示了         │
│    Google Play。补齐后用户在 README 中就能找到      │
│    所有下载方式。                                  │
│                                                    │
│ [编辑 diff]  [创建 PR →]  [复制建议内容]  [忽略]   │
└────────────────────────────────────────────────────┘
```

### 8.2 推广计划视图

```
┌─ 推广计划: MyApp ──────────────────────────────────┐
│ AI 建议以下推广阶段：                               │
│                                                    │
│ ☑ 1. 首发公告 (Launch)              建议日期: 7/20 │
│    平台: [🐦 Twitter] [🔴 Reddit] [🎮 Discord]      │
│    侧重: AI-powered content, Multi-platform         │
│    [生成文案 →]  [跳过]  [调整]                     │
│                                                    │
│ ☐ 2. 技术分享 (Tech Share)           建议日期: 7/25 │
│    平台: [🔴 Reddit] [▶️ YouTube]                    │
│    侧重: Plugin architecture, Local-first design    │
│    [生成文案 →]  [跳过]  [调整]                     │
│                                                    │
│ ☐ 3. 里程碑公告 (Milestone)          建议日期: 8/1  │
│    条件: GitHub Stars > 100                         │
│                                                    │
│ [+ 添加自定义推广任务]                              │
│                                                    │
│ [列表视图] [📅 日历视图]                            │
│                                                    │
│ ┌─────────── 日历视图 (7/20–8/5) ───────────────┐  │
│ │  7/20 🐦🔴🎮 首发公告 (Launch)                 │  │
│ │  7/25 🔴▶️   技术分享 (Tech Share)              │  │
│ │  8/1  🐦🔴   里程碑公告 (Milestone)             │  │
│ │  ...                                          │  │
│ └────────────────────────────────────────────────┘  │
│                                                    │
│ [确认推广计划]                                      │
└────────────────────────────────────────────────────┘
```

### 8.3 主窗口结构

```
┌────────────────────────────────────────────────┐
│  AppPost — MyApp                   [系统托盘 ▼] [− □ ×]│
├────────┬───────────────────────────────────────┤
│        │                                       │
│  项目   │  ┌─────────────────────────────────┐  │
│  发布  │  │                                 │  │
│  收件箱│  │       内容区域                   │  │
│  统计  │  │      （按左侧导航切换）           │  │
│  设置  │  │                                 │  │
│        │  │                                 │  │
├────────┤  └─────────────────────────────────┘  │
│ 项目    │                                       │
│ 📦 MyApp│                                       │
│ [+添加] │                                       │
├────────┤                                       │
│ 已连接 │                                       │
│ 🐦 @x  │                                       │
│ 🔴 u/x │                                       │
│ [+连接]│                                       │
├────────┴───────────────────────────────────────┤
│  🟢 已连接 4/4 平台  │  MyApp · 仓库 2分钟前同步 │
└────────────────────────────────────────────────┘
```

- **左侧导航栏** — 固定宽度 220px，项目选择（上） + 功能导航（中） + 平台状态（下）
- **内容区域** — 响应式，根据导航切换
- **底部状态栏** — 当前项目、连接状态、最后同步时间

### 8.4 发布编辑器（Composer）

```
┌─ 项目 + 推广阶段 ───────────────────────────────┐
│ 项目: [MyApp ▼]  阶段: [首发公告 ▼]              │
│ AI 上下文: README + Flutter/Dart + 最近 2 提交    │
├─ 平台选择 ──────────────────────────────────────┤
│ [🐦 Twitter] [🔴 Reddit] [🎮 Discord] [▶️ YouTube]  │
│ 选中平台高亮，根据选中平台动态展示 AI 适配后的文案  │
├─ AI 生成草稿 (可编辑) ──────────────────────────┤
│ 标题: [MyApp: AI-Powered Cross-Platform... ]    │
│                                                 │
│ 正文: ┌─────────────────────────┐               │
│      │ We just launched MyApp —│               │
│      │ a desktop tool that uses│               │
│      │ AI to read your codebase│               │
│      │ and generate promotion  │               │
│      │ content...               │               │
│      └─────────────────────────┘               │
│ [🔄 重新生成] [📝 修改语气: 更正式/更轻松/...]    │
│                                                 │
│ AI 提取的特性标签:                               │
│ ✅[AI-Powered] ✅[Multi-Platform] ⚠️[Real-Time Collab]│
│ ✅[Plugin-Based] ✅[Local-First] [+ 自定义]       │
│                                                  │
│ 💡 图例: ✅代码验证 ⚠️AI推测(需核查) 💡AI润色     │
│                                                 │
│ 平台选项: (根据选中平台动态展示)                  │
│   Twitter: hashtags [#flutter #indiedev #AI]     │
│   Reddit: [选择 subreddit: r/FlutterDev ▼]       │
├─ 操作 ──────────────────────────────────────────┤
│    [保存草稿]  [预览]  [发布到 N 个平台]          │
└─────────────────────────────────────────────────┘
```

### 8.5 统一收件箱（Inbox）

```
┌─ 筛选 ──────────────────────────────────────────┐
│ [全部] [未回复] [评论] [@提及]                     │
│ 平台: [全部 ▼]  排序: [最新 ▼]                    │
├─ 互动列表 ──────────────────────────────────────┤
│ ┌─────────────────────────────────────────┐     │
│ │ 🔴 Reddit · r/iOSProgramming · 3分钟前  │     │
│ │ u/swiftdev: "This looks great! Does it  │     │
│ │ support dark mode?"                     │     │
│ │ [回复...]                    [标记已读] │     │
│ └─────────────────────────────────────────┘     │
│ ┌─────────────────────────────────────────┐     │
│ │ 🐦 Twitter · @techreviewer · 12分钟前   │     │
│ │ "Just tried this app — game changer for │     │
│ │ my workflow 🔥"                         │     │
│ │ [回复...] [引用转发]          [标记已读]│     │
│ └─────────────────────────────────────────┘     │
└─────────────────────────────────────────────────┘
```

### 8.6 统计仪表盘（Analytics）

```
┌─ 概览卡片 ──────────────────────────────────────┐
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐            │
│ │ 总计 │ │ 浏览 │ │ 点赞 │ │ 评论 │            │
│ │ 42篇 │ │ 12.3K│ │ 847  │ │ 156  │            │
│ └──────┘ └──────┘ └──────┘ └──────┘            │
├─ 按平台分布 ────────────────────────────────────┤
│ 🐦 Twitter  ████████████░░░░  18 篇            │
│ 🔴 Reddit   ████████░░░░░░░░  12 篇            │
│ 🎮 Discord  ████░░░░░░░░░░░░   6 篇            │
│ ▶️ YouTube  ██░░░░░░░░░░░░░░   3 篇            │
├─ 最近帖子表现 ──────────────────────────────────┤
│ 帖子标题                │ 浏览  │ 点赞 │ 评论  │
│ "My new app launch..." │ 2.3K  │ 142  │  38   │
│ "How we built X..."    │ 1.8K  │  96  │  24   │
└─────────────────────────────────────────────────┘
```

### 8.7 系统托盘

```
点击托盘图标 → 恢复/显示主窗口
右键托盘图标:
  ├─ 快速发布...        → 打开简化版发布弹窗
  ├─ 检查新互动 (12)    → 有未读时显示数字
  ├─ ────────────
  └─ 退出 AppPost
```

---

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

由于 AppPost 作为桌面工具需要社区用户参与测试反馈，日志不仅是调试工具，更是收集用户反馈时定位问题的关键依据。

- **文件日志**：`~/.apppost/logs/` 下按天滚动（`apppost-2026-07-14.log`），保留 14 天
- **日志分级与覆盖范围**：

| 级别 | 记录内容 |
|------|----------|
| DEBUG | 所有 Engine 层操作入口/出口（Repo Analyzer 扫描开始/结束、AI Engine 调用、Plugin 方法调用）、状态变更、文件 I/O 操作 |
| INFO | 用户可见操作（项目创建、仓库连接、推广计划生成、文案生成、发布完成、URL 回填提取、PR 建议生成）、AI 每次调用的 token 用量和耗时、应用启动/退出 |
| WARN | 重试操作（API 限频重试、网络恢复重试）、AI 返回空内容、URL 提取降级、仓库扫描跳过超大文件 |
| ERROR | 所有异常堆栈、API 调用失败、数据库操作失败、OAuth 授权失败、插件加载失败 |

- **用户操作审计日志**：单独记录到 `~/.apppost/logs/audit.log`，包含 AI 操作（输入上下文摘要、输出内容摘要）、平台发布操作、PR 创建操作，用于用户自查"AI 帮我做了什么事"
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

## 13. 构建计划

**策略：纵向切片，每阶段产出可交互的完整应用。**

### Phase 0: AI 优先 + 手动发布（最先交付，详见第 17 节）

```
零外部平台 API 依赖（仅需 AI API），验证"连接仓库 → AI 分析 → 生成推广计划 → 发布 → 回填 URL → 自动追踪"核心工作流:
  ✓ 全局 AI API 配置 (AIProvider 接口 + OpenAI 兼容实现 + 本地模型 Ollama/LM Studio 选项 + AI 数据出境提示)
  ✓ 项目管理 UI（添加项目：名称、项目状态(预热中/已发布/维护中)、多仓库连接、仓库角色分配）
  ✓ Repo Analyzer (跨仓库文件读取 + git log + GitHub API + 代码结构扫描 + 发布渠道/项目链接自动识别 + README 完整性检查)
  ✓ AI 产品理解 (跨仓库自动提取特性、亮点、发布渠道、官网/社区链接，生成产品摘要；支持预热阶段基于代码进度的推测)
  ✓ AI README 完善建议 (对比仓库内容与 AppPost 已知信息 → 生成 PR 建议 → 用户确认 → 创建 PR 或复制内容)
  ✓ AI 推广计划生成 (建议发布阶段、目标平台、推广频率 → 用户审阅确认)
  ✓ AI 多平台文案生成 (按 Twitter/Reddit/Discord/YouTube 格式自动适配，仓库上下文驱动)
  ✓ AI 辅助 Composer 编辑器（文案草稿呈现 + 用户逐平台审阅修改 + 语气微调）
  ✓ 跨平台发布清单（Checklist）：逐平台标记"已手动发布"并回填帖子 URL
  ✓ Web Intent 快捷发布：Twitter/X、Reddit 等有预填链接的平台一键跳转
  ✓ URL 回填自动提取：用户粘贴帖子 URL → 程序访问公开页面提取互动数据（优先 .json / oEmbed 等轻量方式，失败则降级为手动填报表单）
  ✓ AI 回复辅助（根据评论内容 + 仓库上下文生成个性化回复建议）
  ✓ 到期提醒（reminder 任务类型）+ 手动填报降级兜底
  ✓ 完整 SQLite Schema 设计与 migration 框架搭建（drift，覆盖 projects/status/distribution_platforms/links、project_repos/repo_role、pr_suggestions、posts/publish_mode/project_id、post_analytics/source(url_backfill/api/manual)、reminders、accounts、interactions、content_templates、ai_config、ai_actions）
  ✓ 基础设施：i18n / 错误处理 / 主题 / 系统托盘

产出: 仅需一个 AI API（可用本地模型替代），零平台 API Key 依赖，"连接仓库 → AI 生成推广计划 → 发布 → 追踪"全链路可用
```

### Phase 1: 核心体验闭环（Twitter + 基础设施完备）— 在 Phase 0 基础上叠加自动化

```
基础设施 (一次性建立):
  ✓ Flutter 项目脚手架 + Engine + Plugin 接口定义
  ✓ i18n 框架完善 (flutter_localizations + ARB, 中英双语)
  ✓ 错误处理框架 (分层异常 + 日志脱敏 + 用户可读消息)
  ✓ 暗色/亮色主题完善
  ✓ 凭据安全存储 (系统 Keychain/Credential Manager)
  ✓ OAuth 通用回调服务器 (Engine 层 OAuthCallbackServer，统一方案)
  ✓ 系统托盘 + 应用自启动
  ✓ CI 基线 (GitHub Actions: lint + test + build)
  ✓ macOS Developer ID 签名 + 公证 (+ Windows 代码签名，最低优先级)
  ✓ 自动更新框架

功能 (Twitter 端到端):
  ✓ Twitter Plugin 完整实现 (OAuth + 文本/图片发布 + 拉取互动) + 用量预算熔断
  ✓ Composer 编辑器增强 (融入 Twitter 平台特性：字数计数、hashtag 建议、图片预览)
  ✓ 统一收件箱 (真实 Twitter 数据 + AI 回复建议 — AI Engine 和 Repo Analyzer 已在 Phase 0 就位)
  ✓ 基础统计面板 (帖子级数据，合并 URL 回填与 API 拉取两种来源)

产出: 仅支持 Twitter，但"项目连接 → AI 推广计划 → 发布→追踪→回复"全链路可用，AI 优先贯穿全流程
```

### Phase 2: Reddit + Discord

```
  ✓ Reddit Plugin (OAuth + 发布 + 互动)
  ✓ Reddit 合规清理任务 (定期对比远端删除状态 → 48h 内级联清除本地缓存，
    需在 QPM 预算中预留合规检查额度，详见 P1-2)
  ✓ Discord Plugin (Bot/Webhook + 消息发送 + 互动 + Message Content Intent 申请指南)
  ✓ Composer 增加多平台选择
  ✓ Post Queue (多平台并行发布 + 排队管理 + 跨平台防刷屏最小间隔)
  ✓ Inbox 增加平台筛选
```

### Phase 3: YouTube

```
  ✓ YouTube Plugin (OAuth + videos.insert API 上传 + 配额监控与预警 + 互动追踪)
  ✓ Composer 增加视频上传区域（含上传进度与断点续传能力）
  ✓ 内容模板功能
```

### Phase 4: 统计与插件生态

```
  ✓ 统计仪表盘增强 (跨平台对比、趋势图)
  ✓ 插件管理界面
  ✓ 社区插件加载机制 (~/.apppost/plugins/)
```

### Phase 5: AI 增强模式

```
在 Phase 0 仓库驱动 AI 基础设施之上扩展自主能力:
  ✓ AI 半自动回复规则引擎 (结合仓库上下文：检测到 bug 反馈 → 自动关联 GitHub Issues)
  ✓ AI 全自动代理模式 (含安全约束：频率上限、敏感词过滤、人工随时接管)
  ✓ AI 发布策略优化 (根据代码变更节奏 + 历史互动数据优化发布时机和内容)
  ✓ AI 回复建议增强 (多轮对话上下文 + 用户历史互动偏好)
  ✓ AI 推广效果分析 — **内容效果反馈闭环**：将历史帖子的互动数据（浏览量、点赞、评论数、评论情感）作为下次生成的额外上下文注入 System Prompt（如"你上次为 Twitter 生成的帖子获得 2.3K 浏览和 142 个赞，表现最好的标签是 #indiedev 和 #flutter，文案风格偏向技术干货类更受欢迎"），AI 据此持续优化文案质量。这是 AppPost 相比通用 AI 助手的核心护城河
  ✓ AI 竞品差异化分析 — 基于项目技术栈和功能特性，搜索相似项目并建议差异化角度
  ✓ 全面错误处理覆盖
  ✓ 崩溃/异常上报 (Sentry 桌面 SDK，opt-in)
```

---

## 14. 项目文件结构

```
apppost/
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
│           └── 2025-07-14-apppost-mvp-design.md
└── README.md
```

---

## 15. 开放问题 (待后续决议)

1. **插件分发机制** — 社区插件通过 pub.dev 还是自建 registry 分发？
2. **视频上传流程** — YouTube 上传是大文件传输，是否需要断点续传和进度展示？
3. **定价策略** — 开源版 vs 付费版的功能切分线在哪里？
4. **平台 API 预算** — Twitter/X 按量计费，个人自用阶段每月预算上限是多少？超限后如何降级（如降低轮询频率、暂停自动回复）？
5. **OAuth 回调实现** — 桌面端如何接收 OAuth 授权回调？用自定义 URL Scheme（如 `apppost://oauth/callback`）还是本地 loopback HTTP server（`http://127.0.0.1:<port>/callback`）？需要在 Phase 1 基础设施阶段就定案，否则 Twitter/Reddit/YouTube 三个 OAuth 插件都要返工。
6. **桌面分发与更新** — macOS 是否走 App Store（受 App Sandbox 限制）还是 Developer ID 签名 + 公证直发？Windows 是否需要代码签名证书？自动更新用什么机制（如 `sparkle` / `electron-updater` 类似方案的 Flutter 对应实现）？
7. **测试与质量门槛** — MVP 阶段单元测试/集成测试的覆盖范围和 CI 流程尚未定义，需要在 Phase 1 基础设施中补上，否则插件化架构（4 个插件 + Engine）后期回归成本会很高。
8. **URL 回填提取可行性** — 各平台公开页面的反爬程度不同（Twitter 重度 JS 渲染、Discord 登录墙），Tier 0 URL 回填方案的逐平台降级策略需要在 Phase 0 实施前最终确认。

---

## 16. 设计评审与改进建议 (2026-07-14)

> 本节为对第 1–15 节的评审记录，按 **P0（阻断性，必须在开工前解决）/ P1（重要，应在 Phase 1 内完成）/ P2（可延后）** 排序。已核实的平台 API 事实见第 2.1 节脚注。

### P0 — 阻断性风险（会导致架构假设失效或方案不可行）

| # | 问题 | 影响 | 建议 |
|---|------|------|------|
| P0-1 | **Twitter/X API 按量付费 + Tier 0 URL 回填的 JS 渲染障碍** | Twitter 推文页面重度 JS 渲染，简单 HTTP GET 无法提取浏览/点赞/回复数；若 Tier 0 追踪手段不可用，用户仍需手动填报 | Phase 1 Twitter Plugin 调研阶段评估两个方案：(a) 轻量 headless browser（如 `flutter_inappwebview` 后台加载推文页面后提取 DOM 数据）; (b) 接受降级，Tier 0 仅提供 URL 记录 + 手动填报表单。方案 (a) 的资源开销和稳定性需要在技术验证中确认 |
| P0-2 | **Twitter/X API 已是按量付费（credit-based），无稳定免费额度** | "自用优先"的成本假设不成立；统一收件箱要持续拉取 mentions/comments，加上发布、AI 生成前的上下文查询，都会产生持续费用 | 在 Phase 1 前明确月度预算上限，Task Scheduler 增加"用量预算熔断"（超预算自动降频/暂停），并在设置页展示实时用量/剩余额度 |
| P0-3 | **OAuth 桌面回调实现方式未定义** | 4 个插件中 3 个依赖 OAuth（Twitter/Reddit/YouTube），Discord 走 Bot/Webhook，若不统一方案，后期改造成本随插件数线性增长 | Phase 1 基础设施阶段确定统一方案：优先用**本地 loopback HTTP server**（跨平台兼容性最好，Reddit/Google/Twitter 官方示例均支持），封装为 Engine 层通用 `OAuthCallbackServer`，插件复用而非各自实现。注意 Windows 防火墙可能拦截 `127.0.0.1` 入站连接，Phase 1 需同时在 Windows 上验证可行性；若不可行，备选方案为自定义 URL Scheme（`apppost://oauth/callback`） |
| P0-4 | **AI 内容出境与"本地优先/凭据不离开设备"原则表述冲突** | 第 1.3 节宣称"凭据不离开用户设备"，但 6.4 节 AI Engine 会把产品描述、草稿正文、用户评论原文发送给第三方 OpenAI 兼容 API，用户可能误解隐私边界 | 明确区分"凭据"（永不出境）与"内容"（辅助模式下会出境，需用户显式同意）；设置页增加"AI 数据处理说明"和一键切换本地模型（Ollama/LM Studio）选项，默认高亮本地方案 |
| P0-5 | **完全缺失测试策略与 CI** | 插件化架构（Engine + 4 插件 + AI Engine）没有自动化测试和 CI 门槛，Phase 2/3 新增插件时极易破坏既有功能 | Phase 1 交付物中加入：Engine/Plugin 接口的单元测试基线、Mock Plugin 用于 Composer/Inbox 集成测试、GitHub Actions CI（lint + test + build）跑通后才能合并 |
| P0-6 | **缺失打包签名、公证与自动更新方案** | 桌面应用没有此能力等于无法安全分发；macOS 未公证会被 Gatekeeper 拦截，用户信任度和可用性都受损 | Phase 1 末尾必须产出可安装、可自动更新的签名包（至少 macOS Developer ID 签名 + 公证），否则后续阶段的"可交互完整应用"目标名不副实 |

### P1 — 重要缺陷（应在对应 Phase 内补齐，不阻断启动）

| # | 问题 | 建议 |
|---|------|------|
| P1-1 | YouTube 默认配额 10,000 单位/天，`videos.insert` 单次 1600 单位，即默认额度下每天最多约 6 次上传，且与评论/统计查询共享额度 | 在 Phase 3 的 YouTube Plugin 设计中加入配额监控与"配额延期申请"预案；避免设计成高频轮询互动（`commentThreads.list` 更省额度，优先用它而非重复 `videos.list`） |
| P1-2 | Reddit Data API Terms 要求"内容被删除后 48 小时内必须清除本地留存的对应数据" | `interactions` 表需要设计定期清理任务（对比远端删除状态并级联清除），而非只做"增量拉取"，否则违反平台合规条款 |
| P1-3 | 数据库 Schema 无迁移策略说明 | 明确使用 drift 的 migration 机制（`MigrationStrategy`），并在 Phase 1 基础设施checklist 中加入"schema version + 迁移测试" |
| P1-4 | 无崩溃/异常上报机制 | 增加 opt-in 的错误上报（如 Sentry 桌面 SDK），默认关闭，设置页可开启；日志脱敏规则需要同步覆盖上报数据 |
| P1-5 | 平台自动化/反刷屏政策风险未提及 | 各平台（尤其 Reddit 自我推广规则、Twitter 自动化规则）对重复/批量跨平台发布内容有限制，容易被标记为 spam 导致封号；需在 Post Queue 增加"内容差异化提示"和"同账号跨平台发布最小时间间隔"防护 |
| P1-6 | Discord 互动拉取依赖 Privileged Message Content Intent | 需在 Discord Plugin 设计中提前说明：Bot 若要读取消息正文需在 Discord 开发者后台单独申请该 Intent（>100 服务器需人工审核），MVP 阶段应假设小规模使用 |
| P1-7 | "多账号管理"被排除在 MVP 外 | ✅ 已决策（明确排除） | 2.3 节已明确"验证阶段单账号即可满足自用需求，多账号留待社区反馈后评估"，`accounts` 表已是多行设计，仅需 UI/Engine 层暴露，届时成本很低 |
| P1-8 | 无 CI/CD 发布流水线说明 | Phase 1 中补充：GitHub Actions（或等价工具）跑测试 + 构建三平台安装包 + 版本号自动打标签 |

### P2 — 可延后完善项

| # | 问题 | 建议 |
|---|------|------|
| P2-1 | 缺少非功能性指标（启动时间、内存占用、轮询对电量/CPU影响） | Phase 4 前补充基准测试与目标值 |
| P2-2 | 未提及无障碍访问（a11y） | Flutter 原生支持 Semantics，纳入 Composer/Inbox 组件设计规范即可，成本很低，建议提前而非放到最后 |
| P2-3 | 插件市场/社区分发机制仍是开放问题 | 维持现状，待社区规模验证后再决策（pub.dev vs 自建 registry） |
| P2-4 | 无产品使用数据遥测（用于指导路线图） | 可延后到开源社区反馈机制建立之后，做成 opt-in、可完全关闭 |

### 落地建议（优先级执行顺序）

1. 先解决 **P0-1 / P0-2**（评估 Twitter URL 回填的 headless browser 方案可行性与 API 付费预算），这两项可能影响 Phase 0/1 的范围定义，越早确认越省后期返工。
2. 在 Phase 1 "基础设施 (一次性建立)" 清单中，正式加入：`OAuthCallbackServer`（P0-3）、CI + 测试基线（P0-5）、签名/公证/自动更新（P0-6）、AI 数据出境提示（P0-4）。
3. P1 项按对应 Phase 顺延（Reddit 合规清理 → Phase 2；YouTube 配额监控 → Phase 3），不阻塞 Phase 1 启动。
4. P2 项维持"后续版本"定位不变。

---

## 17. 手动发布与分级追踪能力模型 (2026-07-14)

> 背景：Twitter/X 计费是阻断性风险，且 Product Hunt 已因授权不可控从 MVP 中移除。本节回答"能否在不接入/不付费第三方 API 的情况下，仍提供发布协助和基础追踪"，并给出可落地的分级设计。

### 17.1 三级能力模型

| Tier | 发布 | 追踪 | 是否需要 API Key / 费用 | 适用场景 |
|------|------|------|--------------------------|----------|
| **Tier 0 手动（Manual）** | AI 辅助生成文案/素材，用户在浏览器或客户端里自行点击发布；若平台有官方/事实标准的"预填链接"（Web Intent），应用一键跳转+预填，用户只需点最后一下 | 用户发布后将帖子 URL 回填到应用；应用自动访问该公开 URL 提取浏览量/点赞/评论数（可行性因平台而异，不可行时降级为手动填报表单）；应用负责存档、画趋势图、发提醒 | **不需要**（访问公开 URL，无 API Key） | 全平台通用兜底，MVP 首个可交付切片（Phase 0） |
| **Tier 1 只读追踪（Read-only Tracking）** | 同 Tier 0（不支持自动发布） | 应用用免费/轻量的只读凭据（应用级 API Key 或只读 OAuth，不要求用户提供付费凭据）自动拉取统计和评论 | 需要一个**免费**的开发者凭据（用户自助申请），无需为读取付费 | YouTube、Reddit |
| **Tier 2 全自动（Full Auto）** | 应用通过 OAuth 直接发布 | 应用通过 OAuth 自动拉取统计和评论 | 需要完整 OAuth，**可能需要付费**（如 Twitter/X 读写） | Twitter/X（付费）、Discord（免费 Bot）、已获授权的 Reddit/YouTube 写操作 |

插件通过 `publishMode`/`trackingMode`（见第 5.1、5.3 节）向 Engine 声明自己当前处于哪一档，UI 据此切换成"自动发布按钮" / "一键预填跳转" / "回填 URL 自动追踪" / "手动填报表单（降级）"，用户不需要先申请到任何 API Key 就能使用 Tier 0 的完整工作流。

> ⚠️ **Tier 1"免费 API Key"在多用户分发场景下的风险（2026-07-14 二次复核补充）**：上表写"用户自助申请"，但按 1.1 节"自用 → 开源社区驱动"的路线图，一旦项目开源分发给多个用户，若 Tier 1 用的是 **AppPost 内置的单一 API Key/Token**（如打包在应用里的 YouTube API Key），所有安装会共享同一份配额/频率限制，热度上升后会远早于预期被耗尽甚至触发平台封禁该 Key。默认应采用**用户自助申请**（提供引导式设置向导："打开 Google Cloud Console → 启用 YouTube Data API → 粘贴你自己的 API Key"），"AppPost 自带 Key"只能作为自用阶段的临时方案，进入开源分发前必须切换为用户自助模式。

### 17.2 逐平台结论

| 平台 | Tier 0 发布 | Tier 0 追踪（回填 URL，零 API Key） | Tier 1 只读追踪可行性 | 浏览量可获取？ | 回复/评论可获取？ |
|------|-------------|--------------------------------------|------------------------|-----------------|---------------------|
| **Twitter/X** | ✅ 官方 Web Intent（`twitter.com/intent/tweet?text=...`）免费、零 API，打开浏览器预填文案，用户自己点发送 | ⚠️ 推文页面重度 JS 渲染，简单 HTTP GET 无法提取数据；需评估 headless browser 方案（如在 WebView 中后台加载推文后提取 DOM），或接受降级为手动填报 | ❌ 读取已随 v2 API 转为按量付费，没有可用的免费只读额度 | Tier 2（付费）可自动拉取；Tier 0 需 URL 回填提取或手动填报 | 同上 |
| **Reddit** | ✅ 非官方但广泛使用的预填提交页（`reddit.com/r/{subreddit}/submit?title=...&url=...`），浏览器里用用户自己的登录态发布 | ✅ **最佳平台**：Reddit 帖子 URL 追加 `.json` 后缀即可免费获取结构化 JSON 数据（含 upvote 数、评论数、评论正文），无需 API Key，无需 OAuth，无 JS 渲染障碍 | ✅ 只读 API 免费（100 QPM/OAuth client），与 `.json` 方式互补 | ❌ Reddit 已从公开数据中移除"浏览量"指标，**任何 Tier 都拿不到**，这是平台限制而非 API 层面限制 | ✅ URL `.json` 方式（Tier 0）和 API（Tier 1）均可免费获取 |
| **Discord** | ⚠️ 无公开预填链接机制，用户需手动在客户端/网页发消息；应用提供文案复制 + 清单打勾 | ❌ 消息链接需登录才能查看，无公开访问入口；Tier 0 只能记录消息链接作为参考，追踪需等 Tier 1（Bot） | ✅ 免费 Bot Token 即可读取频道消息/reaction（<100 服务器规模的自用无需审批 Message Content Intent），可自动检测新回复 | 平台不存在该指标 | ✅ Tier 1 可自动追踪（免费 Bot，仍需申请 Bot Token，但不涉及付费） |
| **YouTube** | ⚠️ 无公开 Web Intent 预填链接；视频文件无法通过 URL 参数传递，用户可选择手动上传或通过 Tier 2 API 上传（`videos.insert`，单次消耗约 1600 配额单位） | ⚠️ 视频页面公开显示统计数据，但页面中度 JS 渲染；可尝试 oEmbed（`youtube.com/oembed?url=...`）获取基础信息 + 公开页面正则提取统计数字；Tier 1 API 是更可靠的选择 | ✅ **仅需一个免费的 API Key**（Google Cloud 项目，无需用户 OAuth 授权）即可拉取 `statistics.viewCount/likeCount/commentCount` 及评论正文，成本约 1 配额单位/次，是四个平台中读取最省成本的一个；Tier 2 可通过 OAuth + `videos.insert` 实现 API 上传（需用户授权，受配额限制，默认约 6 次/天） | ✅ Tier 1 可自动追踪（免费）；Tier 0 部分可行 | ✅ Tier 1 可自动追踪（免费） |

**核心结论：**
1. **"不用自动发帖，只提供素材，用户手动发布"—— 可行，且应作为 MVP 第一个交付切片（Phase 0）**，四个平台都支持这种模式，Twitter/Reddit 还能做到"一键预填跳转"而不是纯复制粘贴。
2. **"回填 URL 后能否自动追踪"—— 分平台回答**：Reddit 最佳（`.json` 后缀零成本获取结构化数据）；YouTube 部分可行（需组合 oEmbed + 页面解析）；Twitter 有 JS 渲染障碍（需评估 headless browser 方案或降级）；Discord 不可行（登录墙）。各平台不可行时均降级为手动填报表单。
3. **"应用能否降级为不需要第三方 API Key 也能用"—— 可行**：Tier 0 完全不需要任何平台凭据，可提供的基础功能包括：AI 辅助内容起草与模板（Composer）、跨平台发布清单与预填跳转、回填 URL 自动提取（或降级为手动填报）、趋势图、到期提醒。这些价值对独立开发者是真实存在的（统一的"AI起草→发布→回填URL→自动追踪"工作台），且完全符合"本地优先"原则。

### 17.3 手动模式 UX 要点

```
发布清单（Checklist）视图:
  □ Twitter/X   [AI生成文案] [一键预填并跳转 →]   已发布 ✓ [回填URL]
  □ Reddit      [AI生成文案] [一键预填并跳转 →]   待发布
  □ Discord     [AI生成文案] [复制文案] [打开 Discord]
  □ YouTube     [AI生成文案] [复制标题/描述] [打开 YouTube Studio]

回填 URL 后自动提取（Tier 0 追踪，按平台能力降级）:
  帖子 URL: [https://twitter.com/user/status/123456                  ]
  → 自动访问 → 提取到: 浏览 1.2K | 点赞 89 | 评论 23 | 最后更新 2 分钟前
  → 存入 post_analytics（source = url_backfill），画入同一张趋势图
  
  若平台不支持自动提取（如 Discord）或提取失败（如 Twitter JS 渲染超时）：
  → 自动降级为手动填报表单: 浏览 [____] 点赞 [____] 评论 [____]
  → 存入 post_analytics（source = manual）

到期提醒（reminders 任务）:
  "《XXX 发布》已 3 天未更新数据，去看看反馈吧" → 点击直接打开回填的 URL
```

### 17.4 对构建计划的影响

- **Phase 0（新增）优先交付 Tier 0**：零外部依赖，"AI 起草 → 发布 → 回填 URL → 自动提取"全链路可用，不受 Twitter 计费阻塞，能最早验证核心工作流。
- **Tier 1（YouTube / Reddit 只读追踪）可以提前到 Phase 1～2**，因为它们免费、不需要等待授权，比"等 Twitter 付费预算批下来"更快见效。
- **Tier 2（Twitter 全自动）保持为独立的"增强层"**，在预算到位后再启用，不阻塞前两层的交付。

---

## 18. 二次复核记录 (2026-07-14 修订后)

> 上一轮评审（第 16 节）提出的问题已基本被本次修订采纳并落到 Phase 计划/接口设计中。本节先核对落地情况，再记录二次复核中新发现的问题（其中低风险的已直接修复，标注 ✅）。

### 18.1 上次 P0/P1 项落地核对

| # | 上次建议 | 本次是否已体现 | 说明 |
|---|----------|----------------|------|
| P0-1 | Product Hunt 商用限制 | ✅ 已解决（平台移除） | Product Hunt 已从 MVP 中完全移除，不再阻塞任何 Phase |
| P0-2 | Twitter 预算熔断 | ✅ 已体现 | Phase 1 Twitter Plugin 增加"用量预算熔断" |
| P0-3 | OAuth 回调统一方案 | ✅ 已体现 | Phase 1 加入 `OAuthCallbackServer`，第 16 节已补充 Windows 防火墙风险备注 |
| P0-4 | AI 数据出境提示 | ✅ 已体现 | Phase 1 AI 配置 UI 增加"AI 数据出境提示" |
| P0-5 | 测试与 CI | ✅ 已体现 | Phase 1 加入 CI 基线 |
| P0-6 | 签名/公证/自动更新 | ✅ 已体现 | Phase 1 加入 macOS 签名公证 + 自动更新框架 |
| P1-1 | YouTube 配额监控 | ✅ 已体现 | Phase 3 "配额监控与预警" |
| P1-2 | Reddit 48h 合规清理 | ✅ 已体现 | Phase 2 "Reddit 合规清理任务" |
| P1-3 | Schema 迁移策略 | ✅ 已体现 | Phase 0 "migration 框架搭建" + Phase 1 "增量 Schema 迁移" |
| P1-4 | 崩溃/异常上报 | ✅ 已体现 | Phase 5 已加入"崩溃/异常上报 (Sentry 桌面 SDK，opt-in)" |
| P1-5 | 反刷屏/自动化政策风险 | ✅ 已体现 | Phase 2 Post Queue "跨平台防刷屏最小间隔" |
| P1-6 | Discord Message Content Intent | ✅ 已体现 | Phase 2 Discord Plugin 说明中已加入申请指南 |
| P1-7 | 多账号管理纳入 MVP 的建议 | ⚠️ **未体现** | 2.3 节仍将"多账号管理"列为 MVP 不做，与第 16 节"建议纳入 Phase 1"的结论不一致，需显式决定采纳或保留排除 |
| P1-8 | CI/CD 流水线 | ✅ 已体现（部分） | Phase 1 CI 基线已加入，安装包打包/自动打标签细节可后续补充 |

### 18.2 本轮复核新发现的问题

1. ✅ **Schema 重复定义** — `ai_config`/`ai_actions` 此前在 6.8 与 7.1 两处重复绘制 ER 图，已将 6.8 改为文字引用 7.1，避免后续修改两处不同步。
2. ✅ **Analytics Engine 缺少接口定义** — 3.1 架构图与 5.2 都引用了 `AnalyticsEngine.submitManualStats()`，但第 4 节 Core Engine 组件里此前没有像其余组件一样给出对应设计小节；已新增 4.7 补齐（`recordApiStats` / `submitManualStats` / `watchTrend` / `extractFromPublicUrl`）。
3. ✅ **Task Scheduler 任务类型未同步新增的到期提醒** — 4.2 的任务类型列表已补充 `reminderCheck`，对应 Phase 0 引入的 `reminders` 表。
4. ✅ **Tier 1"免费 API Key"在多用户分发场景下的共享配额风险（新发现）** — 若按 1.1 节路线图开源分发，"AppPost 自带 Key"会被所有安装共享，配额会远早于预期耗尽甚至触发平台封禁；已在 17.1 补充说明：默认走"用户自助申请 + 引导式设置向导"，"AppPost 自带 Key"仅作自用阶段临时方案。
5. ⚠️ **`publishMode`/`trackingMode` 建模为编译期静态 getter，无法表达"同一插件因用户凭据等级提升而升档"** — 例如用户后续购买 Twitter 付费额度后，理应让同一个 Twitter 插件从 Tier 0（webIntent/manualEntry）切换到 Tier 2（apiAuto），而不需要实现两个插件类。当前接口把这两个属性定义成固定 getter，语义上暗示编译期不变；建议后续实现阶段改为运行时按已连接的 `Credential` 类型/账号状态计算（如 `Future<PublishMode> currentPublishMode()`）。本轮先记录为待办，未改动第 5.1 节伪代码接口，避免在未与工程团队确认前过度设计。

### 18.3 待决策事项（需要产品/工程决策，非单纯文档修复）

- **P1-4 崩溃上报**：已纳入 Phase 5（AI 增强模式），理由：崩溃上报（Sentry 桌面 SDK）与错误处理框架的分层日志是同一批基础设施投入，可在 Phase 5 统一补齐，不阻塞 Phase 0–4 的核心功能交付。
- **P1-7 多账号管理**：已于 2.3 节明确排除（"验证阶段单账号即可满足自用需求，多账号留待社区反馈后评估"），`accounts` 表已是多行设计，仅需 UI/Engine 层暴露，届时成本很低。
