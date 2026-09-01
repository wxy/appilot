# Appilot 插件安装方式（正确方法，不修改官方 profile 定义）

> 原则（2026-08-31 修正）：**绝不修改 `dsh.profile.bundles`**（那是官方 profile 定义，
> 改动会在 dsh 升级/重装时出问题，也有安全风险）。插件应作为**树外依赖 + 用户层
> patch 行**启用，或使用**独立自定义 profile**。

## 方式一：独立自定义 profile（推荐，零风险隔离）

`dsh --profile appilot` —— 完全不碰官方 web profile。

```bash
# 1. 创建 profile（bundles 保持官方：dsh-base + dsh-web-app）
mkdir -p ~/.dsh/profiles/appilot
# 2. package.json：dependencies 记录树外插件依赖（file: 本地路径；发布后改 registry 版本）
#    dsh.profile.bundles = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]（不动）
# 3. 用户层 cordis.patch.yml 启用插件：
#    - insert:
#        - id: appilot
#          name: '@appilot-labs/appilot'
# 4. 安装依赖
cd ~/.dsh/profiles/appilot
# ⚠️ 必须 --omit=peer：npm 默认自动装 peer，会把整套 @deepseek-ai 运行时复制进
# profile node_modules（双份 cordis），导致 preset 挂载失败、模型列表载不出来。
npm install --no-audit --no-fund --install-links --omit=peer

# ⚠️ 本地未发布阶段：官方 `dsh plugin --profile appilot add <pkg>`（pnpm）不可用——
# 私有 @appilot-labs/* 包 pnpm 无法从 registry/workspace 解析（pnpm workspace 不支持
# 根外路径，file: 传递依赖仍走 registry）。npm 因 file: 宽松链接私有依赖才可用。
# 发布到 npm 后（解锁官方模式）：
#   dsh plugin --profile appilot add @appilot-labs/appilot
# 5. 启动
dsh --profile appilot --port 3099
```

已在本机验证：`--dump-config` 显示 appilot 行来自 `cordis.patch.yml`（用户层），
启动 HTTP 200，`/plugins/@appilot-labs/appilot/client.js` 正常服务。

## 方式二：装进官方 web profile（用户层启用，settings 可管理）

**不动 `dsh.profile.bundles`**，用官方插件机制：

```bash
# 1.（先备份）
scripts/dsh-profile-backup.sh web

# 2. 安装插件包到 profile node_modules（官方命令，转发 pnpm）
dsh plugin --profile web add @appilot-labs/appilot          # 发布后：npm registry 包名
#    本地开发（未发布）：
cd ~/.dsh/profiles/web && npm install --no-audit --no-fund --install-links --omit=peer

# 3. 在用户层启用（web profile 自己的 cordis.patch.yml，追加）：
#    - insert:
#        - id: appilot
#          name: '@appilot-labs/appilot'

# 4. 重启 web
dsh web
```

**启用/禁用**：编辑 `~/.dsh/profiles/web/cordis.patch.yml`——删除该行 = 禁用；
或 `disabled: true`。**卸载**：删 patch 行 + `dsh plugin --profile web remove @appilot-labs/appilot`。
设置里的插件管理页（settings → plugins）与侧边栏 Cordis 面板可查看/管理插件清单。

## 方式三：启动时 --patch（零持久化，仅测试）

```bash
dsh web --patch ./plugins/dsh-appilot/dev.cordis.yml
```

撤销 = 去掉参数。不产生任何持久改动。

## 回滚

```bash
scripts/dsh-profile-backup.sh <profile>      # 改之前备份（tar + sha256）
scripts/dsh-profile-restore.sh <备份.tar.gz> # 校验后还原
scripts/dsh-undo-appilot.sh <profile>        # 一键撤销 appilot 相关改动
```

> ⚠️ 已废弃的做法：往 `dsh.profile.bundles` 追加 `@appilot-labs/appilot`（会把插件变成
> bundle 层，污染官方定义）。本仓库 `profiles/appilot/package.json` 已改为官方
> bundles + 用户层 patch 的正确形态。
