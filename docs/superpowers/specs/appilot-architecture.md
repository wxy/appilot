# Appilot — MVP 设计文档


> 所属：[Appilot MVP 设计文档集](./README.md) | 状态：已确认 | 日期：2025-07-14 | 修订：2026-07-15（Phase 0 最小闭环简化 + publishMode/TrackingMode 动态化 + Schema 分层）
> 姊妹文件：[产品规格](./appilot-product.md) · [架构设计](./appilot-architecture.md) · [UI 设计](./appilot-ui.md) · [构建计划](./appilot-build-plan.md) · [横切关注点](./appilot-cross-cutting.md) · [评审记录](./appilot-review-log.md)
> 本文档定义 Appilot 的**技术架构**：分层设计、Core Engine 各组件接口与实现策略、Plugin 接口规范、AI 智能引擎设计、数据模型与数据库 Schema。标注了 **Phase 0 简化版**（最小闭环）vs **完整愿景**（Phase 5 完成后）的差异。


## 3. 架构设计

### 3.0 Phase 0 简化架构（最小闭环）

> Phase 0 仅实现以下组件。完整架构（§3.1）中的 Event Bus、Post Queue、Task Scheduler、Credential Vault 等组件推迟到 Phase 1+。

```
┌─────────────────────────────────────────────────────┐
│                Presentation Layer                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────────┐ │
│  │  Setup   │ │ Composer │ │   Post Tracking      │ │
│  │  Wizard  │ │ 编辑器   │ │ (回填URL + 手动填报)   │ │
│  └──────────┘ └──────────┘ └──────────────────────┘ │
├─────────────────────────────────────────────────────┤
│                Application Layer                     │
│  ┌──────────────────────────────────────────────┐   │
│  │          State Management (Riverpod)          │   │
│  └──────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────┤
│                 Core Engine (Phase 0)                │
│  ┌───────────────┐ ┌──────────────┐ ┌────────────┐  │
│  │ Repo Analyzer │ │  AI Engine   │ │  Content   │  │
│  │ (GitHub only) │ │ (摘要+推文)  │ │   Store    │  │
│  └───────────────┘ └──────────────┘ └────────────┘  │
│  ┌──────────────────────────────────────────────┐   │
│  │          Analytics Engine (手动填报)          │   │
│  └──────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────┤
│                  Data Layer                          │
│  ┌─────────────────┐                                │
│  │  SQLite (drift)  │  (5 张表: projects, posts,    │
│  │                  │   post_analytics, ai_config,   │
│  │                  │   ai_actions)                  │
│  └─────────────────┘                                │
└─────────────────────────────────────────────────────┘
```

**Phase 0 不包含的组件（推迟到 Phase 1+）：**
- Plugin Registry / Plugin 接口 — Twitter Web Intent 直接硬编码 URL 构建
- Task Scheduler — 无定时任务、无后台轮询
- Event Bus — 直接函数调用即可
- Post Queue — 单平台手动发布，无需排队
- Credential Vault — 无 OAuth Token 需要存储（仅 AI API Key 存 SQLite）
- Project Registry — 全局只有一个项目

### 3.1 完整愿景架构：Hub-and-Spoke（Phase 5 完成后）

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
- **Plugin 只能被 Core Engine 调用** — UI 层不直接和 Plugin 交互，通过 Engine 中转（⚠️ Phase 0 不使用 Plugin 层，Twitter Web Intent URL 由 Composer UI 直接构建）
- **Event Bus 是单向的** — Plugin → Event Bus → UI 订阅更新，Plugin 不感知 UI 存在（⚠️ Phase 1+ 引入，Phase 0 使用直接函数调用）

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

> **Phase 0 范围**：仅实现 4.5 Content Store（简化版）、4.7 Analytics Engine（仅手动填报）、4.8 Repo Analyzer（仅单 GitHub 公开仓库）。其余组件（4.1–4.4、4.6、4.9）推迟到 Phase 1+。每个组件的 Phase 0 简化策略详见对应小节。

### 4.1 Plugin Registry（插件注册中心）— Phase 1+

```
职责: 插件发现、验证、加载、生命周期管理

加载来源:
  - 内置目录 (app/plugins/*/)
  - 用户插件目录 (~/.appilot/plugins/*/)  [MVP 后支持]

加载流程:
  scan() → validate(version, interface) → load() → onInit()
  任何一个插件加载失败不影响其他插件
```

### 4.2 Task Scheduler（任务调度器）— Phase 1+

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

### 4.3 Event Bus（事件总线）— Phase 1+

```
事件流向: Plugin/Engine → EventBus → UI 订阅者

事件类型:
  - PostPublished(platformId, postId, permalink)
  - NewInteraction(platformId, postId, interaction)
  - PostStatsUpdated(platformId, postId, stats)
  - PluginStatusChanged(pluginId, status)  // connected, error, rate_limited
  - TaskFailed(taskId, error)
```

### 4.4 Post Queue（发布队列）— Phase 1+

```
职责: 发布请求的排队、重试、冲突处理

策略:
  - 每个平台独立队列（一个平台限频不影响其他平台）
  - 发布失败自动重试（指数退避，最多 3 次）
  - 限频时暂停该平台队列，等待窗口恢复
```

### 4.5 Content Store（内容存储）— Phase 0（简化版）

```
职责: 草稿保存/加载 + 发布历史记录

Phase 0 实现:
  - 草稿手动保存/加载（用户点击"保存草稿"按钮）
  - 发布历史按时间检索（列表展示）
  - 内容模板推迟到 Phase 3

设计说明:
  - "30 秒无操作自动保存"由 Composer UI 层触发（监听输入框空闲超时），
    而非 Content Store 自行启动计时器。Content Store 只暴露 saveDraft()/loadDraft()，
    不感知 UI 输入状态。
```

### 4.6 Credential Vault（凭据保险箱）— Phase 1+

```
职责: 凭据的存储、读取、刷新

实现:
  - 存储: macOS Keychain / Windows Credential Manager
  - OAuth Token 过期前自动刷新（如果有 refresh_token）
  - 提供统一的 read/write/delete 接口
  - 凭据仅在内存中持有，不落盘明文
```

### 4.7 Analytics Engine（统计分析引擎）— Phase 0（仅手动填报）

```dart
abstract class AnalyticsEngine {
  // ── Phase 0 实现 ──

  /// Phase 0：用户在手动填报表单中提交的统计写入（source = manual）
  Future<void> submitManualStats(ManualStatsEntry entry);

  /// Phase 0：按帖子查询历史快照，供趋势折线图使用
  Stream<List<PostAnalyticsSnapshot>> watchTrend(String postId);

  // ── Phase 1+ 扩展 ──

  /// Tier 1/2：插件通过 API 拉取到的统计写入（source = api）
  Future<void> recordApiStats(String postId, InteractionStats stats);

  /// Tier 0：用户回填 URL 后自动提取的统计写入（source = url_backfill）
  Future<void> recordUrlBackfillStats(String postId, InteractionStats stats);

  /// Tier 0：通过插件访问公开 URL 提取互动数据
  Future<PostStatsFromUrl> extractFromPublicUrl(String url, String platformId);
}
```

**Phase 0 设计说明**：仅实现 `submitManualStats` 和 `watchTrend`。`post_analytics.source` 在 Phase 0 始终为 `manual`（其余 source 值预留枚举，Phase 1+ 启用）。手动统计不经过 Plugin 接口——UI 层直接调用 `AnalyticsEngine.submitManualStats()` 写入数据库。

### 4.8 Repo Analyzer（代码仓库分析器）— Phase 0（仅单 GitHub 公开仓库）

```dart
abstract class RepoAnalyzer {
  // ── Phase 0 实现 ──

  /// 连接 GitHub 公开仓库并建立索引（仅需 repo URL，无需 Token）
  /// GitHub 公开 API 限制 60 req/h（未认证），超出后提示用户"提供 PAT 可提升至 5,000 req/h"或降级为使用缓存
  Future<RepoIndex> connectGitHubPublicRepo(String githubUrl);

  /// 刷新索引（重新拉取 README、文件树、最近提交）
  Future<RepoIndex> refresh(String projectId);

  /// 获取仓库的结构化摘要（供 AI 作为上下文）
  /// 包含：README、技术栈（从 package.json/pubspec.yaml 等提取）、目录结构、最近 10 次提交
  Future<RepoSummary> summarize(String projectId, {int maxFiles = 30});

  /// 提取可推广的功能亮点（基于代码特征的启发式分析 + AI 提炼）
  Future<List<FeatureHighlight>> extractHighlights(String projectId, AIContext aiContext);

  // ── Phase 1+ 扩展 ──

  /// 连接本地仓库（直接读取文件系统 + 执行 git 命令）
  Future<RepoIndex> connectLocalRepo(String localPath);

  /// 连接 GitHub 私有仓库（需 PAT，存 Keychain）
  Future<RepoIndex> connectGitHubPrivateRepo(String githubUrl, String pat);

  /// 自动识别发布渠道（从 README 中的 App Store 徽章、Google Play 链接等提取）
  Future<List<DistributionPlatform>> detectDistributionPlatforms(String projectId);

  /// 自动识别项目关联链接（官网、文档、社区等）
  Future<ProjectLinks> detectProjectLinks(String projectId);

  /// 跨仓库分析：对比各仓库 README/网站内容与 Appilot 已知信息
  Future<ReadmeCompleteness> checkReadmeCompleteness(String projectId);

  /// 获取最近变更摘要（自上次推广以来的新提交/新功能）
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
  final String description;    // "README 中未找到 Google Play 下载徽章，但 Appilot 项目已确认 Google Play 为发布渠道"
  final String? existingInAppilot; // Appilot 中已有的对应信息
  final String? suggestedFix;  // AI 建议的修改内容
}
```
**Phase 0 仓库来源**：仅 GitHub 公开仓库（输入 `github.com/user/repo` URL）。使用 GitHub REST API（未认证，60 req/h 限制）。`connectGitHubPublicRepo()` 单次完整分析（README + 文件树 + 最近提交）消耗约 5–10 次请求。

> ⚠️ **GitHub API 限频处理**（Phase 0）：公开 API 60 req/h 对个人自用通常足够，但若短时间内多次刷新，触发限频后：
> 1. 提示用户"GitHub API 频率限制已达上限，请稍后重试或提供 Personal Access Token（可提升至 5,000 req/h）"
> 2. 降级为使用上次缓存的 RepoIndex，UI 标记数据为"可能过时"
> 3. 在设置页展示当前剩余请求数
>
> Phase 1+ 扩展：支持本地仓库（`connectLocalRepo`）、私有仓库（`connectGitHubPrivateRepo` + PAT 存 Keychain）。

**Phase 0 大仓库处理策略**（Phase 0 仅处理 GitHub 公开仓库，以下策略足够）：
- 文件过滤：默认遵循 .gitignore，自动跳过 `node_modules` / `.git` / `build` / `dist` / `vendor`
- 文件大小：单文件 > 200KB 只提取文件名和大小，不读取内容
- 二进制跳过：自动识别并跳过
- 深度限制：目录树扫描最大深度 4 层
- 文件上限：`summarize()` 的 `maxFiles` 默认 30（Phase 0 单仓库场景足够）；超出时按文件重要性排序（README > CHANGELOG > package 文件 > src 目录）

```
Phase 0 AI 上下文组装流程（单仓库 → AI Engine）:
  1. 读取仓库 README.md → 提取产品描述、安装说明
  2. 从 package.json / pubspec.yaml / Cargo.toml 等 → 提取技术栈和依赖
  3. git log --since="14 天前" → 提取最近提交摘要（最多 10 条）
  4. 扫描目录结构 → 识别主要功能模块（src/lib/app 等）
  5. 读取 CHANGELOG.md（如存在）→ 提取版本更新内容
  6. 组装为结构化 System Prompt 注入 AI 对话

Phase 1+ 扩展流程（多仓库、跨仓库分析、发布渠道/链接识别、README 完整性检查）:
  见完整架构文档 §6.3 中的跨仓库上下文组装（遍历 app_source/website/docs 多仓库、徽章提取、
  README 完整性对比等），Phase 0 不涉及。
```

### 4.9 Project Registry（项目注册中心）— Phase 1+

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
  - ⭐ README 完整性报告: AI 对比仓库内容与 Appilot 已知信息，
    自动发现遗漏 → 建议 PR 补齐
  
  - AI API 配置: Provider URL + API Key（全局配置，所有项目共享）
```

---


## 5. Plugin 接口设计（Phase 1+ 启用）

> ⚠️ **Phase 0 不使用 Plugin 层**：Twitter Web Intent URL 构建逻辑直接在 Composer UI 中硬编码（`https://twitter.com/intent/tweet?text=${encodedText}`），无需插件抽象。Plugin 接口的完整设计保留供 Phase 1+ 参考——届时 Twitter OAuth 自动发布、Reddit/Discord/YouTube 接入都通过此接口实现。

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
  Future<Credential?> getCredential();  // 返回已存储的凭据（用于 currentPublishMode/currentTrackingMode 动态计算）
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
  /// ⚠️ Phase 0 不使用此属性（Phase 0 仅支持 Twitter Web Intent，硬编码 URL 构建，不通过 Plugin 接口）

  TrackingMode get trackingMode;
  /// apiAuto：已认证后自动拉取
  /// apiReadOnly：仅需免费/只读凭据即可自动拉取（不要求发布权限）
  /// urlBackfill：通过公开 URL 自动提取（无需 API Key）
  /// manualEntry：平台无免费只读接口，需用户手动填报
  /// unavailable：平台本身不提供该指标（如浏览量）
  /// ⚠️ Phase 0 不使用此属性（Phase 0 仅手动填报，不通过 Plugin 接口）

  /// 运行时动态计算当前发布模式（根据已连接的 Credential 类型/状态）
  /// 例：用户后续购买了 Twitter 付费额度并完成 OAuth 授权后，
  /// 同一插件实例从 webIntent 升档为 apiAuto，无需换一个插件类
  Future<PublishMode> currentPublishMode() async {
    final cred = await getCredential();
    if (cred is OAuthToken && cred.isValid) return PublishMode.apiAuto;
    return PublishMode.webIntent;
  }

  /// 运行时动态计算当前追踪模式
  Future<TrackingMode> currentTrackingMode() async {
    final cred = await getCredential();
    if (cred is OAuthToken && cred.isValid) return TrackingMode.apiAuto;
    if (cred is ApiKey) return TrackingMode.apiReadOnly;
    return TrackingMode.manualEntry;
  }

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
- **发布/追踪能力分级** — `publishMode`/`trackingMode` 保留静态 getter 用于插件初始能力声明（编译期已知的平台上限）。**运行时实际可用模式**通过 `currentPublishMode()`/`currentTrackingMode()` 动态计算——根据用户已连接的 `Credential` 类型和状态（OAuth Token 是否有效、是否为只读 API Key）自动升档/降档。例如用户后续购买 Twitter 付费额度后，同一插件实例从 Tier 0（webIntent/manualEntry）切换到 Tier 2（apiAuto），无需实现两个插件类。UI 层根据运行时模式切换"自动发布按钮"/"一键预填跳转"/"手动填报表单"
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

> ⚠️ **设计说明**：此处的"插件"是**架构层面的抽象**（分离关注点、定义接口契约），而非用户可选的"安装/卸载"模块。所有平台插件在编译期随应用一起打包为单一可执行文件，用户获得的是一个完整应用，不是需要手动安装插件的框架。

- **内置插件** — 4 个官方平台插件通过 `pubspec.yaml` 本地路径引用，编译期全部集成。针对单个用户只需要 1~2 个平台的场景：未配置凭据的插件处于"未激活"状态（`publishMode = manualOnly`），UI 上灰显或隐藏，不产生运行时开销
- **社区插件（Phase 4+）** — 对于社区贡献的新平台插件，MVP 后有两种可行路径：
  - **编译期集成**：社区贡献者提 PR，插件随应用一同编译发布。稳定可靠，但更新慢。
  - **进程隔离 + 标准化协议**（Phase 4 评估）：插件作为独立进程，通过 stdin/stdout JSON-RPC 或 gRPC 与 Engine 通信。可行但复杂度高，需在 Phase 4 做技术验证后决定。
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
                         │  │ README 完善建议  │  │  ← 对比仓库与 Appilot 信息，生成 PR
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

AI Engine 是 Appilot 的核心差异化组件，**通过 Repo Analyzer 读取代码仓库来理解产品**，而非依赖用户手动填写产品描述。AI 从 README、git 提交历史、代码结构和技术栈中自动提取真实的特性、更新和亮点，据此生成推广文案和发布计划。AI Engine 通过现有的 Plugin 接口与各平台交互，不直接操作平台 API。

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
  → AI 对比仓库中的 README/官网内容与 Appilot 已知信息
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

  /// Phase 0：单仓库上下文组装（GitHub 公开仓库 → Twitter 推文生成）
  Future<AIContext> buildContext(String projectId) async {
    final repo = await _repoAnalyzer.summarize(projectId);
    final highlights = await _repoAnalyzer.extractHighlights(projectId);

    return AIContext(
      systemPrompt: '''
你是 Appilot 的 AI 推广助手。以下是你要推广的软件项目的真实信息，所有推广内容必须基于这些信息生成。

## 产品信息
- 名称: ${repo.projectName}
- 一句话描述 (来自 README): ${repo.tagline}
- 技术栈: ${repo.techStack}
- 许可证: ${repo.license}

## 关键特性 (从代码中提取)
${highlights.map((h) => '- ${h.title}: ${h.description}').join('\n')}

## 最近更新
${repo.recentCommits.map((c) => '- ${c.date}: ${c.message}').join('\n')}

## 目标平台
Twitter/X — 280 字符限制，需包含 3–5 个 hashtags 和一个链接。
文案应精炼为一句话亮点 + 链接。语气: 专业但不生硬，接地气但有干货。
针对 ${repo.inferredAudience ?? '开发者'} 群体。

## 风格要求
- 每次推广内容应有所不同，避免重复
- 推广文案中自然融入项目链接
- 可参考以下特性作为本次推广重点（如果用户指定了 focusFeatures）:
${highlights.where((h) => h.isFocused).map((h) => '- ${h.title}').join('\n')}
''',
      repoSnapshot: repo,
      highlights: highlights,
    );
  }
}
```

> **Phase 0 简化要点**：仅组装单仓库的 README + 技术栈 + 最近提交 + 特性列表。不包含多仓库聚合、发布渠道识别、项目链接检测、README 完整性检查、跨仓库变更合并（Phase 1+ 扩展）。

用户无需手动填写产品描述、关键特性或品牌语气——AI 从代码仓库中自动提取。用户可在设置中补充偏好（如"强调开源/免费特性"、"避免夸张营销用语"），这些会合并到 System Prompt 中。Phase 1+ 的完整多仓库上下文组装流程见 §6.3 末尾（原设计中的 10 步组装流程保留，推迟实现）。

### 6.4 AI Engine 接口（仓库驱动）

```dart
class AIEngine {
  final AIConfig _config;
  final RepoContextBuilder _contextBuilder;
  final AIProvider _provider;

  // ── Phase 0 实现 ──

  /// 分析仓库后生成产品摘要（名称、一句话描述、技术栈、关键特性、受众定位）
  Future<ProductSummary> analyzeProduct(String projectId);

  /// 为 Twitter 平台生成推广文案（自动适配 280 字符限制、hashtags、链接）
  Future<GeneratedPost> generateTweet({
    required String projectId,
    required PromotionStage stage,     // launch / feature_update / tech_share / tutorial
    String? customPrompt,              // 用户额外指令（如"强调开源/免费特性"）
    List<FeatureHighlight>? focusFeatures, // 本次推广侧重哪些特性
  });

  // ── Phase 1+ 扩展 ──

  /// 根据代码变更频率、功能成熟度和受众特征，建议推广阶段与目标平台
  Future<PromotionPlan> generatePromotionPlan(String projectId, {
    List<PlatformTarget>? preferredPlatforms,
    String? focusArea,
  });

  /// 为指定平台生成推广文案（Phase 1+ 扩展为多平台适配）
  Future<GeneratedPost> generatePost({
    required String projectId,
    required PlatformTarget platform,
    required PromotionStage stage,
    String? customPrompt,
    List<FeatureHighlight>? focusFeatures,
  });

  /// 批量生成多平台文案
  Future<Map<PlatformTarget, GeneratedPost>> generateCrossPlatformPosts({...});

  /// 根据评论内容 + 仓库上下文生成个性化回复建议
  Future<GeneratedReply> generateReply({...});

  /// 推广时机建议
  Future<PostingSuggestion> suggestPostingTime({...});

  /// 跨仓库 README / 官网完善建议 → 生成 PR
  Future<List<PRSuggestion>> generateReadmePRs(String projectId);
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

> 📊 **AI 用量透明原则**：不限制用户的 API 调用量（预算控制在 API Provider 侧由用户自行管理），但 Appilot 会**实时追踪和展示每次调用的 token 消耗与预估费用**。设置页展示累计用量统计（本月总 token 数、预估总费用），每次 AI 操作完成后在 UI 中显示本次消耗（如"本次文案生成消耗 1,247 tokens，约 $0.02；本月累计 45,320 tokens，约 $0.68"），让用户清楚知道每笔推广的 AI 成本。

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

**背景**：当项目处于预热/预告阶段（`teaser` / `preLaunch`），仓库 README 可能缺少应用发布后才会有的信息（App Store 徽章、下载链接、功能截图等）。即使用户已在 Appilot 中确认了这些信息（发布渠道、项目链接），仓库中可能仍未更新。AI Engine 发现这种不一致后，自动生成 PR 建议。

```
工作流:
  1. Repo Analyzer.checkReadmeCompleteness()
     → 对比仓库 README/网站 vs Appilot 已知信息
     → 发现: README 中有 Google Play 徽章 ✅ 但没有 App Store 徽章 ❌
     → 而 Appilot 中用户已确认 App Store 为发布渠道

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
  📱 下载徽章缺失    — 用户在 Appilot 确认了某渠道但 README 无对应徽章
  🔗 社区链接缺失    — Discord/Twitter 在 Appilot 中有但 README 无
  📖 文档链接缺失    — docs 仓库已连接但主 README 未引用
  🖼 截图缺失        — 项目已发布但 README 无产品截图
  📋 功能特性过时    — git log 显示新增了功能但 README Feature List 未更新
  🌐 官网仓库不同步  — website 仓库中的下载页缺少 Appilot 中已知的某些发布渠道
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

### 7.0 Phase 0 最小 Schema（5 张表）

> Phase 0 仅创建以下 5 张表。完整 Schema（§7.1）中的 project_metrics、project_repos、pr_suggestions、accounts、interactions、content_templates、reminders 推迟到 Phase 1+。

```
projects                            posts
┌──────────────────────┐           ┌──────────────────┐
│ id (PK)              │           │ id (PK)          │
│ name                  │──┐        │ project_id (FK)  │──────────────┐
│ repo_url              │  │        │ platform          │  (仅 Twitter)│
│ repo_source           │  │        │ title             │              │
│  (仅 github_public)   │  │        │ body              │              │
│ status                │  │        │ platform_post_id  │              │
│  (pre_launch/launched/│  │        │ permalink         │  (用户回填)  │
│   maintenance)        │  │        │ publish_mode      │  (web_intent)│
│ ai_product_summary    │  │        │ status            │              │
│  (JSON, AI 生成缓存)  │  │        │ published_at      │              │
│ created_at            │  │        │ created_at        │              │
└──────────────────────┘  │        └──────────────────┘              │
                          │                                          │
                          │ 1:N (posts)                              │
                          ▼                                          │
                       post_analytics                                │
                       ┌──────────────────────┐                      │
                       │ id (PK)              │                      │
                       │ post_id (FK) ────────┼──────────────────────┘
                       │ platform             │
                       │ view_count           │
                       │ like_count           │
                       │ comment_count        │
                       │ share_count          │
                       │ source               │  (Phase 0: 始终 manual)
                       │ note                 │  (用户备注)
                       │ fetched_at           │
                       └──────────────────────┘

ai_config                           ai_actions
┌──────────────────┐               ┌──────────────────┐
│ id (PK)          │               │ id (PK)          │
│ provider_url     │               │ project_id (FK)  │
│ api_key          │  (存 SQLite， │ action_type      │
│ model_name       │   后续迁移到  │  analyze_product │
│ user_preferences │   Keychain)   │  / generate_post │
│  (JSON, 可选)    │               │ input_context    │
└──────────────────┘               │ output_content   │
                                   │ prompt_tokens    │
                                   │ completion_tokens│
                                   │ estimated_cost   │
                                   │ created_at       │
                                   └──────────────────┘
```

**Phase 0 Schema 设计要点：**
- `projects.repo_url` — Phase 0 仅支持单 GitHub 公开仓库 URL（如 `github.com/user/repo`）
- `projects.repo_source` — Phase 0 固定为 `github_public`（枚举预留 `github_private`、`local_path`，Phase 1+ 启用）
- `projects.ai_product_summary` — AI 分析后生成的产品摘要缓存（JSON 字段），增加 `ai_summary_generated_at` 字段标记缓存新鲜度
- `posts.platform` — Phase 0 固定为 `twitter`
- `posts.publish_mode` — Phase 0 固定为 `web_intent`（枚举预留 `api_auto`、`manual`，Phase 1+ 启用）
- `post_analytics.source` — Phase 0 固定为 `manual`（枚举预留 `api`、`url_backfill`，Phase 1+ 启用）
- `ai_config.api_key` — Phase 0 暂存 SQLite 明文（后续 Phase 1 迁移到系统 Keychain）
- 凭据不入库原则推迟到 Phase 1（Phase 0 无 OAuth Token 需要管理）

### 7.1 完整 Schema（Phase 5 完成后）

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
project_metrics (时序数据，每项目每天一条)
┌──────────────────────┐
│ id (PK)              │
│ project_id (FK)      │──────────────┐
│ date                 │  日期 (YYYY-MM-DD) │
│ download_count       │  当日下载量 (手动登记或 API 自动拉取) │
│ revenue              │  当日收入, USD (手动登记，未来自动) │
│ dev_cost             │  当日开发成本, USD (手动登记) │
│ ai_cost              │  当日 AI 费用, USD (自动从 ai_actions 聚合) │
│ source               │  manual / app_store_connect / google_play_console
│ note                 │  备注
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
│ prompt_tokens    │  (本次调用消耗的 prompt tokens) │
│ completion_tokens│  (本次调用消耗的 completion tokens) │
│ estimated_cost   │  (本次调用的预估费用，USD) │
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
- **pr_suggestions 是 AI → 仓库的闭环** — AI 跨仓库分析后，发现 README/官网缺少 Appilot 已知的信息（如用户已在 Appilot 确认了 App Store 链接但 README 中没有对应徽章），自动生成改进建议（`diff_content`）。用户确认后可直接创建 PR（若仓库在 GitHub 上且有写入权限），或复制建议内容手动更新。这是"代码即真相"的逆向应用：Appilot 中的项目信息反向推动仓库文档的完善
- **ai_actions 持久化 AI 用量** — 每次 AI 调用记录 `prompt_tokens`、`completion_tokens`、`estimated_cost`，支持按项目/按月的费用统计和历史查询。设置页展示"本月累计 tokens / 费用"即从该表聚合计算
- **project_metrics 是运营中心的基石** — 每项目每天一条记录，追踪下载量（手动登记或 App Store Connect API 自动拉取）、收入（手动登记，未来可接入 App Store / Google Play 后台 API）、AI 成本（自动从 `ai_actions` 聚合）、开发成本（手动登记）。运营总览中的"投入产出分析"即基于此表
- **凭据不入库** — `accounts` 表只存 `token_ref`（Keychain 引用键），实际 Token/OAuth 凭据在系统安全存储中；`projects.repo_token_ref` 同理
- **ai_config 不再存储产品描述** — `product_desc`、`target_audience`、`brand_voice`、`key_features` 等字段已移除。这些信息由 Repo Analyzer 从代码仓库中自动提取并通过 AI Context Builder 组装。`user_preferences`（JSON）仅存储用户额外补充的偏好（如"强调开源免费"、"禁用词列表"）
- **interactions 与 posts 关联** — 通过 `post_id` 外键，支持"按帖子查看所有互动"
- **post_analytics 是可追加时序** — 同一 `post_id` 可有多条记录（不同时间点的快照），`fetched_at` 标记采样时间
- **content_templates 存复用文案** — AI 生成且用户确认过的高质量文案可保存为模板，`platforms` 用 JSON 标记适用平台
- **posts.publish_mode** — 记录该帖子是 `api_auto`（引擎自动发布）还是 `web_intent` / `manual`（用户手动完成），手动模式下 `platform_post_id`/`permalink` 由用户回填，其余字段照常记录
- **post_analytics.source** — 标记该条统计快照来自 `api`（自动拉取）、`url_backfill`（URL 回填自动提取）还是 `manual`（用户手动填报降级），三者混存同一张表，图表按最新快照展示，不区分来源，但导出/审计时可追溯
- **新增 reminders 表** — `id / post_id (FK) / remind_at / message / dismissed`，供手动模式下"到期提醒去看看反馈"任务使用，详见 [第 17 节](#17-手动发布与分级追踪能力模型-2026-07-14)

---

