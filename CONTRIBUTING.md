# Contributing to Appilot · 参与 Appilot

Thank you for helping improve Appilot. Keep changes scoped, preserve existing user data, and include current test or build evidence. Discuss substantial product or architecture changes in an issue before implementation.

> 感谢您帮助改进 Appilot。请控制改动范围、保留现有用户数据，并附上当前测试或构建证据。重大产品或架构变更请先在 Issue 中讨论。

## Contributor License Agreement · 贡献者许可协议

All human contributors must accept the [Appilot Contributor License Agreement v1.0](CLA.md) before a pull request can be merged. The CLA does not transfer copyright: contributors retain ownership while granting the Project the copyright and patent licenses needed to distribute and build upon their work under `GPL-3.0-or-later`.

> 所有自然人贡献者都必须在拉取请求合并前接受 [Appilot 贡献者许可协议 1.0](CLA.zh-CN.md)。CLA 不转让版权：贡献者保留所有权，同时向项目授予按照 `GPL-3.0-or-later` 分发并继续开发其贡献所需的版权与专利许可。

The CLA Assistant will comment when a signature is required. Read the authoritative English agreement, then post this exact comment on the pull request:

> 当需要签署时，CLA Assistant 会在拉取请求中留言。请阅读具有法律效力的英文协议，然后在拉取请求中发布以下完全一致的评论：

```text
I have read the CLA Document and I hereby sign the CLA
```

The assistant records the GitHub identity, agreement version, pull request, and timestamp in the repository's dedicated `cla-signatures` branch. One signature covers past and future Contributions under version 1.0. A materially changed CLA requires a new acceptance.

> 助手会在仓库专用的 `cla-signatures` 分支中记录 GitHub 身份、协议版本、拉取请求和时间。一次签署适用于 1.0 版下过去及未来的贡献；CLA 如有重大变更，需要重新接受。

If an employer or another party may own rights in your work, obtain its permission before contributing. Identify third-party material and its license in the pull request; do not submit material you are not authorized to contribute.

> 如果雇主或其他主体可能拥有您工作成果中的权利，请先取得其许可。请在拉取请求中说明第三方材料及其许可证；不要提交您无权贡献的材料。

## Development checks · 开发检查

Install dependencies with `npm ci`, then run the checks relevant to your change. Before requesting review, the normal release gates are:

> 使用 `npm ci` 安装依赖，然后运行与改动相关的检查。请求审查前，通常需要通过以下发布门禁：

```bash
npm run typecheck
npm test
npm run build
```

Explain what changed, how it was verified, and any remaining manual acceptance steps in the pull request.

> 请在拉取请求中说明改动内容、验证方式，以及仍需执行的人工验收步骤。
