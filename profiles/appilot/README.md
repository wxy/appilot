# Appilot Profile（定制 DeepSeek Harness 发行版）

`dsh --profile appilot` 启动一个以 Appilot 为主场的 Harness：
bundles = `dsh-base` + `dsh-web-app` + `@appilot/dsh`（元插件，含 project/release 域）。

## 本机安装（开发验证）

```bash
# 1. 把 profile 装进 DSH_HOME
mkdir -p ~/.dsh/profiles/appilot
cp profiles/appilot/package.json profiles/appilot/cordis.patch.yml ~/.dsh/profiles/appilot/

# 2. 安装插件依赖（file: 指向本仓库；发布后改 registry 版本）
cd ~/.dsh/profiles/appilot
npm install --no-audit --no-fund   # 或 dsh plugin --profile appilot add <pkg>

# 3. 验证配置树（不启动服务）
dsh --profile appilot --dump-config | grep -i appilot

# 4. 启动（Web 表层，可换端口避开默认 3080）
dsh --profile appilot --port 3099 --no-open
```

## 说明

- bundles 中的 `@deepseek-ai/*` 从 dsh 安装目录解析；`@appilot/*` 从 profile 的
  node_modules 解析（file: 安装到本机验证，发布后改 npm registry）。
- profile 的 `cordis.patch.yml` 是用户覆盖层，可定制 persona/默认行为（示例见文件内）。
- 面向非 Harness 用户的分发：未来用 `appilot` CLI 或桌面壳启动本 profile
  （迁移文档 §6.3 / §8）。
