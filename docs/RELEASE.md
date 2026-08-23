# 0.3.0 发布冒烟清单

打包完成后（`npm run dist:mac` / `npm run dist:win`），在干净环境里手动验证：

1. 安装 DMG / NSIS 安装包，应用能正常启动（Gatekeeper 无警告，公证 stapler 验证通过）。
2. 接入一个全新项目目录，总览能识别平台/语言并显示仓库路径。
3. 生成关键词：点亮语言 → AI 生成 → 确认加入 → 排名矩阵出现关键词。
4. 发布工作台：确认变更摘要 → 生成文案 → 翻译一种语言 → 确定母本/整批。
5. 任务中心：能看到排名采集与 GitHub 同步任务，时间线有执行记录。
6. 设置：配置 AI 提供方并测试连接；配置 GitHub / ASC 凭据并解锁。

## 发版步骤

1. 确认 `package.json` 版本号与 `CHANGELOG.md` 一致（0.3.0）。
2. 在仓库设置里配置 Secrets：`CSC_LINK`、`CSC_KEY_PASSWORD`、
   `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`。
3. 打 tag 并推送：

```bash
git tag -a v0.3.0 -m "v0.3.0: 里程碑版本"
git push origin v0.3.0
```

4. Release workflow 自动打包并创建 draft release，检查附件后发布。
