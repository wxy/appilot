<!-- 中文版说明（仓库内提供）。English: [README.md](./README.md) -->
# @appilot-labs/appilot-headless-cli

直接对接 headless 服务 API 的命令行工具（项目 / 排名快照 / 任务 / 租约），
无任何壳依赖。与 Electron / DSH / daemon 读写同一共享 SQLite 数据库。

## 用法

```bash
# 打印共享数据库路径
appilot-headless db

# 项目注册表
appilot-headless projects list
appilot-headless projects get <name>
appilot-headless projects register <path> [--name <name>]
appilot-headless projects remove <name>

# 排名快照
appilot-headless snapshots latest <project> [--product <id>]
appilot-headless snapshots history <project> [--product <id>] [--keyword <kw>] [--limit <n>]
appilot-headless snapshots prune <project> [--before <iso>]   # 默认清 90 天前

# 任务与调度观测
appilot-headless tasks list [--source dsh|electron|cli|scheduler]
appilot-headless lease status          # 当前租约主
appilot-headless run <taskId>          # 显式触发
```

输出一律 JSON（stdout）；错误写 stderr 并以非零码退出，适合脚本 / agent 消费。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `APPILOT_DB_FILE` | 覆盖数据库路径（测试/隔离用） |
