<!-- 中文版说明（仓库内提供）。English: [README.md](./README.md) -->
# @appilot-labs/appilot-core

App Store 运营领域纯函数库——被所有 Appilot 壳（Electron / DSH 插件 / CLI / MCP）共用，
自身不依赖任何壳或存储（持久化与调度在下层 `headless`）。

## 亮点

- **商店**：商店显示名与 语言→商店 映射（`/storefronts`）
- **排名采集**：App Store / iTunes 搜索排名采集（`/rank-collector`）
- **项目同步**：GitHub 发布检测与同步（`/project-sync`）
- **发布与文案**：readiness 检查、发布草稿、商店文案
- **评论**：评论统计 / 聚类辅助
- **AI 辅助与日志**：模型抽象与结构化日志（`/logger`）

## 安装

```bash
npm i @appilot-labs/appilot-core
```

## 用法（ESM 子路径导出）

```ts
import { storefrontDisplayName } from '@appilot-labs/appilot-core/storefronts';
storefrontDisplayName('us'); // -> '美国'

import { searchAppStoreRank } from '@appilot-labs/appilot-core/rank-collector';
const r = await searchAppStoreRank({ term: 'flashlight', country: 'us', trackId: '…' });

import { inspectProjectRelease } from '@appilot-labs/appilot-core/project-sync';
const insp = await inspectProjectRelease('/path/to/repo', { token });
```

## 相关

- `@appilot-labs/appilot-headless` — 共享 SQLite 数据 + 任务引擎（持久化）
- `@appilot-labs/appilot-scheduler` — 常驻调度守护进程
- 仓库文档：`docs/headless-architecture.md`、`docs/architecture-convergence.md`
