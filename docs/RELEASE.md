# 0.3.0 发布流程（本机打包，macOS）

> 构建环境说明：Appilot 是 Electron 应用（TypeScript + React + electron-vite），
> 不是 Xcode 工程。日常开发用 VS Code，打包用 npm + electron-builder 在本机完成，
> 不依赖 GitHub 线上构建。当前里程碑只发布 macOS，暂不做 Windows。

## 一次性准备（签名 / 公证凭据）

1. Apple Developer ID Application 证书 → 导出为 `.p12`，记下密码。
2. appleid.apple.com → 登录与安全 → App 专用密码，生成一个专用密码。
3. 记下 Team ID（developer.apple.com → Membership）。

## 凭据存放（安全约定）

- 复制 `.release.env.example` 为 `.release.env`（已在 `.gitignore` 中，切勿提交），
  填入真实值。`CSC_LINK` 填 `.p12` 的**文件路径**，不要把私钥 base64 写进文件。
- `.p12` 建议放在项目内 `.secrets/` 目录（已被忽略）或项目外的私有目录，
  并 `chmod 600`。**不要放进 `resources/`**，否则会被打进安装包。
- `.release.env` 与 `.secrets/` 权限也收紧为 `chmod 600`；密码同时在密码管理器留底。

## 本机打包

```bash
npm ci
source .release.env
npm run dist:mac -- -c.mac.notarize=true
```

产出两个分架构 DMG（Developer ID 签名；`.app` 内部已公证 + staple）：

- `dist/Appilot-0.3.0-arm64.dmg`（Apple Silicon）
- `dist/Appilot-0.3.0-x64.dmg`（Intel）

### DMG 级公证 + 贴票（推荐）

electron-builder 只公证了 `.app`，DMG 本身没有票。为了让用户打开 DMG 时也没有
「来自互联网」提示，把 DMG 再提交一次公证并贴票（两个架构各一次）：

```bash
source .release.env
for dmg in dist/Appilot-0.3.0-arm64.dmg dist/Appilot-0.3.0-x64.dmg; do
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
codesign --verify --deep --strict --verbose=2 "dist/mac-arm64/Appilot.app"
xcrun stapler validate "dist/mac-arm64/Appilot.app"
xcrun stapler validate "dist/Appilot-0.3.0-arm64.dmg"
xcrun stapler validate "dist/Appilot-0.3.0-x64.dmg"
```

## 冒烟清单

在干净环境安装 DMG：

1. 应用能启动，Gatekeeper 无警告。
2. 接入一个全新项目目录，总览能识别平台/语言并显示仓库路径。
3. 生成关键词：点亮语言 → AI 生成 → 确认加入 → 排名矩阵出现关键词。
4. 发布工作台：确认变更摘要 → 生成文案 → 翻译一种语言 → 确定母本/整批。
5. 任务中心：能看到排名采集与 GitHub 同步任务，时间线有执行记录。
6. 设置：配置 AI 提供方并测试连接；配置 GitHub / ASC 凭据并解锁。

## 打 tag 与上传

```bash
git tag -a v0.3.0 -m "v0.3.0: 里程碑版本"
git push origin v0.3.0
gh release create v0.3.0 dist/Appilot-0.3.0.dmg --draft
```

检查 draft release（标题、说明、附件）后点发布。
