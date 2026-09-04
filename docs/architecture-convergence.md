# 架构收敛：Electron 唯一完整壳 + DSH 轻量工具插件

> 状态：2026-09-04 决策，C1（本文档）已合。此为路线基准——后续 PR 逐步落地，不另行争论方向。

## 0. 决策摘要（第一性原理）

Appilot 用户价值 = **持续采集的运营数据 + 可靠调度 + 呈现/操作**。数据与调度已中心化于
headless（SQLite 单库 + 实例任务引擎 + 租约调度 + daemon 常驻），与壳无关——这部分保留且是资产。

壳的职责是「呈现/操作」。Electron 天生适合复杂业务 GUI（它已运作满意）；
**DSH 是 agent 环境，不是业务 GUI 宿主**——其客户端无插件级跨端直读通道（查证结论），
把 DSH 当完整 GUI 壳复刻 Electron = 用错工具 + 双份维护负担（reconcile/仲裁/部署/版本），
且「全局任务中心面板」受宿主约束做不成常驻视图（在 DSH 首页任务中心上已反复验证）。

**决策**：
- **Electron = 唯一完整 GUI 壳**，独立发布路径（上架与否是独立决策，不阻塞收敛）；
- **DSH = 轻量工具插件**：只装 agent 工具 + 结果卡片，输出用户最关心的数据，不提供完整 GUI；
- **headless/daemon/npm 包分层全部保留**（单一事实源不依赖壳数量）；
- CLI / MCP 顺手保留（只读/控制命令）。

## 1. 目标形态

```
@appilot-labs/*（core 纯函数 + headless 数据/任务引擎 + scheduler daemon 常驻）
      │
      ├── Electron 独立应用（唯一完整 GUI）
      │      ├── 呈现：任务中心 / 排名 / 发布 / 评论 / 设置
      │      ├── 控制任务中心：启动/停止/加速/立即运行（见 §2）
      │      ├── 数据管理：DB 信息 / 快照清理 / 备份（见 §3）
      │      └── 拉起 daemon（app 启动 best-effort；关掉应用后 daemon 继续采集）
      │
      ├── DSH 轻量插件（工具集 + 结果卡片，见 §4）
      │      └── agent 对话：查任务状态 / 查排名快照 / 跑检查 / 跑单个任务
      │
      └── CLI / MCP（只读查询 + 控制命令，复用同一 headless）
```

## 2. Electron：任务中心控制（新增）

背景：任务中心（调度）已独立为常驻 daemon，不再跟随应用启动/停止（无 UI 也采集）。
因此壳上需要显式控制与状态呈现。

- **状态**：`scheduler:status` 增 `daemon` 段
  `{ running, leaderId, heartbeatFresh, pid? }`（daemon socket ping + lease 行 heartbeat 新鲜度；
  leader 可能是 `scheduler`（daemon）/ `electron`（壳内 fallback）/ null）。
- **控制 IPC**：
  - `scheduler:daemonStart`：daemon 未跑 → `ensureScheduler`（spawn detached）→ 返回结果；
  - `scheduler:daemonStop`：daemon 在跑 → socket `shutdown`（controlShutdown，优雅让位退出）；
    若本进程是主（electron fallback 在跑）→ 同时停壳内调度（scheduleGate 关闭），保证「停止 = 真的停了」；
  - 现有 `setAccel` / `runTaskNow` / `runDue` 保留（已按 leader 分流）。
- **UI**：任务中心页顶栏加「调度中心」状态条（调度主 / 运行中 / 上次心跳）+
  [启动任务中心] [停止任务中心]（按状态禁用）；设置页镜像同控件。
- 复用：scheduler 包 `controlShutdown / controlStatus / ensureScheduler`；Electron 现有
  `currentLeader()/sendToDaemon`（sendToDaemon 扩 method 含 `shutdown`、`status`）。

## 3. Electron：SQLite 数据管理（新增）

独立 SQLite 单库（`~/Library/Application Support/Appilot/appilot.db`，WAL）容量远超旧 JSON，
快照/记录长期累积——需要管理介入面（原 JSON 时代不需要，此为后端切换的增量职责）。

- **信息**（`appilot:db:info` IPC → 设置页「数据」区）：
  DB 路径、文件大小（db+wal）、表行数（projects / tasks / rank_snapshots / product_records / release_cache）、
  最旧/最新快照时间。
- **动作**：
  - 清理旧排名快照：headless `store.snapshots.pruneOlderThan(projectName, beforeIso)` 已有——
    加 UI 表单「保留最近 N 天，其余清理」（projectId 维度或全库）；
  - 备份：`VACUUM INTO '<path>'`（node:sqlite 支持）导出一致性快照文件；
  - 压缩：`VACUUM`（WAL checkpoint + 文件收缩），大清理后提示。
- 所有动作走 IPC → main 用 headless store（与调度同一 DB，busy_timeout 并发安全），
  结果回传影响行数/新大小。

## 4. DSH：轻量工具插件（降级收敛，交互 = 斜杠命令）

- **保留**：
  - 服务端工具：`appilot_tasks`（状态直读，已含 byKind/summary）、`appilot_task_run`
    （经 daemon 控制）、`appilot_snapshots`、`appilot_overview`（+ dsh-project 的
    list/register——注册表工具，不属于本插件）；
  - `tool.call.toolview` 结果卡片（工具输出在会话里可视化）；
  - **斜杠命令 `/appilot`**（2026-09-04，宿主 `ctx.commands`）：handler **直读共享
    SQLite**、输出渲染为命令行——不经模型、零 token、任意会话可用。这是
    「任务数据在数据库里、不经对话获取」的最终形态：
    `/appilot`（帮助）、`/appilot task`（状态摘要 byKind + 失败明细 + 调度主）、
    `/appilot task clear|reschedule`（失败批量处理，重排限速摊铺 30–210min）。
- **移除（大型 GUI 复刻，沉没成本不再追加）**：
  - `shell.overlay` AppHome 全局首页浮层、`sidebar.footer.action` 首页入口、
    `conversation.view` 工作台大面板、`conversation.composer.dock` 悬浮按钮组；
  - 对应 client 源文件（app-home/workbench/tabs/overview-dsh/dedicated-session/
    quick-actions/registry-cache/home-store/project-home）已删除；专属会话机制停用。
- **信息口径（轻量定义）**：Harness 只给「用户最关心的」——任务健康（ok/error/never）、
  最新失败与处理动作、排名轨迹摘要、可执行的检查/同步；深链路留在 Electron。

## 5. 保留不动的地基（不随壳收缩回退）

- headless：schema v6、tasks 实例引擎、lease 单例、reconcile（seed/参数刷新/prune）；
- scheduler daemon：常驻、socket 控制面、**代码自更新**（部署后自动重启，2026-09-04 落成）；
- Electron 侧 DB 直读（任务中心 DB 视图、rankProgress、release cache 双写与 hydrate 反向同步）；
- core 纯函数包分层。

## 6. 里程碑（每步 PR + CI + 真机复核）

| # | 内容 | 产物 |
|---|---|---|
| C1 | 收敛决策固化 | 本文档 + product-backlog 更新 ✅ |
| C2 | Electron 任务中心控制 | §2 的 IPC + 顶栏状态条/启停按钮 |
| C3 | Electron 数据管理 | §3 的 db:info + 清理/备份/压缩 UI |
| C4 | DSH 插件降级 | §4 移除大 UI 挂载点、保留工具+卡片、**新增 /appilot 斜杠命令**（PR #172）；client 1229KB→14KB |
| C5 | 协调逻辑收窄 | ✅ 租约同 id 互斥（PR #175，防双 daemon）；⏳ 403/429 限流退避 + 并发上限（教训 C 落码）；壳内调度 fallback 退役评估 |

## 7. 边界与不做

- DSH 不做跨端常驻数据视图/全局任务中心 GUI（宿主约束，此前反复验证的硬边界）；
- 「无 UI 也采集」由 daemon 承担——停止任务中心是显式用户动作，不是应用退出副作用；
- Electron 上架 App Store：独立决策，列入产品 backlog 跟踪，不阻塞 C1–C5。
