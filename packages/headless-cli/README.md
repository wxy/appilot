# @appilot-labs/appilot-headless-cli

Appilot headless CLI —— 直接对接 headless 服务 API 的命令行工具（无任何壳依赖）。

与 Electron / DSH 共享同一 SQLite 数据库（`~/Library/Application Support/Appilot/appilot.db`），
可读写同一份项目注册表、排名快照与任务状态；可显式触发共享定时任务
（任务定义与 DSH 一致：`buildHeadlessJobs`，仅租约主执行，这里用独立 leaderId 显式触发）。

## 用法

```bash
# 打印当前共享数据库路径
appilot-headless db

# 项目注册表
appilot-headless projects list
appilot-headless projects get <name>
appilot-headless projects register <path> [--name <name>]
appilot-headless projects remove <name>

# 排名快照
appilot-headless snapshots latest <project> [--product <id>]
appilot-headless snapshots history <project> [--product <id>] [--keyword <kw>] [--limit <n>]

# 定时任务与调度观测
appilot-headless tasks list
appilot-headless lease status          # 当前租约主（多壳调度：DSH=主 或 electron=主）
appilot-headless run <taskId>          # release-sync | readiness
```

输出一律 JSON（stdout）；错误写 stderr 并以非零码退出，适合脚本 / AI agent 消费。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `APPILOT_DB_FILE` | 覆盖数据库路径（测试/隔离用） |
| `GITHUB_TOKEN` | GitHub API 凭据（release-sync 任务用；缺省走公开数据降级） |

## 开发

```bash
npm run build -w @appilot-labs/appilot-headless-cli   # tsc → dist
npx tsx tests/cli.test.ts                              # 端到端测试（隔离临时 DB）
```
