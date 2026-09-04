# Appilot 产品 Backlog

> 记录用户反馈但暂不排期的产品事项。**架构方向以 docs/architecture-convergence.md 为准**
> （2026-09-04 决策：Electron 唯一完整壳 + DSH 轻量工具插件）——凡与 DSH 大型 GUI 相关的
> 旧条目均已按该决策收敛/撤销，不再追加投入。

## 1. 项目管理：删除项目（需确认）
- 状态：未实现删除入口
- 需求：项目管理应能**删除项目**（含遗留的 `demo` 测试项目），删除前需**二次确认**；
  删除需级联清理（tasks 实例 / product_records / project_meta / release_cache / 快照）
- 归属：Electron 项目管理（按收敛决策，DSH 不再做项目管理 GUI）

## 2. 失败任务批量处理按钮（含限流感知）
- 需求：任务中心对**失败的活动任务**提供批量操作：
  1. **全部清理**——清除失败状态（不再报这些错误）
  2. **清理并重新安排运行**——清除失败并尽快重排一轮（重排必须**限速摊铺**，见观察记录）
- 补充（2026-09-04 事故教训 C）：识别 403/429 类限流错误做**指数退避**而非等同业务错误置 error
- 归属：Electron 任务中心 + daemon 控制（重置语义待定：清 lastStatus/error + nextRunAt 摊铺）

## 3. DSH 会话「活动」视图 —— ⚠️ 已按架构收敛撤销（2026-09-04）
- 原诉求（DSH 会话内做活动视图/全局任务中心 GUI）已被决策取代：DSH 只做轻量工具插件，
  数据经 `appilot_tasks` 等 agent 工具输出（结果卡片呈现），不再追求常驻跨端 GUI。
- 架构结论存档：DSH 客户端无插件级跨端直读通道（宿主约束），宿主桥接排期与否不影响此决策。

## 4. DSH 主面板全局任务中心 —— ⚠️ 已按架构收敛撤销（2026-09-04）
- PR #159/#161/#165 的 GUI 落地（三标签主面板、GlobalTaskCenter）随收敛**从 DSH 客户端移除**；
  对应信息能力（appilot_tasks byKind/summary 聚合）**保留在服务端工具层**，供 agent 汇报使用。
- 历史结论：该视图受宿主约束无法常驻跨端刷新；「任务数据在 DB 直读」由 Electron/daemon 承担。

## 观察记录
- 2026-09-03：真实库出现 `github-sync:<name>` 与旧 `github-sync:<projectId>` 双实例 → 统一 name 命名，旧行 prune
- 2026-09-04 运行事故复盘（rank 83→954 参数错误蔓延）：根因 = daemon 内存旧 executors（部署未重启），
  教训 A 已落成 daemon 代码自更新（PR #164）；教训 B/C 见 #2（限速摊铺 + 403/429 退避）
- 2026-09-04 架构收敛决策：Electron 唯一完整壳 + DSH 轻量工具插件（见 docs/architecture-convergence.md，
  里程碑 C1–C5）
