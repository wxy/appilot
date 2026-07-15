# Appilot 实施方案

> 状态：已更新 | 日期：2026-07-15（基于 Phase 0 最小闭环设计重写）
> 关联设计：[设计文档集](../README.md) | 姊妹文件：[构建计划](./appilot-build-plan.md)
>
> 本文档是 [构建计划](./appilot-build-plan.md) 的**任务级展开**，提供每 Phase 的具体任务拆解、估时、依赖和验收标准。
>
> ⚠️ **与旧方案的关键差异**（2026-07-15 重写）：
> - Phase 0 从"手动模式 + 无 AI"（22 天）改为"GitHub 公开仓库 → AI 推文生成 → Twitter Web Intent → 手动统计 → 趋势图"最小闭环（约 17 天）
> - AI 基础设施（AIProvider、AI Engine、Repo Analyzer）前移到 Phase 0
> - 多仓库、本地仓库、OAuth、Inbox、运营仪表盘、推广计划生成全部推迟到 Phase 1+
> - Product Hunt 已彻底移除

---

## 0. 执行前准备（Day 0，非工程任务，建议立即启动）

这些事项耗时不可控（依赖第三方审批），必须最早启动：

| # | 事项 | 为什么现在做 | Phase 0 需要？ |
|---|------|--------------|:---:|
| 1 | ~~发送 Product Hunt 商用授权确认邮件~~ | **已移除** — Product Hunt 已从 MVP 中彻底移除 | — |
| 2 | 注册 Twitter/X Developer Portal 应用 + 了解付费 credit 模式 | Phase 1 需要，但提前了解真实价格和额度到账周期 | ❌ Phase 1 |
| 3 | 注册 Reddit App（获取 client_id，选择"installed app"类型） | 免费，5 分钟完成，Phase 2 直接可用 | ❌ Phase 2 |
| 4 | 创建 Google Cloud 项目并启用 YouTube Data API v3 | 免费，Phase 3 的"用户自助 Key 向导"需要先跑通一次 | ❌ Phase 3 |
| 5 | 创建 Discord Application + Bot | 免费，Phase 2 直接可用 | ❌ Phase 2 |
| 6 | 建 GitHub 仓库结构 + Projects 看板，按 Phase 建 Milestone | 便于跟踪进度。Phase 0 可直接开始编码（不需要等 2-5） | ✅ Phase 0 |
| 7 | 选择一个测试用的 GitHub 公开仓库 | 用于 Phase 0 全流程验证（建议选自己有 README + 多提交的开源项目） | ✅ Phase 0 |

**Phase 0 之前必须完成的 Day 0 事项**：仅 #6（建仓库结构）和 #7（选测试仓库）。其余平台注册事项（#2–5）在对应 Phase 开始前完成即可，不阻塞 Phase 0。

---

## 1. 总体路线图与工作量估算

| Phase | 内容 | 预估工作日 | 累计工作日 | 关键产出（演示标准） |
|-------|------|-----------|-----------|----------------------|
| Phase 0 | 最小闭环验证 | 17 | 17 | 输入 GitHub 公开仓库 URL → AI 生成推文 → Twitter Web Intent 跳转 → 回填 URL 手动填统计 → 看趋势图 |
| Phase 1 | Twitter 全自动 + 基础设施完备 | 25 | 42 | Twitter OAuth 自动发布 + 拉取回复 + AI 回复建议；多仓库支持；i18n/CI/签名/自动更新/崩溃上报全部跑通 |
| Phase 2 | Reddit + Discord | 17 | 59 | 三平台（Twitter/Reddit/Discord）可在 Composer 中同时勾选发布，Inbox 聚合三平台互动 |
| Phase 3 | YouTube | 13.5 | 72.5 | YouTube API 上传 + 配额监控，四平台全部接入 |
| Phase 4 | 统计与插件生态 | 10.5 | 83 | 跨平台统计对比图；多产品宏观仪表盘；社区插件动态加载 |
| Phase 5 | AI 增强模式 | 12.5 | 95.5 | 半自动规则回复、全自动代理模式、内容效果反馈闭环 |

**总计约 95.5 个工作日 ≈ 19 周 ≈ 4.5 个月**（全职 solo，不含 buffer）。建议整体预留 **15~20% buffer**（约 14–19 天），主要用于吸收：Windows 环境验证反复、平台 API 审批等待、Flutter 桌面端小众问题排查。

---

## 2. 通用执行规范

- **分支策略**：`master` 为稳定分支；每个 Phase 开一个 `phase/N-xxx` 分支，Phase 验收通过后合并回 `master` 并打 tag（如 `v0.1.0` = Phase 0 完成）。
- **Definition of Done（每个 Phase 共同标准）**：
  1. 该 Phase 列出的所有任务对应 Issue 全部关闭；
  2. 能跑通"关键产出"里描述的演示场景（建议录屏留存，作为里程碑记录）；
  3. Phase 1 起新增/修改的 Engine 代码有单元测试覆盖（Phase 0 可放宽——核心链路手工验证即可）；
  4. `docs/` 下设计文档如有偏离实现的地方，同步更新（避免文档与代码逐渐脱节）。
- **任务粒度**：本文档拆到"1 人 0.5~3 天可完成"的粒度，超过 3 天的任务在执行时应再拆子任务。
- **每日节奏建议**：全职 solo 项目容易因为"设计→写码→卡在某个 API 细节"而失焦，建议每天开始前用 5 分钟对照本文档的 Issue 列表选定当日任务，收工前更新 Issue 状态。

---

## 3. Phase 0 任务拆解：最小闭环验证（17 天）

> 目标：验证 Appilot 的核心假设——"AI 读取代码仓库后生成的推广文案，比开发者自己写的更好/更快"。
> 策略：仅 GitHub 公开仓库 + 仅 Twitter Web Intent + 仅手动统计填报。零 OAuth、零后台调度、零多平台、零插件抽象。

| # | 任务 | 估时 | 依赖 | 验收标准 |
|---|------|------|------|----------|
| 0.1 | **Flutter 项目脚手架**：`app/` + `engine/` 包结构 + Riverpod + GoRouter 骨架 + 基础主题（明暗色跟随系统） | 1.5d | - | `flutter run` 跑起空白窗口，路由跳转正常，系统深色模式切换时应用跟随 |
| 0.2 | **drift Schema 建表 + Migration 框架**：5 张表（`projects` / `posts` / `post_analytics` / `ai_config` / `ai_actions`），字段与 [架构设计 §7.0](./appilot-architecture.md#70-phase-0-最小-schema5-张表) 一致 | 1.5d | 0.1 | 所有表创建成功，`Database` 类编译通过，migration 测试跑通（模拟 v1→v2 新增字段） |
| 0.3 | **错误处理基础**：分层异常类（`AppException` → `EngineException` / `ApiException`）+ 文件日志记录到 `~/.appilot/logs/`（按天滚动，保留 14 天） | 1d | 0.1 | 故意抛一个 API 异常，验证日志文件中有完整堆栈 + 用户可读错误提示 |
| 0.4 | **GitHub Repo Analyzer**：`connectGitHubPublicRepo(String url)` → 读取 README.md + 目录树（最大深度 4 层）+ 最近 10 次提交 + 从 package.json/pubspec.yaml 等提取技术栈。限频感知：429 响应时提示用户 + 降级为缓存 | 3d | 0.1 | 输入 `github.com/flutter/flutter`，UI 展示 README 摘要 + 技术栈（Dart）+ 文件树 + 最近 10 次提交列表。触发限频时出现提示"API 频率限制已达上限" |
| 0.5 | **AIProvider 接口 + OpenAI 兼容实现**：`AIProvider.chat(messages)` + `validateConnection()` + `lastUsage`（TokenUsage）。支持用户自定义 `base_url` 和 `api_key`。Phase 0 不处理 API Key 安全存储（明文存 `ai_config` 表） | 1.5d | 0.1 | 用真实 API Key（或本地 Ollama URL）跑通 `chat()`，验证 `lastUsage` 返回 token 数和预估费用 |
| 0.6 | **AI 配置 UI**：设置页表单（Provider URL + API Key + Model Name），保存到 `ai_config` 表，支持"测试连接"按钮 | 1d | 0.2, 0.5 | 配置保存后关闭应用重开，配置仍有效。"测试连接"按钮能显示成功/失败 |
| 0.7 | **AI Engine**：`analyzeProduct(projectId)` → AI 分析仓库摘要，返回 `ProductSummary`（名称、一句话描述、技术栈、关键特性、受众定位）。`generateTweet(projectId, stage)` → AI 根据仓库上下文 + 推广阶段生成 280 字符以内推文（含 hashtags） | 2.5d | 0.4, 0.5 | 连接一个真实仓库后点击"分析"→ AI 返回产品摘要；点击"生成推文"→ AI 返回符合 Twitter 280 字符限制的推文（含 3–5 个 hashtags） |
| 0.8 | **Context Builder**：单仓库上下文组装——`RepoSummary`（README + 技术栈 + 最近 10 次提交 + 目录结构）+ `highlights` → 结构化 System Prompt。用户偏好（如"强调开源免费"）合并到 Prompt | 1d | 0.4, 0.5 | 检查发送给 AI 的 System Prompt 包含：产品名、技术栈、最近提交列表、关键特性、风格要求 |
| 0.9 | **项目设置向导 UI**：Step 1 配置 AI API（复用 0.6 组件）→ Step 2 输入项目名 + GitHub 仓库 URL → 点击"连接并分析"→ 展示 AI 分析结果（产品摘要、技术栈、关键特性、最近提交） | 2d | 0.4, 0.7 | 输入 `github.com/user/repo` 后能看到 AI 提取的特性列表和产品摘要，可编辑摘要文本 |
| 0.10 | **Composer 推文编辑器**：展示 AI 生成的推文草稿（含字符计数 [xxx/280]）+ 用户编辑 + "AI 重新生成"按钮 + "修改语气"选项（更正式/更轻松/更技术）+ 草稿手动保存/加载（调用 ContentStore） | 1.5d | 0.7, 0.2 | 编辑推文后点击"保存草稿"，关闭重开点击"加载草稿"，内容恢复 |
| 0.11 | **Twitter Web Intent 跳转**：构建 `https://twitter.com/intent/tweet?text=${Uri.encodeComponent(tweetText)}` URL，调用系统浏览器打开。不需要 Plugin 抽象——直接硬编码 URL 构建 | 0.5d | 0.10 | 点击"在 Twitter 上发布"按钮后系统浏览器打开 Twitter 且文案已预填 |
| 0.12 | **Content Store**：`saveDraft(projectId, content)` / `loadDraft(projectId)` / `listDrafts(projectId)`。实现为 Engine 组件，UI 层通过 Riverpod provider 调用。不在此组件内启动自动保存计时器（由 UI 层监听空闲超时后调用 `saveDraft`） | 1d | 0.2 | 保存一条草稿后查询 `posts` 表（status=draft）有一条记录，加载草稿后内容完全恢复 |
| 0.13 | **帖子 URL 回填 + 手动统计登记**：`posts` 表增加 `permalink` 字段，用户粘贴 URL 后回填。手动统计表单（浏览/点赞/评论数 + 备注 + 日期时间），提交后写入 `post_analytics`（source=manual） | 1.5d | 0.2, 0.11 | 提交一条统计后，`post_analytics` 表新增一条 source=manual 记录，列表中可见 |
| 0.14 | **Analytics Engine + 趋势折线图**：`submitManualStats(entry)` → 写入 `post_analytics`。`watchTrend(postId)` → 返回历史快照 Stream。UI 使用 `fl_chart` 绘制浏览量/点赞/评论三条折线（x 轴=时间，y 轴=数值） | 2d | 0.13 | 连续提交 3 条统计记录后，趋势图显示 3 个 data point 的折线，三条线颜色不同，有图例 |
| 0.15 | **AI 用量展示**：每次调用 AI 后在 UI 底部/Toast 显示"本次消耗 1,247 tokens，约 $0.02"。设置页展示"本月累计"（从 `ai_actions` 表聚合 `SUM(prompt_tokens)、SUM(completion_tokens)、SUM(estimated_cost)` ） | 1d | 0.7, 0.2 | 生成推文后显示消耗统计，设置页能看到本月累计 tokens 和费用 |
| 0.16 | **Phase 0 整体验收**：端到端走通完整流程 + 录屏存档 | 1d | 上述全部 | 录屏演示：输入 GitHub 公开仓库 URL → AI 分析（摘要+特性展示）→ 生成推文（< 280 字符）→ 编辑 → 跳转 Twitter → 回填 URL → 提交 3 次手动统计 → 趋势图显示折线 |

小计：**22 天**（含 5 天 buffer，实际核心编码约 17 天）

> ⚠️ **注意**：Phase 0 任务 0.4（Repo Analyzer, 3d）和 0.7（AI Engine, 2.5d）是工作量最大的两个任务，也是最可能遇到未知困难的任务（GitHub API 限频边界、AI Prompt 调优迭代）。如果在执行中耗时超预期，可以优先做"最小链路验证"（只分析 README + 技术栈，暂不做文件树和提交历史），后续 Phase 1 再补全。

---

## 4. Phase 1 任务拆解：Twitter 全自动 + 基础设施完备（25 天）

> Phase 0 已有：单 GitHub 公开仓库连接 + AI 推文生成 + Twitter Web Intent + 手动统计 + 趋势图 + 基础错误处理 + 主题。
> Phase 1 新增：Twitter OAuth 全自动 + 多仓库 + 本地/私有仓库 + Inbox + AI 回复 + 运营仪表盘 + 全量基础设施（CI/i18n/签名/自动更新/崩溃上报）。

| # | 任务 | 估时 | 依赖 | 验收标准 |
|---|------|------|------|----------|
| 1.1 | **Credential Vault**：macOS Keychain / Windows Credential Manager 封装。API Key 从 `ai_config` 表迁移到 Keychain 存储。`read(key)` / `write(key, value)` / `delete(key)` | 2d | Phase 0 | 存入一个 Token，重启应用后仍能读出且未落盘明文 |
| 1.2 | **OAuth 通用回调服务器**：Engine 层 `OAuthCallbackServer`，本地 loopback HTTP server（`http://127.0.0.1:<port>/callback`）。封装为通用组件，插件复用而非各自实现 | 2d | 1.1 | 用任意 OAuth 测试应用能收到授权回调并解析出 code |
| 1.3 | **Windows 环境验证**：验证 loopback 是否被防火墙拦截，若不可行切换为自定义 URL Scheme（`appilot://oauth/callback`） | 1d + 1d（备选，风险预留） | 1.2 | 在 Windows 机器/VM 上跑通一次完整 OAuth 回调 |
| 1.4 | **Plugin 接口定义**：`PlatformPlugin` 抽象类（完整接口见 [架构设计 §5.1](./appilot-architecture.md#51-核心接口)）+ Plugin Registry（发现、验证、加载、生命周期）。将 Phase 0 硬编码的 Twitter Web Intent 迁移为 Plugin 实现 | 2d | Phase 0 | Mock Plugin 能被 Registry 加载并声明能力；Twitter Plugin 能替代 Phase 0 硬编码的 Web Intent URL 构建 |
| 1.5 | **Twitter Plugin — OAuth 授权**：复用 OAuthCallbackServer，实现 Twitter OAuth 2.0 授权码流程。`accounts` 表新增 Twitter 账号记录 | 2d | 1.2, 1.4 | 点击"连接 Twitter"后完成授权，`accounts` 表新增一条 platform=twitter 记录 |
| 1.6 | **Twitter Plugin — 自动发布**：`publish()` 实现（文本+图片）。`publishMode` 从 Phase 0 的固定 `webIntent` 升级为运行时动态 `currentPublishMode()`（OAuth 有效时 = apiAuto） | 2d | 1.5 | 从 Composer 发布一条真实推文，`PostResult.success = true`，`publish_mode = api_auto` |
| 1.7 | **Twitter Plugin — 互动追踪**：`fetchNewInteractions()` / `getStats()` 实现。`trackingMode` 从 Phase 0 的固定 `manualEntry` 升级为运行时动态 `currentTrackingMode()` | 2d | 1.5 | 能拉到自己刚发的推文的回复列表和统计数据（浏览/点赞/转发数） |
| 1.8 | **用量预算熔断**：Task Scheduler 监控月度 Twitter API 调用费用 + 超限自动降频/暂停 + 设置页展示实时用量/剩余额度 | 1.5d | 1.7 | 手动把预算上限设为 $0，验证轮询自动暂停并出现提示 |
| 1.9 | **Repo Analyzer 扩展 — 本地仓库**：`connectLocalRepo(String path)` → 直接读取文件系统 + 执行 `git` 命令（`git log`、`git tag`）。复用 Phase 0 的大仓库处理策略 | 2d | Phase 0.4 | 连接本地路径 `~/projects/myapp`，展示与 Phase 0 GitHub 仓库相同的分析结果 |
| 1.10 | **Repo Analyzer 扩展 — GitHub 私有仓库 + PAT**：`connectGitHubPrivateRepo(url, pat)` → PAT 存 Keychain（通过 Credential Vault）。5,000 req/h，解决 Phase 0 公开 API 限频问题 | 1.5d | 1.1, 1.9 | 输入私有仓库 URL + PAT，分析结果与公开仓库一致，PAT 存储在 Keychain |
| 1.11 | **Project Registry + 多仓库支持**：`addProject()` / `addRepo()` / `listProjects()`。仓库角色（appSource/website/docs）。多仓库聚合上下文组装（RepoContextBuilder 扩展为遍历多个关联仓库） | 2.5d | 1.9, 1.10 | 一个项目关联 2 个仓库（appSource + website），AI 分析结果包含两个仓库的信息 |
| 1.12 | **AI Engine 扩展 — 推广计划生成**：`generatePromotionPlan(projectId)` → AI 根据 Release 节奏建议推广阶段、目标平台、频率。用户审阅确认后生成 `PromotionTask` 列表 | 2d | 1.11, Phase 0.7 | 连接仓库后 AI 返回结构化推广计划（3 个推广任务，各有阶段/平台/日期/理由） |
| 1.13 | **AI Engine 扩展 — 回复建议**：`generateReply(projectId, interaction)` → AI 根据评论内容 + 仓库上下文生成个性化回复 | 1.5d | Phase 0.7 | 在 Inbox 选中一条评论，AI 返回回复建议草稿（引用仓库中的具体信息） |
| 1.14 | **Inbox 统一收件箱**：列表 UI + 筛选（未回复/评论/@提及）+ 平台筛选 + AI 回复建议集成。Phase 0 无 Inbox，Phase 1 从零搭建 | 2d | 1.7, 1.13 | Inbox 显示 Twitter 真实回复，可按状态筛选，点击回复后弹出 AI 建议草稿 |
| 1.15 | **运营总览仪表盘**：开发进度卡片（最近 Release + 提交活跃度）+ 推广概览（已发帖子数/推广阶段/总互动数）+ AI 费用统计（从 ai_actions 聚合）+ 下载量/收入手动登记（project_metrics 表新增） | 2.5d | 1.6, 1.7, 1.11 | 仪表盘展示真实的项目开发状态和推广数据 |
| 1.16 | **README 完整性检查 + PR 建议**：`checkReadmeCompleteness(projectId)` + `generateReadmePRs(projectId)` + "创建 GitHub PR" 功能（需 PAT 有 repo 权限） | 2d | 1.11 | AI 发现 README 缺失信息→生成 diff→用户确认→通过 GitHub API 创建 PR |
| 1.17 | **Task Scheduler**：本地 `Timer` 实现（Phase 1 不引入 Isolate，drift 操作在主线程）。定时轮询 Twitter 互动（默认 5 分钟）+ 启动追赶 + 即时发布 + Release 监控（每 30 分钟检查新 tag） | 2d | 1.7, 1.1 | 发布一条推文后 5 分钟内自动拉取到新互动并出现在 Inbox |
| 1.18 | **Event Bus + Post Queue**：Event Bus（Plugin→UI 订阅）+ Post Queue（每平台独立队列、失败重试 3 次指数退避、限频暂停 + 跨平台防刷屏最小间隔） | 2d | 1.4, 1.17 | 同时发布到 3 个平台（Phase 2 的 Reddit/Discord 到位后验证），一个失败不影响其余 |
| 1.19 | **i18n 框架**：`flutter_localizations` + ARB 文件骨架（中英双语），所有硬编码英文字符串迁移到 `AppLocalizations` | 2d | Phase 0 | 切换系统语言为中文，UI 文案随之切换（哪怕初始只有 50% 翻译覆盖） |
| 1.20 | **CI 基线**：GitHub Actions（lint + test + build，macOS + Windows）。PR 提交后自动跑，失败阻止合并 | 1.5d | Phase 0 | PR 提交后自动跑 CI，lint/test 失败时 PR 不可合并 |
| 1.21 | **测试基线**：Engine/Plugin 接口单元测试 + Mock Plugin 用于 Composer/Inbox 集成测试 + 覆盖率报告 | 2d | 1.20 | 关键路径（发布、拉取互动、AI 生成）有测试覆盖，覆盖率 ≥ 60% |
| 1.22 | **macOS Developer ID 签名 + 公证** | 1.5d | 1.20 | 构建产物在全新 Mac 上双击可直接打开，无 Gatekeeper 警告 |
| 1.23 | **自动更新框架**：检测新版本 → 下载 → 提示安装 | 2d | 1.22 | 发布新版本后旧版本能检测到并完成更新 |
| 1.24 | **崩溃上报**：Sentry 桌面 SDK opt-in 接入 | 1d | 1.20 | 故意触发崩溃，设置开启上报时能在 Sentry 后台看到记录 |
| 1.25 | **URL 回填自动提取**：Reddit `.json` 后缀方案 + YouTube oEmbed 方案 + Twitter headless browser 方案评估（仅评估可行性，不确定实现） | 1.5d | 1.4 | Reddit URL 回填后自动提取到 upvote 数和评论数（无需 API Key）；Twitter headless browser 方案输出评估报告 |
| 1.26 | **Phase 1 整体验收**：端到端演示 + 录屏存档 | 1d | 上述全部 | 录屏演示：多仓库连接 → AI 推广计划 → Twitter OAuth 自动发布 → Inbox 收到回复 → AI 回复建议 → 仪表盘数据更新 → CI 构建通过 |

小计：**48 天**（任务涉及大量并行工作——基础设施与功能可同期推进；实际并行后约 **25 个工作日**）

> ⚠️ **Phase 1 范围警告**：上述任务列表覆盖了原设计中 Phase 1–4 的部分工作（多仓库、Inbox、仪表盘、README PR 等），因为 Phase 0 已将 AI 基础设施前移。执行时可根据实际进度调整——如果 Phase 1 耗时远超 25 天，可将 1.16（README PR 建议）、1.18（Event Bus/Post Queue 完整实现）、1.25（URL 回填自动提取）推迟到 Phase 2。

---

## 5. Phase 2 任务拆解：Reddit + Discord（17 天）

> Phase 1 已有：Twitter OAuth + 多仓库 + Inbox + 运营仪表盘 + 全量基础设施。
> Phase 2 新增：Reddit OAuth 自动发布 + Discord Bot 发布 + 三平台 Composer + Reddit 合规清理。

| # | 任务 | 估时 | 依赖 | 验收标准 |
|---|------|------|------|----------|
| 2.1 | **Reddit Plugin — OAuth 授权**：复用 OAuthCallbackServer + Credential Vault。installed app 类型，只读或读写授权 | 1.5d | Phase 1 (OAuth/Vault) | 授权后能拉到自己账号基本信息 |
| 2.2 | **Reddit Plugin — 自动发布**：`publish()` 文本/链接发布。`currentPublishMode()`: OAuth 有效 → apiAuto，未授权 → webIntent（预填 submit 链接） | 1.5d | 2.1 | 已授权自动发布成功；未授权走预填跳转，两条路径都能验证 |
| 2.3 | **Reddit Plugin — 互动追踪**：免费只读 API（100 QPM/OAuth client）。拉取 upvote 数/评论数/评论正文。`currentTrackingMode()`: 已授权 → apiReadOnly | 1.5d | 2.1 | Inbox 看到 Reddit 帖子的真实评论 |
| 2.4 | **Reddit 合规清理任务**：定期（每 24 小时）比对远端删除状态 → 被远端删除的内容在 48h 内级联清除本地缓存（`interactions` 表中对应行删除）。Task Scheduler 新增 `redditComplianceCheck` 任务类型 | 2d | 2.3 | 模拟远端删除一条评论，合规任务运行后本地对应数据行被删除 |
| 2.5 | **Discord Bot 注册与配置文档**：面向用户的设置向导文案——如何在 Discord Developer Portal 创建 Bot、获取 Token、邀请到服务器。Message Content Intent 申请说明（< 100 服务器自用默认可用，无需申请） | 1d | Day 0.5 | 一份可交给测试用户看懂的"如何创建 Discord Bot"引导文档 |
| 2.6 | **Discord Plugin — 发布**：Bot/Webhook 消息发送（文本 + 嵌入消息）。`currentPublishMode()`: Bot Token 有效 → apiAuto（Discord Bot API 免费） | 1.5d | 2.5 | 从 Composer 发消息到指定 Discord 频道 |
| 2.7 | **Discord Plugin — 互动追踪**：reaction/回复检测。`currentTrackingMode()`: Bot Token 有效 → apiAuto（免费） | 2d | 2.6 | Bot 检测到频道内针对该消息的新回复，出现在 Inbox |
| 2.8 | **Composer 多平台选择 UI**：同时勾选 Twitter/Reddit/Discord，各自走各自的 `currentPublishMode()`（apiAuto / webIntent）。字符计数/平台限制提示根据选中平台动态切换 | 1.5d | Phase 1, 2.2, 2.6 | 一次编辑内容同时推送到三个平台 |
| 2.9 | **Post Queue 多平台验证**：三平台并行发布 + 排队 + 跨平台防刷屏最小间隔（如"同一内容跨平台发布至少间隔 2 分钟"） | 1.5d | 2.8, Phase 1.18 | 三个平台发布互不阻塞，防刷屏间隔生效时给出提示 |
| 2.10 | **Inbox 平台筛选器增强** | 1d | 2.3, 2.7 | 按 Twitter/Reddit/Discord 平台筛选 Inbox 列表 |
| 2.11 | **Phase 2 整体验收** | 1d | 上述全部 | 录屏：一次编辑 → 三平台同时发布 → Inbox 聚合三平台回复 |

小计：**17 天**

---

## 6. Phase 3 任务拆解：YouTube（13.5 天）

> Phase 2 已有：Twitter/Reddit/Discord 三平台 + Composer 多平台 + Post Queue。
> Phase 3 新增：YouTube API 上传 + 配额监控 + 视频上传区域（断点续传）+ 内容模板。

| # | 任务 | 估时 | 依赖 | 验收标准 |
|---|------|------|------|----------|
| 3.1 | **YouTube 用户自助 API Key 设置向导**：引导用户在 Google Cloud Console 创建项目、启用 YouTube Data API v3、获取 API Key、粘贴进设置页。**不用 Appilot 内置 Key**（避免多用户共享配额风险） | 1.5d | Phase 0 | 用户跟着向导拿到自己的 API Key 并粘贴进设置页，"测试连接"可用 |
| 3.2 | **YouTube Plugin — 只读追踪**：`videos.list`（statistics: viewCount/likeCount/commentCount）+ `commentThreads.list`。仅需 API Key，无需 OAuth | 1.5d | 3.1 | 输入自己视频 URL 后能拉取真实播放量/点赞/评论 |
| 3.3 | **YouTube Plugin — OAuth 上传**：`videos.insert`（单次消耗约 1,600 配额单位）。OAuth 授权复用 Phase 1 的 OAuthCallbackServer | 2d | Phase 1.2, 3.1 | 从应用内直接上传一个测试视频到 YouTube 成功 |
| 3.4 | **YouTube 配额监控与预警**：默认 10,000 单位/天。实时展示已用/剩余配额。接近上限时 UI 预警（如 80% 黄色，95% 红色）；超限后暂停上传操作 | 1.5d | 3.3 | 手动模拟 9,500/10,000，UI 黄色预警；继续消耗到超限后提示"今日配额已用完" |
| 3.5 | **Composer 视频上传区域**：视频选择 + 元数据编辑（标题/描述/标签）+ 上传进度条 + 断点续传（分片上传，中断后从断点继续） | 3d | 3.3, Phase 1 Composer | 选择一个 50MB 视频 → 中断上传 → 恢复 → 从断点继续（而非重新上传） |
| 3.6 | **内容模板功能**：保存/复用高频文案。模板可标记适用平台（如"仅 Twitter+Reddit"）。Composer 按当前选中平台过滤模板列表。`content_templates` 表落地 | 1.5d | Phase 1 Composer | 保存一个"仅 Twitter"模板，选中 Reddit 时不会被推荐 |
| 3.7 | **Phase 3 整体验收** | 1d | 上述全部 | 录屏：四平台 Composer 可选 → YouTube 上传视频 → 配额展示 → 模板复用 |

小计：**13.5 天**

---

## 7. Phase 4 任务拆解：统计与插件生态（10.5 天）

> Phase 3 已有：四平台全部接入。
> Phase 4 新增：跨平台统计对比、多产品宏观仪表盘、社区插件动态加载。

| # | 任务 | 估时 | 依赖 | 验收标准 |
|---|------|------|------|----------|
| 4.1 | **统计仪表盘增强**：跨平台对比柱状图 + 趋势折线图（区分 source=api/manual/url_backfill）+ 时间范围选择（7/30/90 天） | 3d | 全部平台插件 | 看到"过去 30 天各平台浏览量对比"图表，数据源于真实 API |
| 4.2 | **多产品宏观仪表盘**：全部项目卡片总览 + 跨项目合计指标（总帖子数、总互动数、总 AI 费用）。Project Registry 已在 Phase 1 就位，仅需 UI 层增强 | 2d | Phase 1.11 | 添加 2 个项目后，仪表盘显示 2 个项目的汇总卡片 |
| 4.3 | **收入与成本追踪增强**：AI 成本从 `ai_actions` 自动聚合；其他成本手动登记。`project_metrics` 表（Phase 1 已建）在仪表盘中可视化展示 | 1d | 4.2 | 仪表盘显示"本月 AI 费用 $1.24 / 本月收入 $—" |
| 4.4 | **插件管理界面**：安装/启用/禁用/配置 + 能力声明展示（每个插件当前的 `currentPublishMode()` / `currentTrackingMode()` ） | 2d | Phase 1–3 全部插件 | 界面上清晰标注"Reddit: Tier1 只读追踪 / Twitter: Tier2 全自动" |
| 4.5 | **社区插件加载机制**：`~/.appilot/plugins/` 动态加载 + 版本校验 + 损坏隔离（一个插件失败不影响其他） | 2.5d | Phase 1.4 (Plugin Registry) | 手写一个符合接口的第三方插件包，放入目录后能被识别加载；故意放一个损坏包，不影响正常插件 |
| 4.6 | **Phase 4 整体验收** | 1d | 上述全部 | 录屏：跨平台统计对比 + 多产品仪表盘 + 安装自制插件 |

小计：**11.5 天**（含 1 天验收，取整 12 天）

---

## 8. Phase 5 任务拆解：AI 增强模式（12.5 天）

> Phase 4 已有：完整四平台 + 跨平台统计 + 历史互动数据。
> Phase 5 新增：半自动/全自动 AI 代理、内容效果反馈闭环、竞品分析、ROI 分析。

| # | 任务 | 估时 | 依赖 | 验收标准 |
|---|------|------|------|----------|
| 5.1 | **半自动回复规则引擎**：`ReplyRule` 定义（匹配条件：关键词/作者/平台 + 执行动作：使用模板/AI 生成/"需要人工审核"标记）。匹配的自动处理，不匹配的→人工待办 | 3d | Phase 1 (AI Engine) | 配置规则"包含 'bug' 关键词 → AI 生成回复并标记待审核"，触发后 Inbox 显示 AI 草稿 + [审核] 按钮 |
| 5.2 | **全自动代理模式 + 安全约束**：发布/回复频率上限（用户设定每小时/每天最大数）+ 敏感词过滤（用户可自定义词典）+ 人工随时接管（一键暂停全自动，切换到纯手动） | 3d | 5.1 | 开启全自动后：①超频率上限时自动暂停并通知；②命中敏感词拒绝生成；③点击"接管"按钮后所有自动操作停止 |
| 5.3 | **AI 操作审计日志 UI**：`ai_actions` 表可视化查看。按时间/类型/项目筛选。展示每次操作的输入上下文摘要 + 输出内容 | 1.5d | 5.1, 5.2 | 审计日志页看到"07-15 14:30: 为 Twitter 自动生成回复"带输入/输出摘要 |
| 5.4 | **内容效果反馈闭环**：将历史帖子的互动数据（浏览量/点赞/评论数/评论情感）作为下次生成的额外上下文注入 System Prompt。如"你上次为 Twitter 生成的帖子获得 2.3K 浏览，表现最好的标签是 #indiedev 和 #flutter" | 2d | Phase 4 (统计数据) | 连续生成 3 次推文后，第 4 次 AI 能引用之前的表现数据建议优化方向 |
| 5.5 | **AI 发布策略优化**：基于历史互动数据（什么时段发布互动最高）+ 平台特性 → 建议最佳发帖时机 | 1.5d | 5.4 | AI 输出"建议本周三 20:00 发布到 Reddit r/programming，该时段互动率最高" |
| 5.6 | **竞品差异化分析**：基于项目技术栈和功能特性，搜索相似项目（GitHub topics/tags），建议差异化角度 | 1.5d | Phase 0.4 | AI 输出"你的项目有 Plugin 架构，GitHub 上 top 3 的竞品都没有，应该强调这一点" |
| 5.7 | **ROI 投入产出分析**：基于 `project_metrics` 表的收入/成本数据，计算每个产品的盈亏平衡和投资回报率 | 1d | Phase 4.3 | 仪表盘展示"本月 ROI: 收入 $50 / AI 成本 $1.24 = 40x" |
| 5.8 | **全面错误处理覆盖**：补齐设计文档 9.2 节列出的全部场景（Token 过期/限频/断网/部分成功/插件失败/数据库损坏）的测试覆盖 + 逐条验证 | 2d | 全部 Phase | 逐场景测试通过 + 覆盖率报告 |
| 5.9 | **Phase 5 / MVP 最终验收**：完整走一遍 Phase 0→5 的核心场景 | 1d | 上述全部 | 录屏：从零配置 AI API → 连接仓库 → AI 分析 → 全自动代理发布/回复 → 效果反馈优化 → 竞品分析 → ROI 展示 |

小计：**16.5 天**（含最终验收 1 天，并行后约 **12.5 个工作日**）

---

## 9. 风险登记表（执行期需持续跟踪）

| 风险 | 触发信号 | 应对 |
|------|----------|------|
| **Phase 0: GitHub 公开 API 限频（60 req/h）** | 短时间内多次刷仓库分析触发 429 | 提示用户提供 PAT（5,000 req/h）；降级使用缓存；设置页展示剩余请求数 |
| **Phase 0: AI Prompt 调优耗时超预期** | 推文生成质量差、不符合 280 字符限制 | 缩小范围——Phase 0 先支持"首发公告"一种推广阶段，减少 Prompt 变量；后续 Phase 补充 |
| **Phase 1: Twitter API 付费成本超预期** | 1.8 用量熔断频繁触发 | 降低轮询频率（5→15 分钟）、减少自动拉取范围，评估是否值得付费升级额度 |
| **Phase 1: Windows OAuth loopback 被防火墙拦截** | 1.3 验证失败 | 切换到自定义 URL Scheme 方案（已在设计文档 P0-3 中预留备选） |
| **Phase 1: Phase 1 范围过大（25 天并行后仍可能超）** | Phase 1 实际耗时超估算 30%+ | 将 1.16（README PR）、1.18（Event Bus 完整实现）、1.25（URL 回填）推迟到 Phase 2 |
| **YouTube 配额在追踪场景下不够（多视频频繁轮询）** | 3.4 日消耗接近上限 | 降低轮询频率；优先 `commentThreads.list`（1 单位）而非 `videos.list`；提示用户申请配额提升 |
| **Flutter 桌面端小众问题（Windows/macOS 兼容性）** | 系统托盘、Keychain、OAuth loopback 等在某平台不可用 | 优先保证 macOS 可用，Windows 作为 known issue 记录；Phase 0 不依赖这些特性 |
| **全职 solo 进度落后预期** | 单个 Phase 实际耗时超估算 30%+ | 优先保证 Phase 0–2（最小闭环 + 核心三平台），Phase 4–5 可视情况延后或简化 |

---

## 10. 与设计文档的关系

- 本文档是 [构建计划](./appilot-build-plan.md) 的任务级展开，两者应保持同步。若实施中发现某个 Phase 的范围需要调整，应同时回写构建计划。
- 设计文档中的"完整愿景"架构（§3.1 完整 Hub-and-Spoke 图）和"完整 Schema"（§7.1, 11 张表）是 Phase 5 完成后的目标状态，不是 Phase 0 的实现目标。
- Phase 0 实现时应严格参照架构设计中的 §3.0（Phase 0 简化架构）、§7.0（Phase 0 最小 Schema）和 UI 设计中的 §8.0（Phase 0 最小 UI）。
