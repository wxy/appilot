# Appilot — MVP 设计文档


> 所属：[Appilot MVP 设计文档集](./README.md) | 状态：已确认 | 日期：2025-07-14 | 修订：2026-07-14
> 姊妹文件：[产品规格](./appilot-product.md) · [架构设计](./appilot-architecture.md) · [UI 设计](./appilot-ui.md) · [构建计划](./appilot-build-plan.md) · [横切关注点](./appilot-cross-cutting.md) · [评审记录](./appilot-review-log.md)
> 本文档是 Appilot 的**构建计划**：Phase 0～5 的交付清单、产出标准和依赖关系。任务级拆解见实施方案（待重写）。


## 13. 构建计划

**策略：纵向切片，每阶段产出可交互的完整应用。**

### Phase 0: AI 优先 + 手动发布（最先交付，详见第 17 节）

```
零外部平台 API 依赖（仅需 AI API），验证"连接仓库 → AI 分析 → 生成推广计划 → 发布 → 回填 URL → 自动追踪"核心工作流:
  ✓ 全局 AI API 配置 (AIProvider 接口 + OpenAI 兼容实现 + 本地模型 Ollama/LM Studio 选项 + AI 数据出境提示)
  ✓ 项目管理 UI（添加项目：名称、项目状态(预热中/已发布/维护中)、多仓库连接、仓库角色分配）
  ✓ Repo Analyzer (跨仓库文件读取 + git log + GitHub API + 代码结构扫描 + 发布渠道/项目链接自动识别 + README 完整性检查)
  ✓ AI 产品理解 (跨仓库自动提取特性、亮点、发布渠道、官网/社区链接，生成产品摘要；支持预热阶段基于代码进度的推测)
  ✓ AI README 完善建议 (对比仓库内容与 Appilot 已知信息 → 生成 PR 建议 → 用户确认 → 创建 PR 或复制内容)
  ✓ AI 推广计划生成 (建议发布阶段、目标平台、推广频率 → 用户审阅确认)
  ✓ AI 多平台文案生成 (按 Twitter/Reddit/Discord/YouTube 格式自动适配，仓库上下文驱动)
  ✓ AI 辅助 Composer 编辑器（文案草稿呈现 + 用户逐平台审阅修改 + 语气微调）
  ✓ 跨平台发布清单（Checklist）：逐平台标记"已手动发布"并回填帖子 URL
  ✓ Web Intent 快捷发布：Twitter/X、Reddit 等有预填链接的平台一键跳转
  ✓ URL 回填自动提取：用户粘贴帖子 URL → 程序访问公开页面提取互动数据（优先 .json / oEmbed 等轻量方式，失败则降级为手动填报表单）
  ✓ AI 回复辅助（根据评论内容 + 仓库上下文生成个性化回复建议）
  ✓ 到期提醒（reminder 任务类型）+ 手动填报降级兜底
  ✓ 完整 SQLite Schema 设计与 migration 框架搭建（drift，覆盖 projects/status/distribution_platforms/links、project_repos/repo_role、project_metrics/download_count/revenue/dev_cost/ai_cost、pr_suggestions、posts/publish_mode/project_id、post_analytics/source(url_backfill/api/manual)、reminders、accounts、interactions、content_templates、ai_config、ai_actions）
  ✓ 运营总览仪表盘（开发进度卡片、推广概览、开发活跃度、收入与成本手动登记、快速操作入口）
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

