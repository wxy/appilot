<!-- 中文版说明（仓库内提供）。English: [README.md](./README.md) -->
# @appilot-labs/appilot-headless

共享数据与调度核心：单一 SQLite（`appilot.db`，WAL）+ 实例任务引擎 +
基于租约的单主调度。所有 Appilot 壳读写同一数据库、执行同一批任务实例。

## 亮点

- **单一共享库** — 默认路径 `~/Library/Application Support/Appilot/appilot.db`
  （可用 `APPILOT_DB_FILE` 覆盖）；WAL + busy_timeout 保证多进程安全
- **store 命名空间** — `projects`、`products`、`snapshots`、`tasks`、`lease`、
  `meta`（repo 状态）、`releaseCache`
- **租约单主** — `acquire / heartbeat / release`；心跳新鲜度决定接管；同 id 互斥
  防双 daemon；TTL 窗口由调用方传入（各壳统一 60s）
- **实例任务引擎** — DB 中 `kind + instance` 行（github-sync / rank…）由租约主通过
  注册执行器运行；内置 403/429 限流退避与执行并发上限
- **查询服务** — `createHeadlessService` 提供只读视图（任务、rank 进度…）
- **旧版迁移** — `importLegacyRegistry` 一次性导入旧 JSON 注册表

## 安装

```bash
npm i @appilot-labs/appilot-headless
```

## 用法

```ts
import { openStore, defaultDbPath } from '@appilot-labs/appilot-headless';
const store = openStore(process.env.APPILOT_DB_FILE || defaultDbPath());

store.lease.acquire('worker', 60_000);           // 成为主
store.lease.heartbeat('worker');                 // 主持续续租
store.projects.save({ name: 'demo', path: '/x', githubUrl: null, platform: 'ios',
  languages: ['en'], lastResolvedAt: new Date().toISOString(), artworkUrl: null,
  updatedAt: new Date().toISOString() });
store.tasks.upsert({ id: 'github-sync:demo', title: 'GitHub 发布同步', intervalMinutes: 60,
  lastRunAt: null, nextRunAt: new Date().toISOString(), lastStatus: 'never',
  lastSummary: null, runCount: 0, source: 'worker', kind: 'github-sync',
  instance: { projectName: 'demo', path: '/x' } });
store.snapshots.add([{ projectName: 'demo', productId: 'x:ios', keyword: 'kw',
  language: 'en', storefront: 'us', rank: 1, totalResults: 9,
  checkedAt: new Date().toISOString() }]);
store.lease.release('worker');
store.close();
```

CLI：`@appilot-labs/appilot-headless-cli`。

## 相关

- `@appilot-labs/appilot-scheduler` — 驱动本引擎的常驻守护进程
- 仓库文档：`docs/headless-architecture.md`、`docs/architecture-scheduler-daemon.md`
