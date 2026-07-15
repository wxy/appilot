# Appilot — MVP 设计文档


> 所属：[Appilot MVP 设计文档集](./README.md) | 状态：已确认 | 日期：2025-07-14 | 修订：2026-07-15（新增 §19 Phase 0 简化评审 + 审核意见落地 + P1-4 崩溃上报决策统一）
> 姊妹文件：[产品规格](./appilot-product.md) · [架构设计](./appilot-architecture.md) · [UI 设计](./appilot-ui.md) · [构建计划](./appilot-build-plan.md) · [横切关注点](./appilot-cross-cutting.md) · [评审记录](./appilot-review-log.md)
> 本文档记录 Appilot 设计过程中的**历次评审发现与决策**：P0/P1/P2 风险项及其落地状态、二次复核记录、Phase 0 简化评审。


## 16. 设计评审与改进建议 (2026-07-14)

> 本节为对第 1–15 节的评审记录，按 **P0（阻断性，必须在开工前解决）/ P1（重要，应在 Phase 1 内完成）/ P2（可延后）** 排序。已核实的平台 API 事实见第 2.1 节脚注。

### P0 — 阻断性风险（会导致架构假设失效或方案不可行）

| # | 问题 | 影响 | 建议 |
|---|------|------|------|
| P0-1 | **Twitter/X API 按量付费 + Tier 0 URL 回填的 JS 渲染障碍** | Twitter 推文页面重度 JS 渲染，简单 HTTP GET 无法提取浏览/点赞/回复数；若 Tier 0 追踪手段不可用，用户仍需手动填报 | Phase 1 Twitter Plugin 调研阶段评估两个方案：(a) 轻量 headless browser（如 `flutter_inappwebview` 后台加载推文页面后提取 DOM 数据）; (b) 接受降级，Tier 0 仅提供 URL 记录 + 手动填报表单。方案 (a) 的资源开销和稳定性需要在技术验证中确认 |
| P0-2 | **Twitter/X API 已是按量付费（credit-based），无稳定免费额度** | "自用优先"的成本假设不成立；统一收件箱要持续拉取 mentions/comments，加上发布、AI 生成前的上下文查询，都会产生持续费用 | 在 Phase 1 前明确月度预算上限，Task Scheduler 增加"用量预算熔断"（超预算自动降频/暂停），并在设置页展示实时用量/剩余额度 |
| P0-3 | **OAuth 桌面回调实现方式未定义** | 4 个插件中 3 个依赖 OAuth（Twitter/Reddit/YouTube），Discord 走 Bot/Webhook，若不统一方案，后期改造成本随插件数线性增长 | Phase 1 基础设施阶段确定统一方案：优先用**本地 loopback HTTP server**（跨平台兼容性最好，Reddit/Google/Twitter 官方示例均支持），封装为 Engine 层通用 `OAuthCallbackServer`，插件复用而非各自实现。注意 Windows 防火墙可能拦截 `127.0.0.1` 入站连接，Phase 1 需同时在 Windows 上验证可行性；若不可行，备选方案为自定义 URL Scheme（`appilot://oauth/callback`） |
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
4. ✅ **Tier 1"免费 API Key"在多用户分发场景下的共享配额风险（新发现）** — 若按 1.1 节路线图开源分发，"Appilot 自带 Key"会被所有安装共享，配额会远早于预期耗尽甚至触发平台封禁；已在 17.1 补充说明：默认走"用户自助申请 + 引导式设置向导"，"Appilot 自带 Key"仅作自用阶段临时方案。
5. ⚠️ **`publishMode`/`trackingMode` 建模为编译期静态 getter，无法表达"同一插件因用户凭据等级提升而升档"** — 例如用户后续购买 Twitter 付费额度后，理应让同一个 Twitter 插件从 Tier 0（webIntent/manualEntry）切换到 Tier 2（apiAuto），而不需要实现两个插件类。当前接口把这两个属性定义成固定 getter，语义上暗示编译期不变；建议后续实现阶段改为运行时按已连接的 `Credential` 类型/账号状态计算（如 `Future<PublishMode> currentPublishMode()`）。本轮先记录为待办，未改动第 5.1 节伪代码接口，避免在未与工程团队确认前过度设计。

### 18.3 待决策事项（需要产品/工程决策，非单纯文档修复）

- **P1-4 崩溃上报**：✅ 已决议，纳入 Phase 1（实施方案 Day 0 决策）。评审记录 §18.3 原文"纳入 Phase 5"与实施方案不一致——**2026-07-15 统一为 Phase 1**。理由：崩溃上报与 CI 基线共用同一批基础设施投入，边际成本低；且 Phase 0–2 代码量最大，越早接入越有价值。
- **P1-7 多账号管理**：已于 2.3 节明确排除（"验证阶段单账号即可满足自用需求，多账号留待社区反馈后评估"），`accounts` 表已是多行设计，仅需 UI/Engine 层暴露，届时成本很低。

---

## 19. Phase 0 最小闭环简化评审（2026-07-15）

> 本次评审的背景：经过完整设计复盘，发现当前 Phase 0 范围过大（试图同时交付 7 个子系统，约 35–40 天），失去了"纵向切片"的可行性。决定收缩到最小闭环，优先验证核心假设。

### 19.1 简化决策

| # | 决策 | 理由 |
|---|------|------|
| S-1 | **仅 GitHub 公开仓库**（单仓库） | 零认证、标准 API。本地仓库和私有仓库推迟到 Phase 1 |
| S-2 | **仅 Twitter Web Intent**（零 OAuth） | 不需要 Credential Vault、不需要 Plugin 接口。浏览器预填跳转即可验证"AI→文案→发布"链路 |
| S-3 | **仅手动填报统计**（零 URL 回填自动提取） | 去掉 headless browser / oEmbed / 页面解析的复杂度。用户粘贴 URL + 手动输入数字 |
| S-4 | **不做 Inbox / 回复辅助** | 无自动发布则无自动回复。Inbox 价值在 Tier 1/2 阶段才体现 |
| S-5 | **不做 运营仪表盘 / 多项目** | 先有数据再谈分析。单帖子趋势折线图是最小可用统计 |
| S-6 | **不做 Task Scheduler / Event Bus / Post Queue** | 无定时任务、无自动发布、无多平台。直接函数调用即可 |
| S-7 | **不做 i18n / 系统托盘 / 崩溃上报** | Phase 0 仅英文 + 普通窗口。基础设施完整版在 Phase 1 一次补齐 |
| S-8 | **Schema 收缩到 5 张表** | projects / posts / post_analytics / ai_config / ai_actions。其余 7 张表推迟到 Phase 1+ |
| S-9 | **publishMode/trackingMode 改为运行时动态计算** | 原设计为静态 getter，无法表达"同一插件因凭据等级提升而升档"。新增 `currentPublishMode()`/`currentTrackingMode()` 动态方法，基于已连接 Credential 类型计算（见 §5.1） |

### 19.2 审核意见落地核对

以下来自 2026-07-15 全面设计审核报告（5 类 20+ 个问题），已在本次修订中落地：

| # | 问题 | 落地 |
|---|------|------|
| R-1 | 实施方案过时（与构建计划脱节） | 构建计划 Phase 0 已重写；实施方案标注为"待重写" |
| R-2 | Phase 0 范围过大（纵向切片失效） | Phase 0 从 35-40 天收缩到约 17 天 |
| R-3 | `publishMode`/`trackingMode` 编译期静态 getter | 改为运行时动态方法 `currentPublishMode()`/`currentTrackingMode()` |
| R-4 | 推广计划缺少持久化 Schema | Phase 0 不做推广计划生成（用户手动选阶段），表推迟到 Phase 1 |
| R-5 | "零外部 API 依赖"表述不准确 | 改为"零平台 API Key/OAuth 依赖"，GitHub 公开 API 为 HTTP 请求非平台凭据 |
| R-6 | GitHub 公开 API 60 req/h 限频未设计 | Repo Analyzer 增加限频感知 + 提示 PAT 升级 + 缓存降级策略 |
| R-7 | Task Scheduler 并发模型（Isolate + drift）未澄清 | Phase 0 不引入 Isolate，所有操作为主线程同步/异步 |
| R-8 | i18n 在 Phase 0 和 Phase 1 重复 | Phase 0 仅英文硬编码；Phase 1 建 ARB 框架 |
| R-9 | Content Store 定位问题（Engine vs UI 感知） | 明确"30s 自动保存由 Composer UI 层触发，Content Store 只暴露 saveDraft()/loadDraft()" |
| R-10 | 通知机制跨平台实现未设计 | Phase 0 不需要通知（无后台任务）；Phase 1 确定方案 |
| R-11 | Schema JSON 字段 / ai_product_summary 缓存过期 | 增加 `ai_summary_generated_at` 字段；Phase 0 Schema 仅 5 张表 |
| R-12 | PR 建议对非 GitHub 仓库 UX 不完整 | Phase 0 不涉及（PR 建议推迟）；Phase 1 补充 |
| R-13 | 数据导出/备份设计缺失 | Phase 1 补充 |
| R-14 | AI 上下文窗口管理缺失 | Phase 0 单仓库 + 精简 System Prompt，暂不超限；Phase 1 加入 context 预算管理 |
| R-15 | 文档日期笔误（2025 vs 2026） | 保留原始文档的初次编写日期，修订日期更新为 2026-07-15 |
| R-16 | 部分开放问题可关闭（OAuth 回调/#5、分发/#6、测试/#7） | 已标记为"已决议"或"已纳入 Phase 1" |
| R-17 | 崩溃上报 Phase 5 vs Phase 1 矛盾 | 统一为 Phase 1（实施方案 Day 0 决策 + 评审记录 §18.3 同步修正） |

### 19.3 简化后的工时估算

| Phase | 原估算 | 新估算 | 变化 |
|-------|--------|--------|------|
| Phase 0 | 35–40 天（范围过大） | **约 17 天** | 收缩到最小闭环 |
| Phase 1 | 29 天 | 约 25 天（基于 Phase 0 已有基础叠加） | 部分工作 Phase 0 已完成 |
| Phase 2–5 | 不变 | 不变（范围未调整） | — |

**关键原则**：完整设计保留作为产品愿景，Phase 0 仅实现最小子集。架构通过接口抽象预留扩展空间，但不提前实现。
