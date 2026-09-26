# Appilot 整仓代码审查报告

- **日期**：2026-09-26
- **范围**：整仓（约 6.6 万行 TS：`packages/core` 154 文件、`src/main` 67、`src/renderer` 61、`packages/headless` 56、`packages/scheduler` 41、`plugins/dsh-*` 81、`packages/mcp` + `packages/headless-cli` + `packages/cli` 9；另含 tests/ 54 文件、CI/构建配置）
- **基线**：工作区状态（commit `d4209c6` + 未提交改动 32 文件 +1263/−465）
- **方法**：按 5 个区域（core / main+preload / renderer / headless+scheduler / plugins+MCP+CLI）并行深审 + 横切工程审查（测试体系、CI、依赖、配置）；关键结论做了运行验证（见附录 A）。安全发现按「单用户本地桌面工具」威胁模型校准严重度。

---

## 一、总体结论

代码库整体健康度**良好偏上**：安全敏感面（Electron 加固、shell/命令注入、SQL 参数化、凭据处理）有系统性防护且经核实基本无懈可击；调度器租约、迁移、测试门禁（typecheck ✅ / 全量 npm test ✅ / npm audit 生产依赖 0 漏洞 ✅）均绿。上轮审计（2026-09-18）的 H-1、H-3、M-2 已确认修复落地。

本轮新发现**无 Critical**，但有 **9 项 High**，集中在四类：

1. **数据正确性地雷**（最优先）：AI 流式重试产出拼接损坏的文案、release-watcher 把发布边界前的旧提交漏进素材、GitHub merged-PR 窗口静默漏 PR——三者都直接污染对外产出（商店文案/whatsNew/变更摘要），且用户不可感知。
2. **守护进程可用性**：Unix socket 控制面无鉴权、self-update 部署期崩溃循环、启动失败被误报为"让位成功"导致静默无人调度。
3. **自动化入口的破坏性命令缺防护**：MCP/CLI 的 `snapshots_prune` 一个非 ISO 参数即可删光项目全部快照，无确认无 dry-run；GitHub token 被设计为模型可见的工具参数。
4. **上轮已知问题未修**：KeywordsPage 条件 return 后 23 个 hooks（上轮 H-2），本轮确认了具体可复现的崩溃路径。

---

## 二、与 2026-09-18 内部审计的对照

| 上轮编号 | 状态 | 证据 |
|---|---|---|
| H-1 ErrorBoundary 缺失 | ✅ 已修复 | `src/renderer/main.tsx:3`（全局兜底 + unhandledrejection 上报）、`App.tsx:314`（页面级）、`ui/ErrorBoundary.tsx`（经 `app:reportError` 入 electron-log） |
| H-2 KeywordsPage 条件 return 后 hooks | ❌ **未修复** | 本轮确认仍有 23 个 hooks 位于 `KeywordsPage.tsx:296` 条件 return 之后（305–531 的 useMemo 链），且找到具体崩溃触发路径（见本轮 High-6） |
| H-3 排名快照无限增长 | ✅ 已修复 | `src/main/data-retention.ts`（pruneDatedRows + 可配置保留期，失败下次启动重试），清理节奏每日化（对应提交 fa185ef） |
| M-1 迁移备份长期留存 | ⚠️ 部分修复 | 保留期从无限缩至 14 天（`store.ts:86-90` 自注释），但**明文凭据仍存活两周**，见本轮 Low-main-2 |
| M-2 AI 空响应重复计费 | ✅ 已修复 | `ai-provider.ts:296-300`：length 截断只允许一次「加倍上限」重试（注意：同区域又发现新的流式累积 bug，见本轮 High-1） |
| M-3 镜像失败静默分叉 | ✅ 已修复 | 对应提交 1a4285d（审计 M-1~M-4 专项）；`data-sync-health` 模块 + 健康跟踪落地 |
| M-4 渲染层竞态防护不一致 | ⚠️ 部分修复 | CopilotPage 已有 sessionSeqRef 守卫（CopilotPage.tsx:379-394），但 **ReleasePage.loadReleases 漏改**（见本轮 High-9），CompetitorPanel 同样缺失 |

---

## 三、High（9 项）

### High-1 AI 流式重试时 content 跨尝试累积，产出拼接损坏的文案
- **位置**：`packages/core/src/ai/ai-provider.ts:119, 153, 190-218`
- **证据**：
  ```ts
  let content: string | null = null;         // L119：声明在 streamAttempts 内层循环之外
  content = (content || "") + delta.content; // L153：追加语义
  // L190-218: for (const attempt of streamAttempts) { try { await consumeStream(...) } catch { log.warn(...) } }
  ```
- **影响**：第 1 个流尝试中途失败（网络断/空闲超时 abort）后第 2 个尝试成功时，最终 content = 尝试1半截文本 + 尝试2完整文本，文案重复错乱且无告警，可能直接进入 App Store 商店文案/推广文案。`finishReason` 同样跨尝试残留，可能误触发截断加倍重试。非流式 fallback（L224-234）是赋值语义，安全。
- **修复**：每次 streamAttempts 迭代开始重置 `content = null; finishReason = undefined;`（或让 consumeStream 返回局部字符串，成功后统一赋值）。一行级修复，收益最大。

### High-2 release-watcher 多 frontier ref 的 git log 未全部套用发布边界，旧提交泄漏进素材
- **位置**：`packages/core/src/release-watcher.ts:289, 606-623`
- **证据**：
  ```ts
  const rangeArgs = since ? [`${since}..${endRefs[0]}`, ...endRefs.slice(1)] : endRefs; // L289
  // L606-623: frontierShas = [head, origin/<branch>, origin/master, origin/main]
  ```
- **影响**：`git log since..ref0 ref1` 的排除集只有 `since`——已用临时仓库实证：分叉线上的**边界前旧提交**被计入结果。当 origin/master 与 origin/main（或远端默认分支与本地分支）真实分叉（废弃分支、改写历史）时，旧提交混入 `material.commits` 喂给 AI 生成 whatsNew；`git diff --stat` 在 3 个 ref 时失败且被 `.catch(() => "")` 静默清空（L298）。MAX_MATERIAL_COMMITS=60 只缓解不消除。
- **修复**：对每个 frontier ref 分别构造 `since..ref` 收集后并集去重；或先求 frontier 并集 tip 再用单区间；diff 失败显式标记而非空串。

### High-3 Unix socket 控制面无任何鉴权，文件权限依赖 umask
- **位置**：`packages/scheduler/src/server.ts:135`（listen 后从未 chmod）、`server.ts:60-128`（所有 method 直接执行，无 token/peer 校验）、`daemon.ts:95-97`（socket 落共享目录）
- **证据**（已实测 Node/macOS 权限矩阵）：socket 权限 = 内核默认 & ~umask——umask 022 → 0755（仅 owner 可连）、**umask 002 → 0775（组内用户可连）**、Linux umask 000 → 0777（任意本地用户可连）。代码全程无 chmod。
- **影响**：能连上该 socket 的任何本地进程可执行 `shutdown`（杀死调度）、`runNow` 任意任务（驱动 iTunes/GitHub 请求）、`accelerate`（放大请求量、增加上游 403 风险）、`checkUpdate`（强制 daemon 自重启）。
- **修复**：listen 成功后 `chmod(socketPath, 0o600)`；macOS `getpeereid`/Linux `SO_PEERCRED` 校验对端 uid；进一步可在 hello 时校验壳写入共享区的一次性 token。

### High-4 runDaemon 一切启动失败均 exit(0)，ensure 误判为"让位成功"→ 静默无人调度
- **位置**：`packages/scheduler/src/cli.ts:211-218`（catch 后无条件 `process.exit(0)`）、`ensure.ts:107-108, 130-132`（`code===0 → gaveWay=true → return true`，不再 ping）
- **影响**：除单例让位外的任何启动失败（socket 被占且失败、DB 打不开、目录不可写、High-5 的启动期崩溃）都让壳侧 `ensureScheduler` 返回 true——UI 显示调度正常，实际无人调度，任务静默停摆。
- **修复**：用专用错误类型/哨兵退出码区分「仲裁让位」（exit 0）与「真实启动失败」（exit 1）；ensure 仅凭显式让位标记或 exit 0 + ping 复核判定成功。

### High-5 self-update 指纹采集 statSync TOCTOU → 部署期间 daemon 反复崩溃
- **位置**：`packages/scheduler/src/self-update.ts:50`；触发路径 `daemon.ts:371, 403-405, 355, 285`
- **证据**：
  ```ts
  for (const f of files) {
    const file = join(dir, f);
    if (!statSync(file).isFile()) continue;   // readdir 与 stat 之间文件被删即抛 ENOENT
  ```
- **影响**：覆盖式部署/npm ci 删除 dist 文件的瞬间，60s 周期检查抛未捕获 ENOENT → uncaughtException → `process.exit(1)`，daemon 反复崩溃重启、跳过 drain 与 lease release（有 pid 存活检测兜底，但存在服务空窗）。
- **修复**：statSync 包 try/catch 返回 null 跳过（与同文件 hashOfFile 的容错语义对齐）。一行修复。

### High-6 KeywordsPage 条件 return 后 23 个 hooks（上轮 H-2 未修），存在具体崩溃路径
- **位置**：`src/renderer/components/keywords/KeywordsPage.tsx:296`（条件 return）与 305–531（约 23 个 useMemo 在其后）
- **触发路径（本轮确认）**：停在 /keywords 且无项目（渲染早退分支）→ 左侧栏点「添加项目」（App.tsx:49-53 的 handleAdd 不跳转路由）→ project 变为非空 → hook 数量不一致 → React 抛错，被页面级 ErrorBoundary 捕获变错误卡片；对称地，在 /keywords 上删除当前项目同样崩。
- **修复**：全部派生 useMemo 移到早退之前（memo 内做空值守卫），或抽 `<KeywordsView>` 子组件承载派生逻辑，外层只判空。

### High-7 snapshots_prune 的 `before` 参数零校验，一次调用可删光项目全部快照
- **位置**：`packages/mcp/src/mcp.ts:175-179`、`packages/headless-cli/src/cli.ts:231-238`、`packages/headless/src/store.ts:518-524`
- **证据**：
  ```ts
  removed: svc.snapshots.prune(String(a.project), String(a.before)),   // mcp.ts:178
  .prepare('DELETE FROM rank_snapshots WHERE projectId = ? AND checkedAt < ?')  // store.ts:522，TEXT 字典序比较
  ```
- **影响**：`before` 传 `"z"`/`"~"`/`"9999"` 等大于任何 ISO 日期的字符串即删光该项目全部排名快照并返回成功；MCP 场景下模型一次 tools/call 即可触发，无确认、无 dry-run、不可恢复；未知项目名则静默 `removed:0`。
- **修复**：入口严格校验 ISO（`Number.isFinite(new Date(before).getTime())`）；加 `--dry-run`（只 count）；单次删除超存量 50% 需显式 `force:true`；未知项目名抛错。

### High-8 GitHub token 被设计为模型可见的工具参数，与本仓库自身防泄漏策略矛盾
- **位置**：`plugins/dsh-release/src/sync-release-status.ts:25-29, 41`、`plugins/dsh-appilot/src/overview.ts:104-108, 122`
- **证据**：
  ```ts
  token: { type: 'string', description: '... avoid passing secrets in the conversation.' },
  const token = args.token || (await reader('GITHUB_TOKEN')) || null;
  ```
- **影响**：描述一边劝阻一边接受 token；模型一旦走此参数，GitHub PAT 落入会话转录/持久化存储/日志。`generate_store_copy.ts:42-44` 明确写了「工具参数对模型可见」并拒绝接收 apiKey——同仓库两套标准。
- **修复**：删除 `token` 参数，统一走 credentials reader，与 generate/revise 工具对齐。

### High-9 ReleasePage.loadReleases 无过期响应守卫，旧响应覆盖新响应
- **位置**：`src/renderer/components/release/ReleasePage.tsx:234-355`（await 后无条件 setState）；并发入口：产品切换 effect 359-373、data-changed 监听 381-407、手动刷新 1408、handleCreateNew 1021
- **影响**：快速切换产品 A→B 时 A 的慢响应后到，会以 A 的 releases/selectedTag/viewMode 覆盖 B 的状态（页面标题是 B、数据是 A）。同类问题 CopilotPage 已修（sessionSeqRef，审计 M-4），本文件漏改。
- **修复**：引入 loadSeqRef，await 后 `if (seq !== loadSeqRef.current) return;` 再 setState；`finally` 的重置同样过守卫。

---

## 四、Medium（按区域）

### packages/core
| # | 位置 | 问题 | 要点 |
|---|---|---|---|
| M-C1 | `github-api.ts:279-309` | merged PR 窗口漏 PR | `sort=updated` 分页但按 `merged_at` 过滤，只扫最近更新的 300 个 PR；cutoff 后合并但此后无更新的 PR 被静默挤出窗口。改用 `search/issues merged:>=cutoff` |
| M-C2 | `asc-api.ts:135/146/167-170/189/204/207` | 列表端点固定 limit=50/10，无分页无排序 | 大应用数据静默截断；`/builds` 无 `sort=-uploadedDate`，「最新构建」匹配可能命中旧构建导致状态误报（build-status.ts:61-63） |
| M-C3 | `errors.ts:35-61` vs asc/rank/github 客户端 | 错误契约分裂 | ApiError.retryable 只有 AI 模块在用；上层被迫正则匹配中文错误文案（rank-collector.ts:106）；github 全静默降级，限流与「无 release」不可区分 |
| M-C4 | `app-store-discovery.ts:392, 427, 457` | 三处 fetch 无超时（全库唯一）+ L392 trackId 未编码 | 可挂起分钟级拖住 Electron 主进程；复用统一 fetchWithTimeout |
| M-C5 | `competitor-radar.ts:262, 276-284` | 采集失败记为 rank=null，与「真实未上榜」不可区分 | 整批共用一个 checkedAt；`.catch(() => null)` 的 null 进入历史后，evaluatePause（rank-keywords.ts:76-107）会把采集故障误判为关键词失效；与 collectKeywordRankings（失败不落快照）语义不一致 |

### packages/headless + packages/scheduler
| # | 位置 | 问题 | 要点 |
|---|---|---|---|
| M-S1 | `headless/scheduler.ts:633-644, 454-471, 733-746` | 接管/丢主窗口跨进程重复执行 | 心跳失败后旧主在途任务继续 + nextRunAt 执行完才推进 + runNow 不查 leader；rank 快照 INSERT 无唯一约束 → 重复数据点。执行前 DB CAS 抢占 nextRunAt |
| M-S2 | `headless/store.ts:17, 31-33, 206-225` | 同步 SQLite + Atomics.wait 忙等，最坏 ~31s 冻结 daemon | 3×(10s busy + 退避)。降低 busy_timeout、设总预算、大扫描移出 tick 热路径 |
| M-S3 | `headless/schema.ts:266-268, 287-289` | 迁移非原子（仅 v14 有事务）+ 并发 check-then-ALTER 竞态 | 两进程同时冷启第二者抛 duplicate column（非 busy 错误）。migrate 外层 `BEGIN IMMEDIATE` + duplicate-column 容错 |
| M-S4 | `headless/store.ts:188-198`、`paths.ts:13-26` | DB/WAL/SHM 与数据目录从未 chmod | umask 宽松的机器上其他本地用户可读用户数据。db 0600、目录 0700 |
| M-S5 | `scheduler/ensure.ts:98-107` | spawn 无 'error' 监听 | spawn 路径失效时壳（Electron 主进程）uncaught exception。补 error 处理走降级返回 false |
| M-S6 | `scheduler/server.ts:48-58, 142-147` | socket 无行长上限/连接数上限/写背压 | 本地进程可内存 DoS daemon |
| M-S7 | `scheduler/control.ts:39` | controlStatus 回退忽略调用方 dbPath | 自定义 DB 时 leader 判定读错库 |
| M-S8 | `scheduler/cli.ts:26-44` + 218 | launchd KeepAlive=true 与让位 exit(0) 组合空转重启循环 | 改 `SuccessfulExit = false` 或专用让位退出码 |
| M-S9 | `scheduler/signals.ts:14-27` + `daemon.ts:375-378` | SIGHUP 在 30s 防抖窗内被静默永久丢弃 | 部署脚本常用 SIGHUP；冷却路径应安排补跑 |

### src/main + preload
| # | 位置 | 问题 | 要点 |
|---|---|---|---|
| M-M1 | `handlers/ai.ts:10-16` | AI key 解密后明文回传渲染层 | 与 GitHub token 掩码标准不一致；改掩码 + hasApiKey（saveConfig 已支持留空不覆盖） |
| M-M2 | `handlers/ai.ts:29` + `ai-service.ts:12-15` | aiProviderUrl 无校验 → key 外带链 | 渲染层改 providerUrl 后，主进程把真 key 发往攻击者服务器（apiKey 空值不覆盖旧值的组合）。saveConfig 走 safeHttpUrl httpsOnly |
| M-M3 | `handlers/ai.ts:39-61` | 主进程代理 fetch 任意 URL（SSRF/CORS 绕过） | 错误分支回显远端响应体前 200 字符，可作内网 oracle；与 M-M2 同一入口修 |
| M-M4 | `handlers/release.ts:267-275` | screenshotImagePreview 任意路径图片读取 | 现成图片窃取原语；限会话已选文件集合或 userData 白名单 |
| M-M5 | `url-policy.ts:21` | will-navigate 对任意 file:// 全放行 | 纵深防御缺口；收紧为 app renderer 目录前缀 / dev origin |

### src/renderer
| # | 位置 | 问题 | 要点 |
|---|---|---|---|
| M-R1 | `stores/project.ts:489-497` | updateTrackedKeywords 只写顶层 legacy 池不写 storeProducts | 状态双源不一致；复用现成 updateProduct() helper（对照 499-513 正确写法） |
| M-R2 | 12 个组件裸调 `useProject()` + `stores/project.ts:579-587` | 无 selector 全量订阅 + 逐快照全量替换数组 | 加速采集期（一轮数十次推送）全局重渲染风暴；改 selector 订阅 + 写侧 500ms-1s 合并 |
| M-R3 | `components/keywords/CompetitorPanel.tsx:284-298, 328-347` | 取数无过期守卫 | 快速切换项目/产品后旧响应覆盖新状态 |
| M-R4 | `components/tasks/TaskCenterPage.tsx:435-436` | 派生未 memo | 加速倒计时每秒全量重算 groupTasks + TaskSection 内再排序 |
| M-R5 | `TaskCenterPage.tsx:1386-1399`、`ReleasePage.tsx:220-232`、`CopilotPage.tsx:646-669` | 多个用户动作静默失败（无 catch） | 「立即运行」失败无任何提示；接入现成 error/failMsg 容器 |
| M-R6 | `App.tsx:232-234` + `stores/project.ts:412-432` | 初始项目加载失败 = 无提示假空态 | load() 无 catch 无 error state；区分「加载失败」并提供重试 |

### plugins / MCP / CLI
| # | 位置 | 问题 | 要点 |
|---|---|---|---|
| M-P1 | `packages/mcp/src/mcp.ts:66-222, 235-237, 25` | 声明 inputSchema 但运行时零校验；非法 JSON 静默忽略；不支持 batch | `path:{}` 注册出 "[object Object]"、空名可注册；zod 校验 + -32700/-32602 + 行长上限；SERVER_INFO 版本 0.1.0 与 1.2.0 漂移 |
| M-P2 | `headless-cli/src/cli.ts:54-85` | --help 契约错误 + 先开 DB 后校验参数 | 任何调用（含 --help）都先创建/迁移 SQLite；usage 走 stderr/exit 2 违反 GNU 约定 |
| M-P3 | `scheduler/control.ts:49-56` + cli/mcp 调用方 | controlRunNow 的 'local' 回退可能双跑 | socket 可达但超时时错误文本不含 'socket' → 本地再跑一次，与 daemon 并发。仅 ENOENT/ECONNREFUSED 才回退 |
| M-P4 | `dsh-common/registry-file.ts:42-59, 91-102` | readRegistry 吞错后写回清空整个注册表（潜伏） | JSON 损坏时 save() 抹掉全部项目；已发布 npm 包的公开 API。ENOENT 才当空表，其余拒写 |
| M-P5 | `dsh-appilot/overview.ts:212-220`、`register-project.ts:29` | 工具描述与实际副作用不符 | overview 隐藏写 rank_snapshots、register 隐藏 iTunes 网络调用；副作用写入 description + persist 开关 |
| M-P6 | `dsh-appilot/tasks.ts:106-111` vs `mcp.ts:218` | 错误当成功返回，三入口三种错误形态 | DSH 侧 `{error}` 是 200 语义；统一 throw 由宿主转 isError |
| M-P7 | `mcp.ts:206, 218, 47-54` | task_run 错误提示与实际能力说反 | 实际本地支持 release-sync/readiness，提示却说 github-sync |

---

## 五、Low（合并清单，每条一行）

**core（10 项）**：7 个模块级 TTL Map 只读判过期从不删除（github-api.ts:44-63 等，无界但量级小）· `base=${base}` 未编码 + owner/repo 不校验字符集（github-api.ts:282、git-info.ts:76-81，自伤型）· 上游 200 响应 JSON.parse 无守卫 9 处 · `ProjectReleaseState` 接口完整重复声明两次靠 merging 静默通过（project-sync.ts:22-38 与 134-150，删一份）· 重复实现：匿名重试块×4、tokenTag 内联×2、fetchWithTimeout×3、**STOREFRONT_NAMES 两份且已漂移**（app-store-discovery.ts:48 缺 be/cl）、LANGUAGE_NAMES×2 · index.ts 公共入口仅导出 4 组模块 · feedback-inbox 只取第一页 100 条 · git maxBuffer 1MB 静默空结果（git-info.ts:32）· syncLocalRepo 对干净工作树做 ff-merge 与「仓库只读」叙事冲突（release-watcher.ts:224）+ mainLineTags 最坏 ~80 个串行 git 子进程 · JSON 修复正则兜底可能改写字符串值内模式（ai-request.ts:80-82）

**scheduler/headless（10 项）**：任务事件 broadcast 是死功能（server.ts:40,142-147 定义，daemon 全文无调用）· launchd plist XML 拼接未转义 + `launchctl load` 已弃用（cli.ts:26-44）· 日志「轮转」是 truncate 清空丢全部历史（cli.ts:71-76）· ensure 让位分支凭空建库（ensure.ts:113-117）· pid 复用影响存活检测（store.ts:700-710，TTL 兜底）· 路由判断依赖错误文案子串 'socket'（control.ts:56）· 每 tick 全量 tasks.all + JSON.parse、无 nextRunAt/kind 索引（scheduler.ts:584-591）· Windows 下 socket listen 会失败（提示性）· hello client 字符串可伪造日志行（daemon.ts:242-243）· accelOffTimer 未 unref

**main（10 项）**：.p8 副本未 chmod 0600（asc-key-file.ts:48，已抽查确认）· config.json 迁移产物含明文凭据留 14 天（kv-migrate.ts:54-55）· osascript 脚本写可预测 /tmp 路径（keynote-automation.ts:198,343，TOCTOU）· projects:testAscKey 任意路径可读性 oracle（projects.ts:814-823）· saveCredentials 可拷任意文件伪装 .p8（projects.ts:716-722）· daemonStop 无强杀兜底（scheduler.ts:460-462）· 日志按启动日固定文件名跨天不滚动（logger.ts:40-41，长驻壳下轮转失效）· app:reportError 未清洗即入日志可伪造堆栈（diagnostics.ts:13-19）· safeStorage 不可用时明文落库回退无 warn（credentials.ts:12）· preload 参数全 any 无尺寸上限（index.ts 多处）

**renderer（5 项）**：主题持久化值未白名单校验（stores/theme.ts:22，脏值后暗色永久失效）· OverviewContent 分诊列表 index 作 key（OverviewContent.tsx:1037）· recharts Tooltip 全 any（KeywordsPage.tsx:397、matrix.tsx:51,107）· onBriefProgress 未按产品过滤（CopilotPage.tsx:403-408）· AI 用量 30s 轮询不随可见性暂停（App.tsx:263）

**plugins/MCP/CLI（11 项）**：client.js 生成产物被提交进 git 与源码可漂移（plugins/dsh-appilot/client/）· 工具错误文本携带 DB 绝对路径（mcp.ts:279,287 等；凭据面已核对干净）· resolve_current_project 对 args 无防御（resolve-current-project.ts:32）· parseArgs 无法表达布尔 flag/吞 -- 值 + tasks 分支重复解析（cli.ts:42-50,220-246）· 项目同名静默覆盖 + 空名可注册（register-project.ts:27-30、mcp.ts:99-100）· MCP projects_remove 浅删除留孤儿数据（mcp.ts:120，store 已有 removeDeep）· /appilot task clear 清不掉 legacy 统计的 error（commands.ts:110 vs 57-76）· releaseFromGit versionTag≠tags[0] 时元数据错配（generate-store-copy.ts:20-39）· bin/appilot.js PATH 仅按 ':' 解析（Windows 失效）· openSharedHeadlessStore 单例忽略后续 dbPath（sqlite-store.ts:25-31）· AI 凭据环境变量两套口径（overview.ts:262-268 vs generate-store-copy.ts:85-93）

---

## 六、工程与测试体系（横切审查）

### E1【高】6 个测试文件是「孤儿」——存在但从不被执行
`npm test`（根 package.json:14）手工枚举了 48 个 `tsx tests/*.test.ts`，而 tests/ 下实际有 **54 个**测试文件。以下 6 个不在脚本中、也无任何其他引用（CI/脚本/文档均未提及）：

- `tests/scheduler-engine.test.ts`（测 src/main/daemon-manager 的调度状态派生——核心逻辑）
- `tests/scheduler-fingerprint.test.ts`
- `tests/data-sync-health.test.ts`
- `tests/competitor-intel.test.ts`
- `tests/competitor-advantage.test.ts`
- `tests/store-product-scope.test.ts`

已逐一手工运行：**6 个全部 PASS**——即它们是健康测试，只是被脚本维护遗漏，CI 对这部分代码零覆盖。这正是手工枚举式 test 脚本的必然结果：每新增一个测试文件都要记得改根 package.json。

### E2【中】测试架构：无统一运行器
- 根脚本 2149 字符、48 个 tsx 串行调用、56 个 `&&`；workspace 级测试用 `tsx tests/*.test.ts` glob 或 for 循环。
- 断言为手写 assert + console 输出（抽查 task-cleanup、scheduler-engine 等，断言质量尚可、非空跑），但：无并行、无覆盖率度量、失败定位靠顺序滚动输出、新增文件靠人肉登记（见 E1）。
- **建议**：收敛到 vitest（或至少 node:test + glob），一步消除 E1 类遗漏并获得并行与覆盖率。

### E3【中】无任何 lint/format 工具链
全仓无 ESLint/Biome/Prettier 配置（仅 tsc strict + noUnusedLocals/Parameters）。`react-hooks/exhaustive-deps` 与 hooks 规则检查缺位，正是 High-6 这类 hooks 违规能存活到今天的原因。tsc 也未开 `noUncheckedIndexedAccess`。建议引入 Biome 或 ESLint(typescript-eslint + react-hooks + react-refresh)，先 warn 后逐步清零。

### E4【低】依赖管理
- `electron-vite: "latest"`（package.json:43）——锁文件虽锁定，但任何重新解析（如删 lockfile、新贡献者 `npm update`）都会拉入未验证版本；应固定为 `^x.y.z`。
- 无 dependabot/renovate 配置（CLA allowlist 里预留了 dependabot 但 .github/ 下无 dependabot.yml）；生产依赖 `npm audit` 0 漏洞。
- packages/cli 是三文件的纯启动器（无测试脚本），README 命名（headless-cli 为 CLI）与目录名（cli vs headless-cli）易混淆，文档已自洽但可读性欠佳。

### E5【中】CI/发布门禁缺口
- ci.yml / build.yml 无 `concurrency` 组（同分支连续 push 会排队跑完全套）；typecheck/test 两 job 在两个 workflow 中重复（注释已声明是有意为之，可接受但需人工保持同步）。
- publish.yml：tag 推送直接触发 9 包顺序发布，**该 workflow 内无 typecheck/test 前置门禁**（依赖 master push 的 build.yml 事后验证）；tag 可以从任意 commit 打出。建议 publish 前置 `npm ci && npm run typecheck && npm test` 或要求 tag 必须指向已绿 commit。
- actions 多数按 `@v5` tag 引用（cla.yml 按 SHA 锁定是标杆做法）；publish.yml 权限最小化（contents:read + id-token:write）+ OIDC Trusted Publishing + provenance，做得好。

### E6【中】工作区当前状态
- 工作树有 32 个文件未提交（+1263/−465），且 **`build/entitlements.mac.plist` 与 `build/entitlements.mac.inherit.plist` 在工作树中被删除但 electron-builder.yml:25-26 仍引用**——当前状态下 `npm run dist:mac` 会失败。应尽快提交或还原，避免后续构建混淆。
- 本轮审查基于该工作树状态；typecheck 与全量测试均在当前状态跑绿（见附录 A）。

---

## 七、正面确认（审查中验证为做得好的）

- **Electron 加固**：全部窗口 contextIsolation:true / nodeIntegration:false / sandbox:true；setWindowOpenHandler 一律 deny + safeHttpUrl 外开；IPC 全部 ipcMain.handle；无 executeJavaScript/webSecurity 降级。
- **命令注入面基本封死**：src/main 唯一子进程调用点 keynote-automation.ts 全部 execFile + 固定二进制 + 数组 argv；AppleScript 插值有专用转义函数（先转反斜杠）；未转义的 sampleSlideNumber 被 `Number()>0` 强制。core/git 同样全部 execFile 数组参数。
- **凭据处理**：GitHub token 回传渲染层已掩码、缓存键一律 sha256(token) 前缀；日志全仓无 token/key 输出（多轮 grep 证实）；.p8 哈希去重与 GC。
- **renderer XSS 面**：无 dangerouslySetInnerHTML/rehype-raw/skipHtml；AI Markdown 链接白名单化为主进程 openExternal；react-markdown 默认 urlTransform 兜底。
- **调度器核心设计**：租约事务内 CAS + pid 存活检测防双主（有回归测试）；v14 迁移完整事务 + 回滚；调度纯间隔毫秒制免疫时区/DST；过期任务合并补跑无风暴；优雅退出顺序正确（先摘 socket 路径再 close）。
- **数据层**：SQL 全参数化（core 仅一处 SQL）；重试全部有界收敛（rank 429 三次退避、AI 截断一次加倍、git 单次重试）。
- **iTunes Search 节流**：FIFO 串行 + 403 熔断级别化冷却，设计完善。
- **测试与门禁现状**：typecheck ✅、全量 npm test ✅（含 CLI/MCP 端到端）、生产依赖 audit 0 漏洞。
- **文档与仓库卫生**：架构文档齐全且与实现基本一致（README 9 包发布与 publish.yml 逐一对应）；密钥文件（.release.env 0600、.secrets/）均被 gitignore 且未被追踪；上轮审计 H-1/H-3/M-2/M-3 的修复认真落地且带回归测试。

---

## 八、修复优先级 Top 10

| # | 项 | 预估 | 为什么先做 |
|---|---|---|---|
| 1 | High-1 AI 流式重试 content 累积（ai-provider.ts:119） | 一行 | 直接污染对外商店文案，用户不可感知 |
| 2 | High-7 snapshots_prune 参数校验 + dry-run（mcp.ts/cli.ts/store.ts） | 半天 | 唯一「一次调用、不可恢复」的数据丢失路径 |
| 3 | High-3 socket chmod 0600 + 对端 uid 校验（server.ts:135） | 小时级 | 唯一的安全暴露面，改动小收益大 |
| 4 | High-4 让位/失败退出码区分（cli.ts:218 + ensure.ts） | 半天 | 消除「显示正常但无人调度」的静默停摆 |
| 5 | High-5 statSync 容错（self-update.ts:50） | 一行 | 消除部署期 daemon 崩溃循环 |
| 6 | High-6 KeywordsPage hooks 前置（上轮遗留） | 1-2 小时 | 消除可复现崩溃路径 |
| 7 | High-2 frontier 边界泄漏（release-watcher.ts:289） | 半天 | 已实证污染 whatsNew 素材 |
| 8 | E1+E2 测试收敛到统一运行器（顺带收编 6 个孤儿测试） | 1 天 | 根治测试盲区；否则同类遗漏会重复发生 |
| 9 | High-8/9 + M-M1~M5 安全一致性批次（token 参数、ReleasePage 守卫、AI key 掩码、providerUrl 校验、file:// 收紧） | 1-2 天 | 都是模式明确的小改动，可一个 PR 完成 |
| 10 | E3 引入 lint（react-hooks 规则） | 半天 + 清理 | 防止 High-6 类问题再次进入代码库 |

---

## 附录 A：运行验证记录

| 验证 | 结果 |
|---|---|
| `npm run typecheck` | ✅ exit 0 |
| `npm test`（全链，含各 workspace 与 CLI/MCP 端到端） | ✅ exit 0 |
| `npm audit --omit=dev` | ✅ 0 vulnerabilities |
| 6 个孤儿测试逐个运行 | ✅ 全部 PASS（证明是覆盖盲区而非坏测试） |
| main 进程抽查（ai.ts getConfig 明文 key、url-policy file:// 放行、release.ts 任意路径预览、asc-key-file.ts 无 chmod） | ✅ 逐条与源码比对属实 |
| release-watcher frontier 泄漏 | 子代理用临时 git 仓库构造分叉场景实证 |
| socket 权限矩阵 | 子代理在本机 Node 实测 umask 022/002/000 三档 |

## 附录 B：审查覆盖与方法

- **packages/core**（154 文件）：全部 33 个 src 文件精读 + 危险模式 grep（JSON.parse 无守卫、空 catch、URL 拼接、console 直用）+ git 语义临时仓库实证。
- **src/main + preload**（67 文件）：index/ipc 安全配置、handlers/ 全部 11 个、credentials/keynote-automation/daemon-manager/hup-restart/asc-key-file/db-admin 精读；exec/spawn/osascript/openExternal/executeJavaScript/fs 调用点全量核对。
- **src/renderer**（61 文件）：XSS 面全仓 grep、IPC 封装、zustand 订阅、定时器/监听器清理、最复杂页面（Keywords/Release/TaskCenter/Overview/Copilot）精读。
- **packages/headless + scheduler**（24 src 文件，~4900 行）：SQL/迁移/租约/调度引擎逐行精读 + socket 权限与模块格式实测。
- **plugins/dsh-*(4) + mcp + headless-cli + cli**：全部 9 个 MCP 工具、13 个 DSH 工具、CLI 全部子命令的「输入→副作用」路径逐一核对。
- **横切**：tests/ 54 文件与 test 脚本交叉比对、CI 4 个 workflow、构建配置、依赖健康、上轮审计修复核验。
