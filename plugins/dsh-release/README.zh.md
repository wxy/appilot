<!-- 中文版说明（仓库内提供）。English: [README.md](./README.md) -->
# @appilot-labs/appilot-release

DeepSeek Harness（DSH）Appilot 插件族的发布域工具：GitHub 发布同步、
readiness 检查与商店文案工作流。

## 工具

| 工具 | 说明 |
| --- | --- |
| `sync_release_status` | 汇总 git tag 与 GitHub 发布 |
| `check_release_readiness` | 发布前 readiness 检查清单 |
| `get_release_draft` | 当前发布草稿 |
| `revise_store_copy` / `generate_store_copy` | App Store 文案 |

## 在 DSH profile 安装

```bash
npm i @appilot-labs/appilot-release
```

由元插件 `@appilot-labs/appilot` 消费。
