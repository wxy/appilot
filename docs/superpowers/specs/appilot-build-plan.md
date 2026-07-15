# Appilot — MVP 设计文档


> 所属：[Appilot MVP 设计文档集](./README.md) | 状态：已确认 | 日期：2025-07-14 | 修订：2026-07-15（Phase 0 最小闭环重写 + 审核意见落地）
> 姊妹文件：[产品规格](./appilot-product.md) · [架构设计](./appilot-architecture.md) · [UI 设计](./appilot-ui.md) · [构建计划](./appilot-build-plan.md) · [横切关注点](./appilot-cross-cutting.md) · [评审记录](./appilot-review-log.md)
> 本文档是 Appilot 的**构建计划**：Phase 0～5 的交付清单、产出标准和依赖关系。任务级拆解见 [实施方案](./2026-07-14-apppost-implementation-plan.md)。


## 13. 构建计划

**策略：纵向切片，每阶段产出可交互的完整应用。**

### Phase 0: 最小闭环验证 — "代码→文案→发布→追踪"（12–15 天，优先交付）

> **目标**：验证 Appilot 的核心假设——"AI 读取代码仓库后生成的推广文案，比开发者自己写的更好/更快"。
> **策略**：仅 GitHub 公开仓库 + 仅 Twitter Web Intent + 仅手动统计填报。零 OAuth、零后台调度、零多平台。
> **产出**：输入一个 GitHub 公开仓库 URL → AI 生成产品摘要和推文 → 一键跳转 Twitter 发布 → 回填 URL 填写数据 → 看趋势图。

```
Phase 0 交付清单（仅以下内容）:
  ✓ AI API 配置（OpenAI 兼容 URL + Key，存 SQLite）
  ✓ GitHub 公开仓库连接（输入 URL → 读取 README/文件树/最近 10 次提交）
  ✓ 仓库摘要展示（项目名、技术栈、关键特性、最近提交列表）
  ✓ AI 产品摘要在 UI 中展示并可编辑
  ✓ AI Twitter 推文生成（280 字符 + hashtags，仓库上下文驱动）
  ✓ 推文草稿编辑器（用户审阅修改 + AI 重新生成 + 保存/加载草稿）
  ✓ Twitter Web Intent 一键跳转（系统浏览器打开，预填文案）
  ✓ 帖子 URL 回填 + 手动统计登记表单（浏览/点赞/评论数 + 备注 + 时间戳）
  ✓ 单帖子趋势折线图（基于手动填报数据，按时间展示浏览/点赞/评论变化）
  ✓ 基础设置页（AI API 配置、GitHub 仓库 URL、项目名称）
  ✓ 错误处理基础（API 调用失败提示 + 日志记录）
  ✓ 主题（明暗色跟随系统）

Phase 0 明确不做的（保留完整设计供后续 Phase 参考）:
  ✗ 本地仓库 / 私有仓库 / 多仓库（Phase 1+）
  ✗ Reddit / Discord / YouTube 任何形式接入（Phase 2/3）
  ✗ OAuth / Credential Vault / Token 管理（Phase 1）
  ✗ URL 回填自动提取（headless browser / oEmbed / 页面解析）（Phase 1）
  ✗ Inbox / AI 回复建议（Phase 1）
  ✗ 推广计划生成（Phase 0 用户手动选择推广阶段）
  ✗ README 完整性检查 / PR 建议（Phase 1）
  ✗ 运营总览仪表盘（Phase 1）
  ✗ 多项目支持（Phase 4）
  ✗ 内容模板（Phase 3）
  ✗ 系统托盘 / 后台轮询 / Task Scheduler / Event Bus / Post Queue（Phase 1+）
  ✗ Plugin 接口抽象（Twitter Web Intent 硬编码 URL 构建）（Phase 1+）
  ✗ i18n（仅英文）（Phase 1）
  ✗ 崩溃上报（Phase 1）
  ✗ 自动更新 / 签名公证（Phase 1 末）

Phase 0 数据库表（仅 5 张）:
  projects（仅 github_public 来源，单仓库）
  posts（仅 Twitter，publish_mode 固定 web_intent）
  post_analytics（source 固定 manual）
  ai_config（单行全局配置）
  ai_actions（AI 调用审计日志）
```

**Phase 0 任务估算（12–15 天）：**

| # | 任务 | 估时 | 依赖 | 验收标准 |
|---|------|------|------|----------|
| 0.1 | **Electron + React 项目脚手架**：npm workspace（`packages/desktop/` + `packages/engine/`）+ Electron Forge/Vite + React 18 + TypeScript + Tailwind CSS + shadcn/ui + Zustand + React Router (Hash) | 1.5d | - | `npm run start` 跑起 Electron 窗口，Hash 路由跳转正常，Tailwind 暗色模式切换可用 |
| 0.2 | **drizzle-orm Schema 建表 + Migration**：5 张表（projects/posts/post_analytics/ai_config/ai_actions），better-sqlite3 连接，drizzle-kit migration 自动生成 | 1.5d | 0.1 | 表创建成功，`npx drizzle-kit generate` + `npx drizzle-kit migrate` 跑通 |
| 0.3 | **错误处理基础**：分层异常类 + 文件日志（`electron-log` 或 winston，按天滚动，保留 14 天到 `~/.appilot/logs/`） | 1d | 0.1 | 故意抛一个异常，验证日志文件中有完整堆栈 + 用户可读错误提示 |
| 0.4 | **GitHub Repo Analyzer**：`connectGitHubPublicRepo(url)` — octokit 读取 README/文件树/最近 10 次提交 + simple-git clone 到临时目录提取 git log。限频感知：429 → 提示用户 + 缓存降级 | 2.5d | 0.1 | 输入 `github.com/facebook/react` → UI 展示 README 摘要 + 文件树 + 最近 10 次提交 |
| 0.5 | **AIProvider + OpenAI 兼容实现**：`openai` npm 包（支持自定义 baseURL，兼容 Ollama/DeepSeek/Groq）。`chat()` + `validateConnection()` + `lastUsage` | 1.5d | 0.1 | 用真实 API Key 跑通 `chat()`，验证 `lastUsage` 返回 token 数和费用 |
| 0.6 | **AI 配置 UI**：设置页表单（Provider URL + API Key + Model），保存到 electron-store + ai_config 表。"测试连接"按钮调用 validateConnection | 1d | 0.2, 0.5 | 配置保存后重启应用仍有效；"测试连接"显示成功/失败 |
| 0.7 | **AI Engine**：`analyzeProduct(projectId)` + `generateTweet({projectId, stage})`。单仓库上下文组装 → System Prompt → AI 调用 | 2d | 0.4, 0.5 | 连接仓库 → 点击"分析" → AI 返回产品摘要；点击"生成推文" → AI 返回 < 280 字符推文 |
| 0.8 | **Context Builder**：`buildContext(projectId)` → 组装 System Prompt（README + 技术栈 + 最近提交 + 特性列表 + 风格要求） | 1d | 0.4 | 检查发送给 AI 的 System Prompt 包含产品名/技术栈/提交/特性/风格要求 |
| 0.9 | **项目设置向导 UI**：React 组件——Step 1 AI API 配置 → Step 2 输入项目名 + GitHub URL → "连接并分析"→ 展示 AI 分析结果（产品摘要/特性/技术栈/最近提交） | 1.5d | 0.4, 0.7 | 输入 github.com/user/repo 后看到 AI 提取的特性列表和产品摘要，可编辑 |
| 0.10 | **Composer 推文编辑器**：React 组件——AI 生成的草稿展示（字符计数 [xxx/280]）+ 编辑 + "AI 重新生成"按钮 + 语气选项 + 草稿手动保存/加载 | 1.5d | 0.7, 0.2 | 保存草稿后关闭重开，点击"加载草稿"内容恢复 |
| 0.11 | **Twitter Web Intent 跳转**：构建 `twitter.com/intent/tweet?text=...` URL，Electron `shell.openExternal()` 打开系统浏览器 | 0.5d | 0.10 | 点击"在 Twitter 上发布"→ 系统浏览器打开 Twitter 且文案预填 |
| 0.12 | **Content Store**：`saveDraft()` / `loadDraft()` / `listDrafts()` — drizzle-orm 读写 posts 表（status=draft） | 1d | 0.2 | 保存草稿 → posts 表有 status=draft 记录 → 加载后内容完全恢复 |
| 0.13 | **帖子 URL 回填 + 手动统计登记**：posts 表 permalink 字段 + 手动统计表单 UI（浏览/点赞/评论 + 备注 + 日期）+ drizzle-orm 写入 post_analytics (source=manual) | 1.5d | 0.2, 0.11 | 提交后 post_analytics 表新增 source=manual 记录，列表可见 |
| 0.14 | **Analytics Engine + 趋势折线图**：`submitManualStats()` + `watchTrend()` + Recharts/ECharts 折线图（浏览量/点赞/评论三条线） | 2d | 0.13 | 连续提交 3 条统计后图表显示 3 个 data point 折线，三条线颜色不同有图例 |
| 0.15 | **AI 用量展示**：每次 AI 调用后 UI 显示消耗；设置页"本月累计"从 ai_actions 表聚合 | 1d | 0.7, 0.2 | 生成推文后显示"本次消耗 1,247 tokens，约 $0.02"；设置页有累计统计 |
| 0.16 | **Phase 0 整体验收**：端到端走通 + 录屏 | 1d | 全部 | 录屏：输入 GitHub 公开仓库 URL → AI 分析 → 生成推文 → 跳转 Twitter → 回填 URL → 提交 3 次统计 → 趋势图 |

小计：**约 20.5 天**（含 3.5 天 buffer，实际核心编码约 17 天）

小计：**约 17 天**（含 2 天 buffer），实际编码约 15 天。

> ⚠️ **与旧方案的关键差异**：旧 Phase 0（22 天，2026-07-14 方案）包含多仓库、AI 推广计划、跨平台清单、URL 回填自动提取、运营仪表盘、系统托盘等。新 Phase 0 严格收缩到最小闭环，工时从 22 天降到约 17 天，但可独立验证核心价值。

### Phase 1: Twitter 全自动 + 基础设施完备 — 在 Phase 0 最小闭环上叠加（约 25 天）

> **Phase 0 已有**：单 GitHub 公开仓库连接 + AI 推文生成 + Twitter Web Intent + 手动统计 + 趋势图 + 基础错误处理 + 主题。
> **Phase 1 新增**：将手动流程升级为全自动 + 补齐基础设施，让应用从"原型验证"进入"可安全分发的桌面应用"。

```
基础设施 (一次性建立，基于 Phase 0 扩展):
  ✓ 升级 Repo Analyzer: 新增本地仓库 (connectLocalRepo) + GitHub 私有仓库 (connectGitHubPrivateRepo + PAT) 支持
  ✓ Credential Vault (系统 Keychain/Credential Manager 安全存储)
  ✓ OAuth 通用回调服务器 (Engine 层 OAuthCallbackServer，loopback HTTP server 方案，Windows 兼容性验证)
  ✓ Plugin 接口定义 + Plugin Registry (Phase 0 硬编码的 Twitter Web Intent 迁移为 Plugin 实现)
  ✓ Task Scheduler (定时轮询 + 启动追赶 + 即时发布)
  ✓ Event Bus + Post Queue
  ✓ i18n 框架 (flutter_localizations + ARB, 中英双语骨架；Phase 0 仅英文)
  ✓ 错误处理框架增强 (分层异常 + 日志脱敏 + 用户可读消息 + 诊断包导出)
  ✓ 系统托盘 + 应用自启动
  ✓ CI 基线 (GitHub Actions: lint + test + build，macOS + Windows)
  ✓ 单元测试/集成测试基线 (Mock Plugin 用于关键路径测试)
  ✓ macOS Developer ID 签名 + 公证 (+ Windows 代码签名，最低优先级)
  ✓ 自动更新框架
  ✓ 崩溃上报 opt-in 接入 (Sentry 桌面 SDK)

功能 (Twitter 端到端):
  ✓ Twitter Plugin 完整实现 (OAuth 自动发布 + 拉取互动 + 用量预算熔断)
  ✓ 推广计划生成 (AI 根据 Release 节奏建议阶段/频率，Phase 0 为手动选择)
  ✓ 多仓库支持 (appSource/website/docs 角色分配)
  ✓ URL 回填自动提取 (Reddit .json + YouTube oEmbed，headless browser 方案评估)
  ✓ 统一收件箱 (真实 Twitter 互动 + AI 回复建议)
  ✓ 运营总览仪表盘 (开发进度/推广概览/下载量/AI 费用统计)
  ✓ README 完整性检查 + PR 建议生成

产出: 仅支持 Twitter，但"项目连接 → AI 推广计划 → 自动发布→追踪→回复→仪表盘"全链路可用
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
  ✓ 多产品宏观仪表盘（全部项目卡片总览、跨项目合计指标）
  ✓ 收入与成本追踪增强（自动从 ai_actions 聚合 AI 成本，手动登记开发成本和收入）
  ✓ 插件管理界面
  ✓ 社区插件加载机制 (~/.appilot/plugins/)
```

### Phase 5: AI 增强模式

```
在 Phase 0 仓库驱动 AI 基础设施之上扩展自主能力:
  ✓ AI 半自动回复规则引擎 (结合仓库上下文：检测到 bug 反馈 → 自动关联 GitHub Issues)
  ✓ AI 全自动代理模式 (含安全约束：频率上限、敏感词过滤、人工随时接管)
  ✓ AI 发布策略优化 (根据代码变更节奏 + 历史互动数据优化发布时机和内容)
  ✓ AI 回复建议增强 (多轮对话上下文 + 用户历史互动偏好)
  ✓ AI 推广效果分析 — **内容效果反馈闭环**：将历史帖子的互动数据（浏览量、点赞、评论数、评论情感）作为下次生成的额外上下文注入 System Prompt（如"你上次为 Twitter 生成的帖子获得 2.3K 浏览和 142 个赞，表现最好的标签是 #indiedev 和 #flutter，文案风格偏向技术干货类更受欢迎"），AI 据此持续优化文案质量。这是 Appilot 相比通用 AI 助手的核心护城河
  ✓ AI 竞品差异化分析 — 基于项目技术栈和功能特性，搜索相似项目并建议差异化角度
  ✓ 投入产出分析（ROI）— 基于 project_metrics 表中的收入/成本数据，自动计算每个产品的盈亏平衡和投资回报率
  ✓ 全面错误处理覆盖
  ✓ 崩溃/异常上报 (Sentry 桌面 SDK，opt-in)
```

---

