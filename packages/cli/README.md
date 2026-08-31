# appilot CLI

面向非 Harness 用户的独立入口：`appilot` 一条命令启动定制 Harness 发行版
（`dsh --profile appilot`，见 `profiles/appilot`）。

## 用法

```bash
appilot                # 启动 web 表层（默认端口 3080）
appilot --port 3099    # 换端口
appilot --help
```

环境变量：`APILOT_DSH`（dsh 路径）、`APILOT_PROFILE`（默认 appilot）。

## 说明

- 依赖 `@deepseek-ai/dsh`（npm 安装时自带 dsh 启动器）。
- profile 需已安装到 `$DSH_HOME/profiles/appilot`（见 profiles/appilot/README.md；
  发布阶段可由安装脚本自动完成）。
- 未来可加桌面壳（Electron/Tauri）包装本 CLI，成为真正的独立应用入口。
