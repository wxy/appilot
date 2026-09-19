# Appilot 代码审计报告

- **日期**：2026-09-18
- **范围**：整仓（src/main ~14k 行、src/renderer ~19.7k 行、packages/* ~14k 行、tests 47 个文件）
- **方法**：按区域（主进程安全 / 调度器 / 数据层 / AI 与发布 / 渲染层 / 测试与配置 / 架构）以不同视角实际读代码 + 运行日志 + 线上数据（appilot.db）佐证；安全发现按「单用户本地桌面工具」威胁模型校准严重度。

## 总体结论

代码库整体健康度**良好**：安全敏感面（shell/导航/密钥）有系统性防护，调度器租约设计正确，双存储失败降级有兜底，测试覆盖面广（47 个文件，handlers 相关测试分布合理），日志未发现密钥泄露。主要风险集中在三处：**渲染层没有任何错误兜底且错误可观测性失效**、**排名快照与数据库无限增长**、以及**零散的正确性地雷**（hooks 位于条件 return 之后）。

---

## 高（High）

### H-1 渲染层无 ErrorBoundary，且渲染错误可观测性失效
- **位置**：src/renderer/**（全局）；src/main/index.ts（console-message 转发）
- **证据**：全仓 grep `ErrorBoundary|componentDidCatch|getDerivedStateFromError` 零命中；主进程虽把渲染 console 转发到 electron-log（`[renderer]` 前缀），但 13 个日志文件（数月日常使用，含一次真实白屏事故）中 `[renderer]` 记录为 **0 条**——白屏发生时无任何痕迹可查。
- **影响**：生产环境任何未捕获渲染异常都会卸载整棵树 → 整窗白屏，用户只能重启，开发者无日志可定位。
- **建议**：① 根级与页面级 ErrorBoundary（展示错误摘要 + 「复制诊断信息」按钮）；② 在 preload/渲染层显式挂 `window.onerror` + `unhandledrejection`，写入 electron-log；③ 核实 Electron 43 `console-message` 事件签名（details 对象）与转发代码是否匹配。

### H-2 KeywordsPage 存在「条件 return 之后的 hooks」
- **位置**：src/renderer/components/keywords/KeywordsPage.tsx:280（`if (!project || !product) return …`）与 :918（`useRef` 等大量 hooks 在其后）
- **证据**：条件提前返回之后仍声明 `useRef`（leftScrollRef/rightScrollRef 等）。
- **影响**：加载态（projects 为空）与就绪态之间切换时 hooks 数量不一致，React 会直接抛错崩溃（"Rendered fewer hooks than expected"）。当前恰因数据先于路由就绪而未触发，属潜伏地雷；任何路由守卫调整都可能引爆。
- **建议**：把所有 hooks 移到条件 return 之前；或引入路由级 loading 守卫，保证挂载即数据就绪。

### H-3 排名快照与数据库无限增长
- **位置**：src/main/rank-db-sync.ts（双写）、src/main/db-admin.ts（仅 backup/VACUUM，无清理）、appilot.db
- **证据**：rank_snapshots 按「词 × 店 × 天 × 轮次」持续双写，无任何保留/降采样策略；appilot.db 已 **51MB**（约 3.5 个月），WAL 6MB；竞品快照、task 历史、AI 用量同样只增不减。
- **影响**：启动加载、备份耗时、磁盘占用线性恶化；renderer 内存中持有的 rankSnapshots 也随之膨胀（且已是勾选卡顿的历史根因之一）。
- **建议**：保留策略（如原始快照 180 天，超期降采样为天粒度聚合）；清理任务挂到调度器低峰档；DB 侧配套 `VACUUM`（db-admin 已有基建）。

---

## 中（Medium）

### M-1 迁移期备份文件长期留存，可能含敏感凭据
- **位置**：`~/Library/Application Support/Appilot/config.json.bak-2026-08-25-1`（5.5MB）、`config.json.bak-20260826-macos-ranks`（5.8MB）、`config.json.bak-20260826-reschedule`（3.8MB）、`config.json.migrated-*`（13MB）
- **证据**：这些是 JSON 时代（含 globalCredentials / projectCredentials；若当时 safeStorage 不可用则**明文** AI key）的全量快照，迁移验证后未清理。
- **建议**：迁移成功 N 天后自动删除；或迁移时跳过凭据键、单独走 safeStorage 迁移。

### M-2 AI「空内容」重试会重复计费
- **位置**：packages/core/src/ai/ai-provider.ts:114（attempt 循环）、运行日志实证（`AI returned empty content (attempt 1/3, finish_reason=length)` 后紧接着第二次完整请求并再次记账 141 completion tokens）
- **影响**：finish_reason=length 的空内容重试会为同一任务支付多次生成费用；批量场景（逐语言生成）下费用倍增。
- **建议**：区分重试类型——网络/5xx 可重试；length 截断应缩输出或直接失败，不建议原样重发。

### M-3 双存储镜像失败仅告警，存在静默分叉窗口
- **位置**：src/main/store.ts（`syncProjectsToDb` / `syncTasksToDb` 均 `log.warn` 后继续）
- **证据**：kv 写成功而 DB 镜像失败时，DSH/CLI/MCP 读到的 DB 数据与 UI 不一致；依赖 10s 轮询兜底自愈。
- **建议**：对连续镜像失败计数，超阈值后在 UI（任务中心/脉搏条）暴露「数据同步异常」；失败时考虑将 kv 写入推迟或重试队列。

### M-4 渲染层请求竞态防护不一致
- **位置**：OverviewPage（有 cancelled 标志 ✓）vs CopilotPage.loadSession / KeywordsPage 的若干异步加载（无 cancelled 检查）
- **影响**：快速切换项目/产品后，旧产品的异步结果可能后到并覆盖新状态（如 session/快照列表短暂显示错产品数据）。
- **建议**：统一「切换即失效」模式：effect 内 `let cancelled = false;` 并在 setState 前检查；或封装 useLatestAsync。

### M-5 L1 分诊区整条占位过重（布局反馈）
- **位置**：OverviewContent 分诊卡
- **说明**：单条信号（如「N 条帖子待发布」）占整宽横条，性价比低。已在本轮修复：该信号并入推广卡卡头徽标；分诊区只保留「有明确动作」的异常。

---

## 低（Low）

| # | 位置 | 问题 | 建议 |
|---|---|---|---|
| L-1 | src/main/url-policy.ts:16 | `file://` 导航无条件放行 | 生产可收紧为具体安装路径前缀 |
| L-2 | src/main/handlers/shell.ts:57 | `shell:revealInFolder` 接受任意已存在路径（仅 path.resolve） | 本地工具威胁模型下可接受；如收紧可限制在 userData 与已添加项目目录白名单 |
| L-3 | src/main/db-admin.ts:116 | `VACUUM INTO '${target…}'`（目标来自原生保存对话框） | 引号已转义、路径由用户自选，可接受；保持 dialog 来源即可 |
| L-4 | src/renderer/components/overview/ProjectActivityCard.tsx | 死代码：仅被注释引用，组件未被挂载 | 删除文件 |
| L-5 | ReleasePage(35) / TaskCenterPage(23) / KeywordsPage(22) | `as any` 热点 | 为 store/project 形状补类型，逐步清零 |
| L-6 | packages/core/src/ai/ai-provider.ts | safeStorage 不可用时密钥明文落盘（已是 documented tradeoff） | 文档保持标注即可 |

---

## 正面确认（审计中验证为做得好的）

- **shell 面**：`openExternal` 强制 http/https、App Store 内嵌窗口域白名单 + 导航守卫 + 弹窗外链兜底（handlers/shell.ts）。
- **密钥**：safeStorage 加密 + 三层解密兼容 +「疑似已加密不再二次加密」防呆 + .p8 内容哈希去重与 GC（credentials.ts、asc-key-file.ts）。
- **调度器租约**：TTL + heartbeat + **leader 进程存活判定**，避免陈旧锁死锁；reconcile 期望集对比只剪 rank 类任务，逻辑正确。
- **双写降级**：DB 镜像失败不阻塞主流程 + 轮询兜底（配合 M-3 的暴露建议）。
- **测试**：47 个测试文件，handlers 相关测试分布合理（projects 16 / release 9 / ops 7…）；未发现「空 catch 吞断言」式假通过。
- **日志卫生**：未发现密钥进入日志（grep 证实）。

---

## 修复优先级建议

1. **H-1** ErrorBoundary + 渲染错误上报（半天；直接消除「白屏无痕迹」）
2. **H-2** KeywordsPage hooks 前置（1–2 小时；消除崩溃地雷）
3. **H-3** 快照保留策略 + 清理任务（半天–1 天；遏制 51MB 持续增长）
4. **M-1** 清理迁移期备份（10 分钟）
5. **M-2** AI 空内容重试策略调整（1 小时；省钱）
6. **M-3/M-4** 镜像失败暴露 + 竞态防护统一（各半天）
