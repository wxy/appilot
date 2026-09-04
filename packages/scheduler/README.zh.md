<!-- 中文版说明（仓库内提供）。English: [README.md](./README.md) -->
# @appilot-labs/appilot-scheduler

App Store 任务调度守护进程：即使没有任何壳 UI 打开，也从共享 DB 持续运行
定时任务实例（github-sync / rank…），并与其他壳仲裁出唯一调度主。

## 亮点

- **Headless 常驻** — 无 UI 也能采集；支持 launchd `install` 保活
- **租约单主** — 仅租约主执行 tick；壳与 daemon 之间单例仲裁
- **Socket 控制面** — Unix socket JSON-RPC：status / runNow / accelerate /
  shutdown / checkUpdate（壳用 `ensureScheduler`，CLI 见下）
- **代码自更新** — 监控自身与 `headless`/`core` 的 dist；文件变化自动重启加载
  （部署后 ≤60s 生效）
- **韧性** — 403/429 限流指数退避与执行并发上限

## 安装与运行

```bash
npm i @appilot-labs/appilot-scheduler
# 启动守护进程（默认共享 DB）
npx appilot-scheduler
```

## CLI

```bash
appilot-scheduler            # 运行 daemon
appilot-scheduler status     # 当前调度主是谁
appilot-scheduler stop       # 经 socket 优雅停止
appilot-scheduler accel on|off [seconds]   # 临时加速清积压
appilot-scheduler checkUpdate   # 手动触发代码自检
appilot-scheduler install|uninstall   # launchd 保活（macOS）
```

## 壳内嵌入

```ts
import { ensureScheduler, defaultSocketPath } from '@appilot-labs/appilot-scheduler';
await ensureScheduler({ socketPath: defaultSocketPath(), timeoutMs: 3000 });
```

## 环境变量

| 变量 | 含义 |
| --- | --- |
| `APPILOT_DB_FILE` | 共享库路径 |
| `APPILOT_SCHEDULER_INCLUDE_RANK` | `0` 关闭 rank 执行器 |
| `APPILOT_SCHEDULER_UPDATE_CHECK_MS` | 代码自检周期（默认 60s） |
| `APPILOT_SCHEDULER_MONITOR_DIRS` | 覆盖监控目录（测试用） |

## 相关

- `@appilot-labs/appilot-headless` — 本守护进程驱动的数据与任务引擎
- 仓库文档：`docs/architecture-scheduler-daemon.md`
