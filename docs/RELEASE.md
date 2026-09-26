# macOS DMG 发布流程（1.3.0）

> npm 包与 macOS DMG 均为 1.3.0。npm 由 `v1.3.0` tag 工作流发布；DMG 另行在本机签名、公证、贴票、验证并上传。同一 tag 已存在，制作 DMG 时不要重打或移动 tag。

> 构建环境说明：Appilot 是 Electron 应用（TypeScript + React + electron-vite），
> 不是 Xcode 工程。日常开发用 VS Code，打包用 npm + electron-builder 在本机完成，
> 不依赖 GitHub 线上构建。当前里程碑只发布 macOS，暂不做 Windows。

## 一次性准备（签名 / 公证凭据）

1. Apple Developer ID Application 证书 → 导出为 `.p12`，记下密码。
2. appleid.apple.com → 登录与安全 → App 专用密码，生成一个专用密码。
3. 记下 Team ID（developer.apple.com → Membership）。

## 凭据存放（安全约定）

- 复制 `.release.env.example` 为 `.release.env`（已在 `.gitignore` 中，切勿提交），
  填入真实值。若 `CSC_LINK` 通过相对路径读取 `.p12`，必须在保存该文件的检出目录内执行 `source .release.env`；不能从另一个 worktree 直接 source。
- 已在登录钥匙串安装有效 Developer ID Application 证书时，可以在构建前 `unset CSC_LINK CSC_KEY_PASSWORD`，让 electron-builder 使用系统证书；先用 `security find-identity -p codesigning -v` 确认身份。
- `.p12` 建议放在项目内 `.secrets/` 目录（已被忽略）或项目外的私有目录，
  并 `chmod 600`。**不要放进 `resources/`**，否则会被打进安装包。
- `.release.env` 与 `.secrets/` 权限也收紧为 `chmod 600`；密码同时在密码管理器留底。

## 本机打包

```bash
export APPILOT_VERSION=1.3.0
git fetch origin --tags
git switch --detach v1.3.0
npm ci
# 在存放凭据的检出目录 source .release.env，然后返回本检出。
# 如果使用登录钥匙串中的 Developer ID 证书：unset CSC_LINK CSC_KEY_PASSWORD
npm run dist:mac -- -c.mac.notarize=true
```

产出两个分架构 DMG（已 Developer ID 签名；`.app` 内部已公证 + staple）：

- `dist/Appilot-${APPILOT_VERSION}-arm64.dmg`（Apple Silicon）
- `dist/Appilot-${APPILOT_VERSION}-x64.dmg`（Intel）

> 实测（electron-builder 26.15.3）：`-c.mac.notarize=true` 只公证 `.app`，
> DMG 本身无票，必须再手动公证 + 贴票，否则用户打开 DMG 仍有「来自互联网」提示。

### 本地开发版版本检查

`npm run dev` 使用当前检出的 `package.json` 和已经启动的 Electron 进程；npm 包发布或推送 tag 不会自动升级它。先停止旧开发进程，再在干净检出中核对版本、更新并重新启动：

```bash
git status --short
git fetch origin master
git switch master
git pull --ff-only origin master
node -p 'require("./package.json").version' # 应为 1.3.0
npm ci
npm run dev
```

### DMG 级公证 + 贴票（必须）

```bash
export APPILOT_VERSION=1.3.0
# APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID 已在当前 shell 加载。
# 将下方占位符替换为 security find-identity 输出中的完整 Developer ID Application 名称。
export APPILOT_SIGN_IDENTITY='Developer ID Application: <证书名称> (<Team ID>)'
for dmg in "dist/Appilot-${APPILOT_VERSION}-arm64.dmg" "dist/Appilot-${APPILOT_VERSION}-x64.dmg"; do
  codesign --force --sign "$APPILOT_SIGN_IDENTITY" --timestamp "$dmg"
  xcrun notarytool submit "$dmg" \
    --apple-id "$APPLE_ID" \
    --password "$APPLE_APP_SPECIFIC_PASSWORD" \
    --team-id "$APPLE_TEAM_ID" \
    --wait
  xcrun stapler staple "$dmg"
done
```

## 验证

```bash
export APPILOT_VERSION=1.3.0
for arch in arm64 x64; do
  app_dir="dist/mac-arm64"
  if [ "$arch" = x64 ]; then app_dir="dist/mac"; fi
  codesign --verify --deep --strict --verbose=2 "$app_dir/Appilot.app"
  xcrun stapler validate "$app_dir/Appilot.app"
  dmg="dist/Appilot-${APPILOT_VERSION}-${arch}.dmg"
  codesign --verify --verbose=2 "$dmg"
  xcrun stapler validate "$dmg"
  spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg"
done
```

## 冒烟清单

在干净环境安装 DMG：

1. 应用能启动，Gatekeeper 无警告。
2. 接入一个全新项目目录，总览能识别平台/语言并显示仓库路径。
3. 生成关键词：点亮语言 → AI 生成 → 确认加入 → 排名矩阵出现关键词。
4. 发布工作台：确认变更摘要 → 生成文案 → 翻译一种语言 → 确定母本/整批。
5. 任务中心：能看到排名采集与 GitHub 同步任务，时间线有执行记录。
6. 设置：配置 AI 提供方并测试连接；配置 GitHub / ASC 凭据并解锁。

## 创建 GitHub Release

```bash
export APPILOT_VERSION=1.3.0
gh release create "v${APPILOT_VERSION}" \
  "dist/Appilot-${APPILOT_VERSION}-arm64.dmg" \
  "dist/Appilot-${APPILOT_VERSION}-x64.dmg" \
  --title "Appilot ${APPILOT_VERSION}" \
  --notes-file RELEASE_DRAFT.md \
  --draft
```

检查 draft release（标题、说明、附件）与上传后的 SHA-256，再将 draft 发布。
