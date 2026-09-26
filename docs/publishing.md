# Appilot 发布与 DSH Profile 更新 SOP

> 适用：@appilot-labs/* npm 包发布 + DSH 宿主（profile）消费更新。
> 首次 1.0.0 已发布（2026-09-04，NPM_TOKEN 首发）；此后一律 **OIDC Trusted Publishing**（无 token）。
> 当前 npm 包与 macOS DMG 版本均为 1.3.0。两种分发需分别验证。

## 1. 包结构与发布范围

**发布到 npm（9 个）**：`core → headless → common → project/release → appilot(dsh 插件) → headless-cli → scheduler → mcp`
（publish.yml 按此依赖顺序逐包 `npm publish --access public`）

**不发布**：根 desktop（Electron，private）、`packages/cli`（无 scope 本地启动器）。

发布包间依赖用 `^<version>` 互相引用（如 headless → core ^1.3.0）——bump 时**必须同步所有 range**，否则消费方装到旧版。

## 2. 发布流程（每次发版）

### Step 1 — Bump PR
- 改各发布包 `package.json` version（+ 桌面 root 如需对齐）+ 所有 `@appilot-labs/*` 内部依赖 range，同步为本次版本
- `npm install --package-lock-only`（workspace 链接，本地可重建，不触网）
- CI 走缓存：锁变化触发增量 install（已优化，~30s），无需担心冷装
- 合并 PR（等 CI 绿），确认 tag 指向该合并后的 `master` 提交

### Step 2 — 推 tag 触发发布
```bash
VERSION=$(node -p "require('./package.json').version")
git fetch origin master --tags
git tag -a "v${VERSION}" origin/master -m "Appilot v${VERSION} npm packages"
git push origin "v${VERSION}"
```
- `.github/workflows/publish.yml`：tag push → OIDC 认证（Node 24 / npm≥11.5.1）→ **自动生成 provenance**（无需 `--provenance` 标志）
- 观察：`gh run list --limit 3` → publish job 全绿；registry API 验证：
  ```bash
  curl -s https://registry.npmjs.org/@appilot-labs%2fappilot-core | python3 -c "import json,sys;print(json.load(sys.stdin)['dist-tags'])"
  ```

### Step 3 — 分发记录

1.3.0 的 npm 包由 tag 工作流发布，macOS DMG 在本机独立完成 Developer ID 签名、Apple 公证、贴票和 Gatekeeper 验证后上传 GitHub Release。不要把 npm 工作流通过视为安装包已发布。

需要同时发布 GitHub Release 时，使用对应版本的发布说明：
```bash
VERSION=$(node -p "require('./package.json').version")
gh release create "v${VERSION}" \
  "dist/Appilot-${VERSION}-arm64.dmg" "dist/Appilot-${VERSION}-x64.dmg" \
  --title "Appilot ${VERSION}" --notes-file RELEASE_DRAFT.md
```

### OIDC 现状（已配置，勿重复操作）
- 9 包 Settings → Trusted Publisher：`wxy / appilot / publish.yml`，Allowed actions 勾选 `npm publish`（9/3 后新建默认 stage-only，必须显式允许直接发布）
- `NPM_TOKEN` secret **已删除**；workflow `permissions: id-token: write` 就绪

## 3. DSH Profile（宿主）更新

profile 是 pnpm（hoisted）工程：`~/.dsh/profiles/appilot/`

```bash
cd ~/.dsh/profiles/appilot
# package.json dependencies 里的 @appilot-labs/* 升到新版本（如 ^1.3.0）
pnpm install          # 从 registry 替换（不再拷 dist）
# 重启 3099（宿主装载插件 dist）
```

- pnpm `minimumReleaseAge` 对新发布版本有 24h 保护：首次装新版本时 pnpm 会把该版本加入
  `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 并提示（已自动处理过一次）；如需强制可设
  `minimumReleaseAgeStrict`。
- **daemon 自动跟上**：若 scheduler daemon 在跑，`pnpm install` 覆盖 headless/scheduler dist 后，
  daemon 代码自更新（60s 周期）会自动重启换新码——升级无需手动重启 daemon。
- 插件客户端 client.js 随发布版打包（files: dist+client），3099 按请求读盘，刷新即生效。

## 4. 验证 Checklist

1. **registry 冒烟**（全新目录）：
   ```bash
   mkdir -p "$TMPDIR/appilot-npm-smoke" && cd "$TMPDIR/appilot-npm-smoke" && npm i @appilot-labs/appilot-headless ...
   ```
   → openStore + lease + tasks + snapshots 跑通；`appilot-headless --help` 有输出
2. **3099**：`/appilot task` 出状态摘要（不经模型）；agent 跑 `appilot_tasks` 出 byKind
3. **Electron**：任务中心正常（读同一共享 DB）
4. **桌面**：`npm run typecheck/test` 绿（CI）

## 5. 常见坑

- **别在功能 PR 顺手 bump 版本**（lock 变化会绕缓存一次全量 install；bump 集中在 release PR）
- tag 打错/发布失败：修后需新版本号（npm 不允许覆盖已发布版本）
- provenance 只对 **public GitHub 仓库**的 GitHub Actions 生成；自托管 runner 不支持
- profile 与仓库代码一致性：只经 registry 消费即可根治「repo/profile 代码不同步」（双 daemon 事故温床）

## 6. 相关文档

- 架构收敛与壳边界：`docs/architecture-convergence.md`
- 后台调度 daemon 蓝图（含自更新）：`docs/architecture-scheduler-daemon.md`
- npm Trusted Publishing 官方文档：https://docs.npmjs.com/trusted-publishers/
