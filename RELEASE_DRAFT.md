# Appilot v0.4.4

## What's New

- Release workbench rebuilt around one work target per product, with a flow status bar
  from GitHub release to store version
- GitHub releases as the primary release source (git-tag fallback); draft copies identified
  by appVersion with relinking and migration
- Language tab strip for copy editing; one-click history viewer with language markers
- Pre-release checklist: permission/capability audit, branch-language detection, screenshot
  location, streaming AI character counts
- Review insights: feedback inbox with AI theme clustering, overview feedback card,
  competitor deltas, reviews and trend pages
- Data layer: ASC read-only client (JWT), GitHub traffic and release-asset collectors,
  App Store review RSS collector, deterministic release readiness checks
- Per-platform competitors with rank seeding, keyword Ruby annotations, rank distribution
  chart, keyword chips
- Scheduler: acceleration mode to flush backlog, run-any-task-now button, task center
  rework, live data-change push channel
- Overview project activity card: commit heatmap with release markers

## Fixes & Engineering

- Single code path for store-copy generation and revision (baseLocalization parameter)
- Scheduler merge only writes back tasks actually executed; manual runs deduplicated
  against scheduled ticks; concurrent read-modify-write safety
- Store-copy field length limits enforced in inputs; monotonic AI progress with stop/retry
- GitHub draft/release detection hardened; stale PR lists never trusted
- Dead Traffic/CompetitorRadar overview cards removed

## Deployment Notes

- Version bumped to 0.4.4
- No schema or migration required
- macOS only this milestone (arm64 + x64 DMGs, Developer ID signed and notarized)

## Verification

- Tests: npm test (51 files)
- Builds: npm run typecheck, npm run build
- Smoke: docs/RELEASE.md checklist

---

# Appilot v0.4.4

## 新增功能

- 发布工作台重构为「单工作目标」，新增 GitHub release → 商店版本的流程状态栏
- GitHub releases 作为主发布源（git tag 降级）；草稿文案按 appVersion 身份关联与迁移
- 语言标签页编辑文案；历史查看器一键切换 + 语言标记
- 发布清单：权限/能力审计、分支语言检测、截图位置、AI 流式字符
- 评论洞察：反馈收件箱 + AI 主题聚类、总览反馈卡片、竞品差异、评论/趋势页
- 数据层：ASC 只读客户端（JWT）、GitHub 流量与 release 资产采集、评论 RSS 采集器、
  确定性 readiness 检查
- Per-platform 竞品与排名种子、关键词 Ruby 标注、排名分布图、关键词 chip 样式
- 调度：加速模式清积压、任务立即执行按钮、任务中心重构、数据变更实时推送
- 总览项目活动卡片：提交热力图 + release 标记

## 修复与工程

- 商店文案生成与修订合并为单一代码路径（baseLocalization 参数化）
- 调度合并只回写实际执行的任务；立即执行与定时执行去重；并发读写安全
- 文案字段长度限制、AI 进度单调展示 + 停止/重试
- GitHub 草稿/release 检测强化，不信任过期 PR 列表
- 移除死代码 Traffic/CompetitorRadar 总览卡片

## 部署说明

- 版本升级到 0.4.4
- 无需数据库迁移
- 本里程碑仅发布 macOS（arm64 + x64 DMG，Developer ID 签名并公证）

## 验证

- 测试：npm test（51 个文件）
- 构建：npm run typecheck、npm run build
- 冒烟：docs/RELEASE.md 冒烟清单
