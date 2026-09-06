# 存储迁移：electron-store(config.json) → SQLite 单库

目标：Appilot 全部业务持久化收敛到 `~/Library/Application Support/appilot/appilot.db`
（SQLite，node:sqlite + WAL，Electron/DSH/CLI 共用同一文件），**退役 electron-store 与 config.json**。

## 现状（迁移前）

| 数据域 | 迁移前位置 | 备注 |
| --- | --- | --- |
| 注册表 / 产品注册 / repo 元数据 / rank 快照 / 任务实例 / 租约 / release 缓存 | `appilot.db`（结构化表） | 跨壳共享层，已是 SQLite |
| projects 富数据 / rankExecutions / scheduledTasks / schedulerRounds / 竞品 / ascCache / githubSyncCache / traffic / opsStatus / 凭据 / AI 设置 | `config.json`（electron-store） | 本壳唯一事实源，未入 SQLite |
| 凭据 | config.json（safeStorage 加密） | 密钥用 Electron safeStorage 加密后存值 |
| 旧注册表 | `registry.json`（遗留） | 启动时幂等导入 SQLite，文件未删除 |

## 路线（用户选定：先 KV 单库，再分阶段结构化）

- [x] **阶段一（本分支）：KV 单库落地**
  - headless schema v7 新增 `app_kv(key PK, value TEXT, updatedAt)` 通用键值表；
  - headless store 增加 `kv.get/set/delete`；
  - 主进程 `getStore()` 改由 `appilot.db` 的 `app_kv` 支撑，接口（get/set + projects 变更防抖同步注册表）不变；
  - 启动首次调用 getStore 时把旧 `config.json` 全量导入 `app_kv`，成功后改名归档为
    `config.json.migrated-<ts>`（保留一份可人工恢复），从此不再读取 config.json；
  - 卸载 electron-store 依赖（代码已无引用）；
  - 迁移逻辑抽为纯函数 `src/main/kv-migrate.ts`（无 electron 依赖）并由
    `tests/kv-migrate.test.ts` 覆盖（首次导入+归档 / 幂等 / 无 config / 损坏 JSON），
    已注册进 `npm test`。
- [ ] **阶段二：项目富数据结构化**——projects（storeProducts/trackedKeywords/rankSnapshots
      主副本/草稿/竞品关联）抽表并重写读写方（迁移完成前 UI 仍走 KV）。
- [ ] **阶段三：执行记录与调度**——rankExecutions / schedulerRounds / scheduledTasks 抽表
      （github-sync 已部分走 tasks 实例行）。
- [ ] **阶段四：竞品与缓存**——competitors / competitorSnapshots / competitorRankSnapshots /
      ascCache / githubSyncCache（release_cache 已在 DB）/ trafficSnapshots / opsStatus。
- [ ] **阶段五：凭据与设置**——globalCredentials/projectCredentials（safeStorage 加密值入库）、
      AI 设置默认值收口。
- [ ] **收尾**：删除 `registry.json` 与 `config.json.migrated-*` 归档说明、依赖清理、文档更新。

## 阶段一验证

- `tsc --noEmit`、headless 测试通过；
- kv 冒烟：app_kv 建表（schemaVersion=7）、set/get/delete、Unicode 与 JSON 往返正常；
- 启动应用后确认：`config.json` 被改名归档、数据仍在（排名/关键词/竞品/执行记录照常）。

## 回滚

阶段一不可逆点仅在导入成功后的改名归档；如需回退：把 `config.json.migrated-*` 改回
`config.json`，并在 `app_kv` 删除 `__kvMigratedFromConfigJson` 标记后，由旧版应用代码
（仍用 electron-store）继续读取。新代码不再包含 electron-store 读取路径。

## 阶段二设计（草稿：项目富数据结构化）

现状：`kv['projects']` 是 UI 项目列表的唯一事实源（含 storeProducts 的
trackedKeywords/rankSnapshots/草稿/竞品关联等），DB 侧已有 product_records /
project_meta / rank_snapshots / tasks 镜像。

目标形态（分步，每步可独立合并）：
1. **读侧切换**：`projects:list` 改为由 DB 组装项目视图 = projects 注册表 ∪
   product_records ∪ rank_snapshots(各产品) ∪ project_meta；electron `kv['projects']`
   降级为写缓存（双写期）。
2. **写侧切换**：`projects:add/updateSettings/saveTrackedKeywords/…` 直接写 DB
   结构化表（注册表 + product_records + snapshots），不再整对象写回 kv。
3. **逐产品收敛**：drafts（submissionKeywords/草稿）独立表或并入 product_records JSON 列；
   竞品表；rankExecutions 表。
4. **清理**：删除 `kv['projects']`，读/写路径全走 DB，移除 electron-store 残留。

回归矩阵（每步后）：tsc、headless 测试、projects:list 形状等价、调度不回归、
`npm run dev` 实测（项目/排名/发布/评论/趋势/设置页正常，删除项目不复活）。

## 完成状态（2026-09-06）

**目标已达成**：全部业务存储落在单一 SQLite 文件（`appilot.db`），electron-store /
config.json 已退役（config.json 归档为 `config.json.migrated-*`，electron-store 依赖已卸载）。

落地内容：
- 阶段一 KV：`app_kv` 表 + `getStore()` 改由 SQLite 支撑 + config.json 一次性导入归档（真实环境已验证）。
- 结构化表（与 app_kv 同库）：
  - 注册表 `projects`（v8 起含 electron id）、`product_records`（含 submission/removedKeywords 扩展列）、
    `project_meta`、`rank_snapshots`、`tasks`、`lease`、`project_release_cache`、
    `rank_executions`（v9，唯一 (ts,taskId)）、`project_blobs`（v11，竞品/流量/ASC 缓存/ops 状态等域）。
- 读侧切换（DB 优先 + kv 兜底）：`projects:list`（DB 组装）、任务中心 executions 统计、
  traffic/asc/竞品快照；项目删除级联清注册表/产品/快照/发布缓存/残留任务（demo 任务 bug 已修）。
- 双写：projects 写入 ≤300ms 镜像 DB；rank 执行记录双写；blob 域写入即镜像（含一次性导入标记）。

保留项（有意为之，同库 SQLite 内）：
- `app_kv` 仍承载少量域（scheduledTasks / schedulerRounds / readinessChecks / ascAnalytics /
  凭据(safeStorage 加密) / AI 设置 / 发布草稿等），作为通用键值兜底——它们已在 SQLite 单库内，
  不影响"单库 + electron-store 退役"目标。
- 跨壳调和（registry hydrate / rich / release / executions / tasks 镜像、DB→kv 回填）保留，
  用于 Electron ↔ DSH/daemon 一致性；日志仅在规模变化时打印。

可选后续（超出本目标，未实施）：调度引擎执行源彻底切 DB tasks、凭据/设置表化、app_kv 全量清空退役。

## 后续：彻底写切 DB（新工作流，逐步推进）

读已切 DB；写仍有多域先进 kv(app_kv) 再镜像。本步骤目标：写也直连结构化表，
移除 kv 写与镜像动作。
- [x] 地基：scheduledTasks / githubSyncCache 写后立即镜像 DB（≤300ms 防抖，
      不再依赖 10s 轮询）
- [ ] 调度引擎执行源切 DB tasks（engine 读写 tasks 表，退出 kv scheduledTasks）
- [ ] projects 各写 handler 直写 product_records/project_meta
- [ ] githubSyncCache 直写 release_cache（发布页读 DB）
- [ ] 移除三条镜像动作与轮询、清理 kv 对应键
