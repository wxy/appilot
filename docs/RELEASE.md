# 0.3.0 发布流程（本机打包，macOS）

> 构建环境说明：Appilot 是 Electron 应用（TypeScript + React + electron-vite），
> 不是 Xcode 工程。日常开发用 VS Code，打包用 npm + electron-builder 在本机完成，
> 不依赖 GitHub 线上构建。当前里程碑只发布 macOS，暂不做 Windows。

## 一次性准备（签名 / 公证凭据）

1. Apple Developer ID Application 证书 → 导出为 `.p12`，记下密码。
2. appleid.apple.com → 登录与安全 → App 专用密码，生成一个专用密码。
3. 记下 Team ID（developer.apple.com → Membership）。

## 本机打包

```bash
npm ci
export CSC_LINK="$(base64 -i /path/to/DevID.p12)"
export CSC_KEY_PASSWORD='...'
export APPLE_ID='you@apple.com'
export APPLE_APP_SPECIFIC_PASSWORD='xxxx-xxxx-xxxx-xxxx'
export APPLE_TEAM_ID='ABCDE12345'
npm run dist:mac -- -c.mac.notarize=true
```

产出 `dist/Appilot-0.3.0.dmg`（已 Developer ID 签名 + 公证 + staple）。

## 验证

```bash
codesign --verify --deep --strict --verbose=2 "dist/mac-arm64/Appilot.app"
xcrun stapler validate "dist/mac-arm64/Appilot.app"
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
