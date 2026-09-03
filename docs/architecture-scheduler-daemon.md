# Appilot 调度守护进程架构蓝图（方案 A）

> 状态：设计蓝图（P0）。目标：把「后台自动调度执行」从端侧（Electron / DSH）抽成
> **独立常驻调度守护进程**；端侧只做展示与交互。任何端启动都会确保守护进程在跑，
> 后启动的端检测到已运行的守护进程后直接与之通讯；守护进程在没有端与其通讯时
> 平滑退出（不残留僵尸调度）。
>
> 前置数据/执行统一（M4-C1/C2）完成前，本蓝图是目标形态；落地顺序见「里程碑」。

## 1. 进程拓扑与职责

```
┌────────────────────────────────────────────────────────────┐
│             共享 SQLite（appilot.db）—— 唯一事实源           │
│   projects / rank_snapshots / tasks(实例) / lease / meta /   │
│   products / project_release_cache                          │
└───────────────────────────▲────────────────────────────────┘
                            │
        ┌───────────────────┴────────────────────┐
        │  @appilot-labs/appilot-scheduler       │
        │  （调度守护进程：唯一调度者，无 UI）      │
        │  - openStore → lease.acquire('scheduler')│ ← 单例仲裁（失败自我退出）
        │  - reconcile 周期：DB 数据 → 期望实例集   │
        │  - createLeaseScheduler({executors}).start() │ ← 唯一执行 tick
        │  - 本地 socket 服务：壳心跳 / runNow /     │
        │    任务事件推送（task:started/finished）  │
        │  - 空闲退出：无客户端心跳 N 分钟 → 优雅退出 │
        └───────▲───────────────────▲───────────┘
      JSON-RPC  │   (Unix socket / named pipe)
        ┌───────┴─────┐      ┌──────┴────────┐
        │  Electron 壳 │      │  DSH 壳       │
        │  （纯 UI + 查询 + 心跳/触发）         │
        └─────────────┘      └───────────────┘
```

- **守护进程 = headless 引擎的常驻宿主**：它全部逻辑只是「装配 + 启动 + 服务」，
  调度/执行/实例/数据都是 headless 现有能力（依赖方向：core ← headless ←
  scheduler/壳；无环）。
- **壳 = headless 服务门面的客户端**：`createHeadlessService` 读数据 + socket
  心跳/触发；**不再嵌入调度 tick**（Electron 旧 scheduler.ts 退役）。

## 2. 包形态（方案 A）

| 包 | 内容 | 说明 |
| --- | --- | --- |
| `@appilot-labs/appilot-headless` | 引擎库（不变） | store / 实例 / executors / reconcile / lease scheduler / service 门面 |
| `@appilot-labs/appilot-scheduler`（新，薄） | bin `appilot-scheduler` + 守护进程逻辑 + socket 协议 | 依赖 headless；`files: [dist]`；prepublishOnly build |
| `@appilot-labs/appilot-core` | 纯业务函数（不变） | 执行实现唯一来源 |
| 壳（Electron/DSH） | 只调 headless service + scheduler 的 `ensureScheduler()` 助手 | 共享助手放 scheduler 包导出 |

守护进程逻辑分层（便于单测）：
- `src/daemon.ts`：生命周期（acquire / reconcile 周期 / scheduler.start / 空闲退出）
- `src/protocol.ts`：JSON-RPC 消息类型（纯，单测）
- `src/server.ts`：本地 socket 服务（连接/心跳/触发/事件推送）
- `src/ensure.ts`：`ensureScheduler()`——供壳调用的「spawn detached + ping + 崩溃重拉」
- `bin/appilot-scheduler.js`

## 3. 守护进程内部生命周期

```
启动:
  openStore(defaultDbPath())
  if (!store.lease.acquire('scheduler', 60_000)) { log; exit(0) }   // 已有调度者
  bind 本地 socket（失败=端口/socket 已占用 → exit(0)，壳会 ping 到已存在的）
  executors = buildHeadlessExecutors({ readToken: env/凭据读取 })
  sched = createLeaseScheduler({ store, leaderId: 'scheduler', jobs: [], executors })
  reconcile()                                    // 立即一次
  reconcileTimer = setInterval(reconcile, 60s)   // DB 数据 → 期望实例集
  sched.start()                                  // 租约心跳 + 跑到期实例
运行:
  socket 接受壳连接：ping → pong；runNow(id) → 调 sched.runNow 回结果；
  task 事件：sched 执行回调 → 广播 notify:task-started / task-finished
空闲退出:
  无客户端心跳（或全部断开）持续 IDLE_TTL（默认 2min）→ 平滑退出：
  停 reconcile/scheduler → 关 socket → exit(0)
  （租约无需显式释放：心跳停止后 TTL 过期，下个启动者自然接管）
```

- reconcile 的数据源 = **共享 DB**（注册项目 → github-sync 实例；M4-C2 后
  富数据实例也从 DB 的 product_records/meta 推导）——守护进程不读 electron-store，
  这要求 Electron 富数据同步（M3）先行完成 ✓。

## 4. 壳 ↔ 守护进程协议（本地 socket，换行分隔 JSON-RPC 2.0）

消息（客户端 → daemon）：
- `hello { client: 'electron'|'dsh', pid }` → `hello-ack { daemonPid, version }`（注册即心跳起点）
- `ping` → `pong`（壳开着 UI 就每 10s ping；无 ping 视为离线）
- `runNow { taskId }` → `{ task }` 或 `{ error }`（用户显式触发，唯一执行入口）
- `bye`（壳退出时优雅断开）

推送（daemon → 已连接客户端，事件经 DB 也可读，推送仅用于实时 UI）：
- `notify:task-started { id, title }`（活动中心「正在运行」）
- `notify:task-finished { id, status, summary }`

选型理由：Unix domain socket（macOS/Linux）/ named pipe（Windows）；JSON-RPC
与 MCP 同一传输风格；不引入 HTTP/端口占用问题（socket 文件放 DB 同目录
`scheduler.sock`，随 DB 生命周期自然清理）。

## 5. 壳端 ensure 逻辑（`ensureScheduler()`）

```
ensureScheduler():
  1. ping socket：通 → return（已有守护进程，直接通讯）
  2. 不通 → spawn detached appilot-scheduler（stdio 到日志，不随父死）
  3. 重试 ping（退避 ~3s 上限 10 次）：
     通 → return
     不通 → daemon 大概率因租约冲突自我退出（另一壳已拉活）→ 重 ping 已存在的
  （端侧只负责「确保有一个活守护进程」；双壳同时拉起的竞态由 daemon 的
    lease.acquire 仲裁——输家 exit(0)，赢家服务，壳最终 ping 到同一个）
崩溃恢复：壳 ping 失败（守护进程崩）→ 回到 1 重拉（调度状态在 DB，无缝续跑）
```

## 6. 退出与僵尸防护

- daemon 空闲判定：无客户端 `ping`/连接持续 `IDLE_TTL`（默认 2min，
  `APPILOT_SCHEDULER_IDLE_TTL_MS` 覆盖；设为 -1 = 永不空闲退出，供
  headless 服务器部署）→ 优雅退出。
- 双 daemon 竞争、daemon 崩溃、壳崩溃（未 bye 直接断连）都被心跳/租约覆盖，
  不留僵尸：socket 文件随进程退出清理；租约 TTL 自动过期。

## 7. 数据流与 UI 实时性

- 任务状态（lastRunAt/nextRunAt/status/summary/runCount）落 DB tasks 行——
  壳/agent/CLI/MCP 一律从 DB 读（现状已如此）。
- 「正在运行」实时性：守护进程推送 notify → 壳刷新活动中心；壳断开/重连期间
  以 DB 为准（可显示「运行中但未知进度」或轮询兜底）。

## 8. 迁移路径（里程碑，每步 PR + CI + 真机复核）

- **P0 本蓝图**（已做）
- **P1 M4-C1**：github-sync 执行统一到 DB 实例路径（Electron 调度也从 DB 拉
  github-sync 实例执行、写回 DB + release_cache）——验证「实例在 DB、执行不绑壳」
- **P2 M4-C2**：rank 高级语义 headless 化——rounds（进度圈）/暂停复核/加速在
  headless 实例/新表表达；Electron rank 执行接 DB 实例；富数据 reconcile 从
  product_records/meta 推导（不读 electron-store）
- **P3 守护进程包**：`@appilot-labs/appilot-scheduler`（daemon/server/protocol/
  ensure + 进程级单测：acquire 单例、双 spawn 竞争、空闲退出）
- **P4 壳接入**：DSH 先行（纯 server 侧：启动 ensure + 停壳内调度 tick）→
  Electron 后（旧 scheduler 退役、接 ensure + 心跳 + 事件刷新）→ 真机验证
  （Electron 关、DSH 开：调度继续由 daemon 执行；双端同时开：单 daemon；
  全关后 daemon 2min 自退无残留）
- **P5 清理**：electron-store `scheduledTasks`/`githubSyncCache` 退役；旧壳内
  租约身份（electron/dsh leaderId）退役；文档同步

## 9. 风险与决策点

- 依赖前置：P2（rank 语义 headless 化）是 daemon 能执行 Electron 任务的硬前置；
  P3/P4 在 P2 前只能跑 github-sync 类任务（可先作为「github-sync daemon」试点）。
- 通讯协议是否要事件推送（notify） vs 纯 DB 轮询：建议先 notify（活动中心
  实时性），失败回退 DB 轮询。
- 空闲 TTL 语义：个人单机默认 2min 自退；服务器部署设 -1 常驻。
- Electron 富数据仍须经 M3 双写留在 DB（daemon 不读 electron-store）——
  已满足；发布页 cache 已入 DB（M4-A ✓）。
