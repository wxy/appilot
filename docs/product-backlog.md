# Appilot 产品 Backlog

> 记录用户反馈但暂不排期的产品事项（与当前 headless/daemon 改造无直接关系的 UI/产品需求）。

## 1. 项目管理：删除项目（需确认）
- 状态：未实现删除入口
- 需求：Appilot 主面板/项目列表应能**删除项目**（含遗留的 `demo` 测试项目），删除前需**二次确认**
- 归属：DSH 主面板（AppHome）与 Electron 项目管理的删除路径

## 2. 失败任务批量处理按钮
- 需求：任务中心对**失败的活动任务组**提供两个批量操作：
  1. **全部清理**——清除失败状态（不再报这些错误，重置/移除失败记录）
  2. **清理并重新安排运行**——清除失败并立即重新排程（尽快重试一轮）
- 归属：任务中心 UI（Electron / DSH 主面板），控制经 daemon（runNow/重置语义待定：可能 = 清 lastStatus/error summary + nextRunAt=now）

## 3. DSH 会话「活动」视图问题（待用户提供刷新错误详情）
- 现象：Electron 打开同时开 3099，DSH 会话的 Appilot 页面「活动」看不到对应工作区活动；点击刷新报错（错误文本待用户提供）
- 已确认：`appilot_tasks` 工具本身工作正常（agent 已成功查询并汇报 2391 实例）
- 待查：客户端渲染路径 / 刷新触发错误

## 4. DSH 主面板（AppHome）应承担「全局任务中心」
- 期望：Appilot 首页（主面板）显示**全局活动任务中心**（类似 Electron 任务中心），而非被项目列表挤满
- 需求：主面板分区——项目（添加/进入）+ 任务中心（查看/控制：runNow/加速/停止）+ 设置
- 归属：DSH AppHome 布局重构；任务数据经 appilot_tasks / 控制经 daemon（跨壳统一）

## 观察记录
- 2026-09-03：真实库出现 `github-sync:<name>`（dsh/daemon 命名）与旧 `github-sync:<projectId>`（Electron 命名）双实例 → 已统一 name 命名（Electron reconcile 改），旧行由 prune 清理
- rank 失败多为一次性（个别 keyword×storefront），需任务失败的重试/清理策略（见 #2）
