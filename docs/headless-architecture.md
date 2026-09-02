# Appilot Headless 架构（多薄壳收敛）

> 目标：**单一 Headless 核心包（SQLite 数据 + 租约调度）+ 多个薄壳（Electron / DSH / CLI / MCP）**。
> 核心能力全部由 npm 包完成；四个壳只是展示/入口外壳，操作同一份数据、同一份调度。

## 结构

```
                    ┌─────────────────────────────────────────────┐
                    │  共享 SQLite：~/Library/Application Support/  │
                    │  Appilot/appilot.db（WAL + 事务 + busy_timeout）│
                    │  projects / rank_snapshots / tasks / lease    │
                    └─────────────────────────────────────────────┘
                                        ▲
          ┌──────────────┬──────────────┼──────────────┬───────────┐
          │              │              │              │           │
   ┌──────┴─────┐ ┌──────┴──────┐ ┌─────┴──────┐ ┌─────┴─────┐
   │ Electron   │ │ DSH 插件    │ │ CLI        │ │ MCP       │
   │ (main)     │ │ (dsh-appilot)│ │ (headless- │ │ (mcp)     │
   │ registry-  │ │ tools + 任务 │ │ cli)       │ │ stdio     │
   │ sync/调度   │ │ + client UI │ │ 8 子命令    │ │ 7 工具    │
   └──────┬─────┘ └──────┬──────┘ └────────────┘ └───────────┘
          │              │
      @appilot-labs/appilot-headless  ←  store / service / lease scheduler / jobs
          │
      @appilot-labs/appilot-core  ←  纯业务函数（rank/git/release/readiness…）
```

## 数据一致性模型

- **单一事实源 = SQLite**（注册表 / 快照 / 任务状态 / 租约都在 DB）。
- **electron-store 过渡态**：Electron UI 仍读 electron-store 富数据（project 内嵌
  rankSnapshots / storeProducts / repo 等）。迁移分阶段，避免一次性大爆炸：
  - 注册表：双向同步（DB ←→ electron-store，10s 轮询 hydrate）；
  - rank 采集：**双写**（electron-store 供 UI + 共享 DB 供其余壳）；存量一次性幂等导入；
  - 任务调度：lease 表选主（仅主壳执行任务，主崩溃从者接管）——Electron 通过
    `scheduleGate()`，DSH 通过 headless `createLeaseScheduler` 内建租约。
- 多进程同时打开同一 DB：WAL 多读一写 + busy_timeout 等待写锁；headless 层事务包裹写。

## 壳状态一览（2026-09，master @ headless-phase4b）

| 壳 | 项目 | 快照 | 任务 | 租约 | 说明 |
| --- | --- | --- | --- | --- | --- |
| **DSH**（dsh-appilot 插件） | ✅ 共享 DB 读写 | ✅ 采集写 DB（productId=null） | ✅ 共享定义 buildHeadlessJobs + lease scheduler | ✅ 主 | agent 工具 + 客户端 UI |
| **Electron** | ✅ DB 双向同步（hydrate 10s） | 🟡 双写 DB（UI 仍读 electron-store） | 🟡 旧动态任务系统 + scheduleGate 租约门 | ✅ | 富数据过渡态 |
| **CLI**（headless-cli） | ✅ list/get/register/remove | ✅ latest 查询 | ✅ tasks list / run | —（显式触发） | JSON 输出 |
| **MCP**（appilot-mcp） | ✅ 4 工具 | ✅ latest | ✅ tasks list / task_run | —（显式触发） | stdio JSON-RPC |

## 真机验证清单（本仓库无法跑 Electron / 3099 服务端）

- [ ] Electron 启动：日志出现 `imported N rank snapshots to shared db`（存量迁移幂等）
- [ ] Electron 跑一轮 rank 任务后，`rank_snapshots` 增长（可用 CLI 查）：
      `appilot-headless snapshots latest <project> --product <productId>`
- [ ] DSH 侧（3099 重启后）：appilot 工具任务正常（共享任务定义生效）
- [ ] Electron 与 DSH 同时打开：任务只被租约主执行；关掉主后 ≤60s 从者接管
- [ ] CLI：`appilot-headless tasks list` 看到 DSH/Electron 写入的任务状态

## 剩余路线

1. **Phase 4c**：Electron IPC 瘦身 —— 数据域读取改走 headless service API，
   UI 从 DB 读 rank（移除 electron-store 富数据依赖，需真机验证大改）。
2. **Electron 任务系统**：旧动态任务（rank/github-sync 按产品拆分）若要与
   DSH 静态任务共用同一调度器，需先解决任务定义形态差异。
3. **DSH/Electron 双写去重**：若两壳都跑同一 rank 关键词，考虑按 productId 区分
   采集归属，避免同一词被双写两次（当前 DSH productId=null 与 Electron 维度隔离）。

## 关键包速览

- `packages/headless`：openStore（DDL v2：projects/rank_snapshots/tasks/lease + meta）、
  createHeadlessService（projects/snapshots/tasks 门面）、createLeaseScheduler、
  buildHeadlessJobs（release-sync / readiness 共享定义）、defaultDbPath/importLegacyRegistry。
- `packages/core`：纯业务函数（rank-collector / release-watcher / github-api / readiness-check…）。
- `plugins/dsh-common`：openSharedHeadlessStore（单例）+ sqliteProjectStore + 凭据读取。
- `plugins/dsh-appilot`：工具注册（注册/上下文/发布/趋势/任务/overview）+ 客户端 UI + 调度。
- `src/main`（Electron）：registry-sync（双向同步 + 租约门 + rank 导入）、rank-db-sync、scheduler。
- `packages/headless-cli` / `packages/mcp`：无壳 CLI / MCP 对接。
