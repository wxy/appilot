# 项目设置与 Token 能力设计方案（v2，待讨论）

> 状态：待讨论。分支：`codex/project-settings`
> v2 修订：Token 全局默认 + 项目级覆盖；ASC 私钥仅文件选择；设置页独立路由；徽标用图标；发布/提交类写入功能暂缓。

## 1. 背景与目标

1. 项目本地路径、GitHub 远程可能移动/改名，需要可编辑的项目设置。
2. 提供 GitHub Token 与 App Store Connect Token 的配置入口：默认全局一套，必要时按项目覆盖。
3. Token 驱动的功能必须标识来源；未配置时给出引导。
4. **本期只做「读取增强」**（用 Token 获取更多信息，完善运营监控）；GitHub 发布、App Store 提交等写入动作暂缓，另行设计讨论。

## 2. 入口与路由

- 总览页头部（平台切换、仓库外链同一行）放「项目设置」按钮（⚙），点击跳转独立路由页 `/projects/:projectId/settings`。
- 设置页以后会承载更多功能（凭据、监控源、通知等），所以用独立路由而非模态。
- 路由由全局「设置」页（AI 供应商）之外的项目级设置页构成，两者互不混淆。

## 3. 设置页结构

三个分区（单页滚动）：

### 3.1 基本信息

| 字段 | 说明 |
| --- | --- |
| 项目名称 | 显示名，改动后全站 UI 同步 |
| 本地仓库路径 | 保存时校验目录存在且是 git 仓库；成功后触发仓库重扫描（商店链接、README、发布边界） |
| GitHub 仓库 URL | 默认从 git remote 探测，允许覆盖（总览外链与发布检测使用） |

### 3.2 凭据（全局 + 项目覆盖）

**GitHub Token**

- 全局默认：一个 GitHub Token（个人账户）。
- 项目级覆盖：可选，仅当需要以不同身份/仓库权限访问时填写。
- 输入掩码、测试连接、清除（覆盖时清除=回退到全局）。

**App Store Connect API Key**

- 全局默认：Issuer ID + Key ID + 私钥（**仅文件选择 `.p8`，不提供粘贴**，避免复制粘贴泄露与换行问题）。
- 项目级覆盖：可选（不同 App 分属不同账户时使用）。
- 测试连接、清除。

**存储与安全**

- 全局凭据：`safeStorage` 加密，独立键存储。
- 项目覆盖：按 `projectId` 键控的加密覆盖表；**有效凭据 = 项目覆盖 ?? 全局默认**。
- 凭据不写入日志、不进项目 JSON、**绝不进入 AI 提示词**。

### 3.3 能力状态

- 矩阵展示两个 Token 的生效状态（全局 / 项目覆盖 / 未配置）及解锁的读取能力清单。
- 未配置项一键跳转到对应输入框。

## 4. Token 能力矩阵

### 免 Token（现状，本地化分析）

- 本地 git：提交、PR 引用、tag、发布边界检测。
- iTunes 搜索 API（免费）：排名采集、商店链接发现。
- AI 生成关键词/整理/候选提取/文案/翻译。
- 发布工作台从本地提交 + PR 引用合成变更摘要与文案。

### + GitHub Token（本期：只读增强）

| 功能 | 落点 | 写入？ |
| --- | --- | --- |
| 私有仓库 release 公告正文 | 发布工作台参考区 / 文案列表 | 否 |
| 草案 release 公告 | 发布工作台参考区 | 否 |
| 真实 PR 标题/描述/作者/合并时间 | 变更摘要（替代 commit 正则提取） | 否 |
| 本地目录失效时拉取远程数据 | 发布检测、项目档案 | 否 |

### + App Store Connect Token（本期：只读增强）

| 功能 | 落点 | 写入？ |
| --- | --- | --- |
| 当前版本/审核状态回读 | 总览状态芯片、发布工作台 | 否 |
| 审核被拒意见回读 | 发布工作台 reviewFeedback | 否 |
| 商店评论（分地区） | 激活「评论洞察」页 | 否 |
| 销量/下载/展示量（App Analytics） | 激活「长期效果」页 | 否 |

### 暂缓讨论的写入功能（另行设计）

| 功能 | 说明 |
| --- | --- |
| GitHub：草案 → 正式发布 / 更新 release 正文 / 新建 tag | 见 §8 讨论 |
| ASC：创建新版本 / 写入元数据 / 提交审核 | 见 §8 讨论 |

## 5. Token 驱动的功能标识

统一组件：

- `TokenBadge source="github|asc"`：小图标 + tooltip（如 🔗/🛒 图标），数据来自 Token 时显示在字段旁。
- `TokenGate source="github|asc"`：功能需要 Token 但未配置时，入口置灰 + 小锁图标 + tooltip「需要 GitHub Token」，点击跳转项目设置。

三态规则：

1. 已配置且有数据 → 来源小图标。
2. 未配置但有入口 → 置灰 + 锁图标 + 引导。
3. 完全依赖 Token → 空态引导，不显示伪数据。

落点：发布工作台（release 公告来源、审核意见来源）、总览（商店状态）、评论页、趋势页；排名页无 Token 依赖。

## 6. 数据与接口设计

**Project 模型**：`name`、`localPath`、`repo.githubUrl` 可编辑；新增 `settings.githubUrlOverride` 等元信息。

**凭据存储**：

```ts
// 全局默认（safeStorage 加密）
globalCredentials: {
  githubToken?: string;
  ascIssuerId?: string;
  ascKeyId?: string;
  ascPrivateKeyPath?: string;   // .p8 文件路径；密钥内容仍加密存储
  updatedAt?: string;
}

// 项目覆盖（按 projectId，只存被覆盖的字段）
projectCredentials: {
  [projectId]: {
    githubToken?: string;
    ascIssuerId?: string;
    ascKeyId?: string;
    ascPrivateKeyPath?: string;
    updatedAt?: string;
  }
}
```

**IPC**：

- `projects:updateSettings(projectId, { name?, localPath?, githubUrl? })`。
- `projects:getCredentials(projectId)` / `saveCredentials` / `clearCredentials`（返回有效凭据的存在性布尔，不返回明文）。
- `projects:testGithubToken(token)` / `projects:testAscKey({ issuerId, keyId, privateKeyPath })`。
- `projects:list` 返回 `hasGithubToken` / `hasAscKey`（生效态）。

## 7. 实施阶段

1. **Phase 1（纯本地）**：设置路由页 + 基本信息编辑 + 凭据（全局/覆盖/文件选择/加密/测试/清除）+ 能力状态矩阵。
2. **Phase 2（GitHub 只读）**：release 公告（含私有/草案）与真实 PR 素材增强；TokenBadge/TokenGate 上线。
3. **Phase 3（ASC 只读）**：版本/审核状态、审核意见、评论页、趋势页分析数据。
4. **Phase 4（另行讨论）**：发布写入（GitHub 发布、ASC 版本创建/提交）——设计评审通过后再做。

## 8. 已确认决策

- Token：全局默认 + 项目级覆盖（不考虑他人名下仓库）。
- ASC 私钥：仅文件选择，不粘贴。
- 设置页：独立路由页。
- 徽标：小图标 + tooltip。
- 本期范围：只用 Token 做读取增强；发布/提交写入暂缓。

## 9. 待讨论：发布与提交写入

### 9.1 GitHub Release：由谁创建？

**用户观点**：开发告一段落后由开发者决定是否做 release，可先建草案发布。

**我的建议**：发布边界（哪些提交属于本次发布）应是开发者的决定，草案发布/tag 就是开发者给出的边界信号，我们沿用「出现新 tag → 触发一次发布」的现有机制。Token 在这里的价值是：把草案/私有 release 的公告正文读回来作为素材；确认文案后，**由用户在发布工作台显式点击**「更新 release 正文并转为正式发布」（一次性、可回退），我们不做自动发布。

不建议由我们根据提交/PR 自动创建 release：那样会替开发者决定边界和 tag 命名，侵入开发流程。最多提供「按当前确认的变更边界新建草案发布」作为显式按钮，且默认关闭，留待 Phase 4 讨论。

### 9.2 App Store Connect：新版本在哪里创建？

**事实**：现代 ASC API 支持创建 `appStoreVersion`（新版本外壳）并写入各本地化字段（描述、推广文本、新版内容），甚至发起审核提交。但版本号、关联构建（build）、发布策略属于开发/发布决策。

**我的建议**：版本创建也应由开发者主导——先在 ASC 网站或 TestFlight 上传构建、创建版本；我们读取该版本，把生成好的文案**填入对应版本**（显式用户动作）。我们**不替用户创建新版本或提交审核**；需要写入时（Phase 4），流程为「读取已有版本 → 确认版本号 → 写入文案 → 用户自行在 ASC 提交审核」，避免我们在商店侧产生意外状态。

### 9.3 需要你确认

1. GitHub：接受「开发者建草案 → 我们准备素材 → 用户显式一键转为正式发布」吗？还是本期完全不做任何 GitHub 写入？
2. ASC：接受「读取已有版本 → 显式写入文案」，且不替用户创建版本/提交审核吗？
3. 如果都接受，Phase 2/3 只做读取，Phase 4 再把这两个显式写入动作纳入设计。
