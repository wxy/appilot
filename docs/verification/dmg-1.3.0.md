# Appilot 1.3.0 macOS DMG 验证记录

日期：2026-09-26。源代码为已有的 `v1.3.0` tag，指向 `882db82752073f5736d32ae6b116e3c97d3ac87e`；未重打 tag。构建环境：macOS 26.6.2、Xcode 27.0、Node.js 26.7.0、npm 11.19.0、electron-builder 26.15.3。使用本机登录钥匙串中的 Developer ID Application 证书和私有 `.release.env` 中的 Apple 公证凭据；凭据不进入仓库或本记录。

## 输入与复现

在干净的 `v1.3.0` 检出运行 `npm ci --no-audit --no-fund`，然后在私有凭据已经载入当前 shell 的条件下运行：

```bash
unset CSC_LINK CSC_KEY_PASSWORD # 使用登录钥匙串中已安装的 Developer ID 证书
npm run dist:mac -- -c.mac.notarize=true
```

首次双架构构建的 arm64 App 获 Apple 公证通过并产生 arm64 DMG；x64 的 Electron 下载连接中断。仅对 x64 重试：

```bash
npm run dist:mac -- --x64 -c.mac.notarize=true
```

x64 App 完成签名后，electron-builder 在读取公证状态时收到空的异常结果。Apple 公证历史显示原提交号 `8a83dd1d-bdcb-414c-9ef9-3bbd92882883` 长时间为 `In Progress`。将**同一份已签名的 App** 再次压缩提交，第二笔 `fdd88b5b-3e9a-463a-8724-30485725b053` 获 `Accepted`。第二次提交的 zip SHA-256 为 `c32444a19fc77af4fa235f01b7adc11e11a009603f1fb58973cad9841635cff9`。

```bash
export APPILOT_RELEASE_TMP="$TMPDIR/appilot-dmg-1.3.0-20260926"
mkdir -p "$APPILOT_RELEASE_TMP"
ditto -c -k --keepParent dist/mac/Appilot.app "$APPILOT_RELEASE_TMP/Appilot-x64-resubmit.zip"
xcrun notarytool submit "$APPILOT_RELEASE_TMP/Appilot-x64-resubmit.zip" \
  --apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --team-id "$APPLE_TEAM_ID"
xcrun notarytool wait fdd88b5b-3e9a-463a-8724-30485725b053 \
  --apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --team-id "$APPLE_TEAM_ID"
xcrun stapler staple dist/mac/Appilot.app
./node_modules/.bin/electron-builder --prepackaged dist/mac/Appilot.app \
  --mac dmg --x64 -c.mac.notarize=false
mv dist/Appilot-1.3.0.dmg dist/Appilot-1.3.0-x64.dmg
```

预打包构建将 DMG 命名为 `Appilot-1.3.0.dmg`，因此重命名为与 arm64 对称的发布附件。挂载只读镜像检查其内含 App 的版本 `1.3.0`、架构 `x86_64`，内含 App 的贴票验证通过。

## 验证命令

应用版本和架构：

```bash
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' dist/mac-arm64/Appilot.app/Contents/Info.plist
lipo -archs dist/mac-arm64/Appilot.app/Contents/MacOS/Appilot
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' dist/mac/Appilot.app/Contents/Info.plist
lipo -archs dist/mac/Appilot.app/Contents/MacOS/Appilot
```

每个 App 和 DMG 分别验证：

```bash
codesign --verify --deep --strict --verbose=2 "dist/mac-arm64/Appilot.app"
xcrun stapler validate "dist/mac-arm64/Appilot.app"
codesign --verify --deep --strict --verbose=2 "dist/mac/Appilot.app"
xcrun stapler validate "dist/mac/Appilot.app"
for arch in arm64 x64; do
  dmg="dist/Appilot-1.3.0-${arch}.dmg"
  codesign --verify --verbose=2 "$dmg"
  xcrun stapler validate "$dmg"
  spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg"
  shasum -a 256 "$dmg"
done
```

## 已取得的结果

| 项目 | arm64 | x64 |
| --- | --- | --- |
| App 内版本、二进制架构 | `1.3.0`、`arm64` | `1.3.0`、`x86_64` |
| App 严格签名验证 | 通过 | 通过 |
| App 公证与贴票 | Accepted、贴票通过 | 第二笔 `fdd88b5b-3e9a-463a-8724-30485725b053` Accepted、贴票通过 |
| DMG 外层公证 | Accepted，提交号 `8e2cc4b8-ac0a-49f1-9eda-2c1f3f3665e3` | Accepted，提交号 `be31f137-8e53-45f4-9d93-d1eb7f0530b0` |
| DMG 贴票、签名、Gatekeeper | 全部通过，Gatekeeper 为 `accepted / Notarized Developer ID` | 全部通过，Gatekeeper 为 `accepted / Notarized Developer ID` |
| 镜像内 App 版本、架构、票据 | `1.3.0`、`arm64`、票据有效 | `1.3.0`、`x86_64`、票据有效 |
| DMG 大小 | 132,331,958 bytes | 137,090,609 bytes |
| DMG SHA-256 | `23a57f793ebcc5f3253873352b2bacf7cda1fa894c9a5cd1f4505cb74f0f2426` | `5089d1ba6ee4bff022c4fd59c33c162538fc9027e67599ec1d60a9b7827aeb05` |

GitHub Release 草稿 `v1.3.0` 上传后，通过 `gh release view v1.3.0 --json assets` 读回两个附件：状态均为 `uploaded`，名称、字节数及 GitHub 提供的 `sha256:` digest 均与上表一致。发布后再次核对 Release 的公开状态和正式下载链接。

本地开发版先前来自旧检出，`package.json` 为 1.2.0，且旧 Electron 进程持续运行。停止旧进程，将干净的本地 `master` 快进到上述提交并运行 `npm ci`、`npm run dev` 后，启动日志显示 `Appilot v1.3.0 starting`。启动命令、源版本与日志形成可重复核对的本地版本检查；这不代替 DMG 安装后的视觉验收。
