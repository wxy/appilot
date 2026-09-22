# 上架后推广模块设计

> 状态：P0–P2 MVP 已实现，待真实使用与视觉验收；ImageProvider、Product Hunt 和产品生命线仍未实施。
>
> 确认日期：2026-09-14。
>
> 本文定义独立的上架后推广模块。它取代旧 Twitter Composer，也覆盖 `appilot-product.md` 中“推广角度作为发布工作台的一部分”的旧决定。发布工作台继续只负责上架准备；推广模块只读其形成的发布事实。

## 最新架构决策：X 系列模型

本节覆盖下文与 `PromotionDelivery[]` 多平台首发有关的旧实现目标；旧结构和处理器继续兼容读取，但同一产品族、同一版本下按平台拆分的旧活动会折叠为一个推广任务，并保留进度最高的一条。

- 新活动固定 `enabledPlatforms = ["x"]`。
- 同一项目产品族的同一版本只有一个推广活动；iOS、macOS 等 Store Product 只是活动的目标平台，不再各自创建重复活动。旧的同版本平台活动在读取时折叠为进度最完整的一条。
- 首次操作合并推广价值分析与系列规划；用户进入条目后只需“生成帖子 → 在 X 发布 → 回填帖子链接”。
- `PromotionCampaign.seriesItems` 是新的主工作模型：每项独立保存计划元数据、X 文案、所选 Store Product 与商店链接、场景图提示词、截图包装提示词、素材引用、修订和发布状态。多平台产品默认使用 macOS 主平台链接，用户可以逐条改选 iPhone / iOS 链接。
- `promotion:generateSeriesPlan` 创建 1–5 条精简计划，`promotion:generateSeriesItem` 按需生成指定条目的最终内容；每条 X 主帖必须包含当前产品对应的 App Store 链接。
- 截图和图片提示词是可选增强，不再阻塞纯文字 X 帖子的生成与发布。
- `promotion:markSeriesItemPublished` 要求用户回填实际 X `/status/…` 链接，并写入事实型 `publicationEvents`；它仍是用户手工确认，不冒充 X 平台 API 回执。
- 场景提示词与截图包装提示词的约束被服务端补全，不能依赖模型自觉返回；单帖在服务端校验 X 加权 280 字符限制。
- 删除素材时，同时清理未发布系列条目的素材引用；已发布条目引用的素材不可移除。

## 1. 目标

Appilot 要解决的不是“通过 API 替用户点下发布按钮”，而是以最低连接成本，把一个已经上架的真实版本变成可以执行、可以保存、以后可以复盘的海外推广活动：

1. 判断该版本是否值得推广；
2. 从已确认的发布事实中选择一个清晰传播角度；
3. 生成适合不同平台的文案；
4. 让用户选择一至两张真实产品截图；
5. 生成可交给外部 AI 生图平台使用的提示词；
6. 保存最终使用的文案、素材和发布时间，为未来“产品生命线”提供事件。

首版优化的是“从上架到完成一次可信推广所需的时间和判断成本”，不是平台覆盖数、生成内容数量或自动化程度。

## 2. 产品边界

项目级主流程为：

```text
发布 → 推广 → 排名
```

- **发布**：准备、确认并冻结 App Store 上架材料。
- **推广**：读取已经上架版本的事实，形成并执行推广活动。
- **排名**：观察商店内关键词表现。
- **产品生命线**：未来连接版本、推广、下载和排名；本阶段只预留推广事件，不实现页面或分析。

推广是独立项目模块，不是发布工作台的页签。推广模块不能修改商店文案、截图文案、Release 内容或上架状态。

## 3. 首版范围

### 3.1 支持的平台

首版严格支持：

- X；
- Reddit；
- Facebook。

这表示 Appilot 为这三个平台提供内容结构、校验和操作界面，不表示每个产品、每个版本都必须生成三个平台的内容。

平台是否启用保存在产品级推广档案中：

- X 可以直接启用；
- Reddit 根据产品定位、README、关键词和受众备注推荐 3–5 个候选 subreddit，由用户打开社区核对规则并至少确认一个；
- Facebook 需要先明确发布到产品 Page、具体 Group 或个人动态。

### 3.2 暂不支持

- LinkedIn；
- Threads、Mastodon 等其他海外平台；
- 微信公众号、小红书、微博等国内平台；
- 社交平台 OAuth、自动发帖和定时发帖；
- 自动读取浏览量、点赞、评论或帖子 URL；
- Product Hunt 普通版本推广；
- 应用内 AI 生图；
- 产品生命线 UI 或归因分析。

Product Hunt 作为以后独立的重大 Launch 工作流预留，不属于普通 Release 的平台适配器。

## 4. 发布事实边界

正式推广活动只能关联已经上架的产品版本。输入材料由发布模块以只读方式提供：

- 项目、产品、平台和 App Store 链接；
- 版本号、Release tag 和实际发布时间；
- 用户确认纳入的版本变更；
- 最终商店文案、What's New 和 Promotional Text；
- 发布阶段形成的推广角度；
- 截图类型、标题和描述；
- 产品档案、跟踪关键词和生成时可用的排名基线。

生成推广活动时必须冻结一份来源快照和 `sourceSnapshotHash`。后续发布材料发生变化时，不静默改写已经生成或已经发布的推广内容。

AI 输出中的产品功能、数字和效果主张必须能够追溯到来源快照。文案计划只能作为写作方向，不能作为功能已经存在的证据。

## 5. 推广活动模型

每个“产品 × 已上架版本”最多有一份权威推广活动：

```ts
type PromotionRecommendation = "strong" | "light" | "skip";
type PromotionCampaignStatus =
  | "suggested"
  | "draft"
  | "ready"
  | "partially_published"
  | "published"
  | "skipped";

interface PromotionCampaign {
  id: string;
  projectId: string;
  productId: string;
  releaseId: string;
  releaseTag: string;
  appVersion: string;
  storePublishedAt: string;
  sourceSnapshotHash: string;
  recommendation: PromotionRecommendation;
  recommendationReason: string;
  status: PromotionCampaignStatus;
  brief?: PromotionBrief;
  assets: PromotionAsset[];
  deliveries: PlatformDelivery[];
  createdAt: string;
  updatedAt: string;
}
```

同一活动可以修订，但不创建互相竞争的多份活动。AI 重新生成形成新的内容修订；已经发布的修订保持可追溯。

### 5.1 是否值得推广

AI 必须允许输出“建议跳过”，不能假定每次发布都值得铺设多个平台。

判断依据：

- 用户是否可以感知变化；
- 是否解决了明确的问题或创造了新场景；
- 是否存在真实截图或其他证据；
- 是否能找到具体受众；
- 是否有明确的“为什么现在值得关注”。

建议级别：

- **强推广**：重大新能力、新场景或明显体验变化，可以生成多个平台内容；
- **轻量更新**：适合一次简短更新，通常只推荐一个平台；
- **建议跳过**：内部重构、依赖升级、小修复或没有可传播价值的变化。

用户可以接受建议、调整启用平台或标记跳过，但不需要从零填写推广策略。

## 6. 产品级推广档案

平台上下文应当一次配置、反复复用，而不是每个版本重新询问：

```ts
interface ProductPromotionProfile {
  productId: string;
  enabledPlatforms: Array<"x" | "reddit" | "facebook">;
  audienceNotes?: string;
  toneNotes?: string;
  x?: {
    accountLabel?: string;
  };
  reddit?: {
    communities: Array<{
      name: string;
      audienceNote?: string;
      postingNote?: string;
    }>;
  };
  facebook?: {
    surfaces: Array<{
      kind: "page" | "group" | "profile";
      label: string;
      audienceNote?: string;
      postingNote?: string;
    }>;
  };
  updatedAt: string;
}
```

Appilot 不保存平台密码或会话。社区规则可能变化，保存的 `postingNote` 只是用户认可的上下文；每次真正发帖前仍要提示用户检查当前规则。

Reddit 社区推荐只负责“受众匹配”，不声称实时验证社区存在性、自推广政策或具体发帖格式。推荐项必须展示匹配理由，允许用户先打开社区首页，再显式添加到产品推广档案。

## 7. 用户流程

```text
进入“推广”
  ↓
选择已上架版本
  ↓
AI 判断：强推广 / 轻量更新 / 建议跳过
  ↓
用户接受建议和主传播角度
  ↓
Appilot 根据截图类型推荐要寻找的图片
  ↓
用户在文件系统中选择 1–2 张截图
  ↓
Appilot 将截图复制为受管推广素材
  ↓
生成核心简报、平台文案和图片提示词
  ↓
用户编辑、复制、打开平台并手动发布
  ↓
用户逐个平台“标记已发布”
```

没有可用截图时不伪装成素材已经就绪。用户可以返回发布模块重新生成截图，也可以从其他位置选择真实产品截图。

## 8. 截图发现与导入

### 8.1 当前事实

现有发布工作台生成 Keynote 和 PNG 后，只把 `outputPath`、`outputDirectory` 和 PNG 文件列表返回给当次页面。最终 PNG 路径没有持久化到发布草稿，页面刷新后不能可靠恢复；用户也可能删除这些文件。

推广模块不得依赖这些临时输出仍然存在，也不以修复发布模块的记录方式作为前置条件。

### 8.2 寻找截图

推广页根据已确认的截图类型给出具体建议，例如：

```text
建议选择：Dashboard Overview、Token Cost Breakdown。
发布截图通常位于 Keynote 模板旁的
“AI Pulse-1.3.0-screenshots”文件夹中。
```

- 文件选择器允许一次选择一至两张图片；
- 如果仍有 Keynote 模板路径，默认从模板所在目录开始；
- 推断出的目录只作为寻找线索，不声称文件一定存在；
- 支持 PNG、JPEG、WebP 和经本地解码验证可用的其他现有格式；
- 选择后显示预览、尺寸、文件名，并允许替换或移除。

### 8.3 受管导入

用户已确认：选择截图采用“复制到 Appilot 受管目录”的导入语义，不只保存外部路径。

导入步骤：

1. 验证文件存在、可解码、格式和尺寸有效；
2. 计算 SHA-256；
3. 以原子方式复制到活动自己的受管目录；
4. 保存素材 ID、哈希、MIME、尺寸、文件名、原始路径和导入时间；
5. 后续生成与发布只读取受管副本；
6. 不修改、移动或删除原文件。

概念目录：

```text
Appilot Data/
└─ promotion-assets/
   └─ <campaign-id>/
      ├─ sources/
      │  ├─ <sha256>.png
      │  └─ <sha256>.png
      └─ generated/
```

```ts
interface PromotionAsset {
  id: string;
  campaignId: string;
  role: "screenshot" | "app_icon" | "generated";
  origin: "imported" | "image_api";
  managedPath: string;
  originalPath?: string;
  sha256: string;
  mimeType: string;
  fileName: string;
  width: number;
  height: number;
  importedAt: string;
}
```

相同哈希在同一活动内不重复复制。原文件删除不影响活动；受管副本缺失时必须明确标为缺失并要求重新导入，不能回退到不存在的原路径。

受管目录中的二进制文件不写入项目仓库或配置 JSON；数据库只记录元数据和受控路径。素材清理必须按引用关系进行，不能因删除一个平台草稿而误删仍被其他交付项使用的素材。

## 9. 核心推广简报

平台文案不能各自独立理解 Release。先生成一份权威 `PromotionBrief`：

```ts
interface PromotionBrief {
  audience: string;
  userProblem: string;
  primaryAngle: string;
  valueStatement: string;
  evidence: Array<{
    statement: string;
    sourceRef: string;
  }>;
  callToAction: string;
  prohibitedClaims: string[];
  visualBrief: VisualBrief;
}
```

用户确认主传播角度后，各平台适配器只做平台化表达，不重新发明产品定位。

完整推广包属于上一步推广价值分析后的结构化表达，不再开启模型推理模式。生成指令为简报和各平台字段设置明确长度预算，避免推理内容或过长提示词占满输出窗口；首版仍保持单次结构化请求，以减少重复上下文、调用次数和成本。

## 10. 图片提示词

首版不在 Appilot 内生图，而是输出与供应商无关、可以复制到其他 AI 生图平台的结构化提示词。

### 10.1 权威视觉简报

```ts
interface VisualBrief {
  objective: string;
  audience: string;
  concept: string;
  sourceAssetIds: string[];
  primaryAssetId: string;
  composition: string[];
  background: string[];
  palette: string[];
  textOverlay?: {
    text: string;
    placement: string;
  };
  preserveExactly: string[];
  prohibited: string[];
  variants: PlatformVisualVariant[];
}
```

它同时服务两条路径：

```text
VisualBrief
├─ 首版：渲染成外部生图提示词
└─ 后续：转换为 ImageProvider 请求
```

### 10.2 外部生图提示词内容

每个平台交付项必须显示：

- 需要上传的参考图片清单及顺序；
- 图片 1 和图片 2 在构图中的角色；
- 目标比例和裁切安全区域；
- 背景、环境、光线和氛围；
- 必须保持原样的真实产品 UI；
- 可以后期叠加的标题；
- 禁止出现的虚构功能、错误数字、竞争产品标识和伪造徽章；
- 一份已经包含禁止事项、可直接粘贴到 ChatGPT 等工具的完整提示词。

提示词必须明确：不要重新绘制截图中的界面、文字、数字、颜色或布局。由于外部图片模型不能保证遵守，该提示只是风险控制，不是像素完整性保证。

### 10.3 推荐生成方式

首版默认使用**参考图直接合成**：用户将选定截图作为附件交给 ChatGPT 等支持图像输入的平台，并粘贴完整提示词，由 AI 输出可直接使用的成品。提示词内必须写清截图主次关系、构图要求和所有禁止事项，不要求用户寻找单独的 Negative Prompt 输入框。

“只生成背景再手工叠加”不作为首版默认流程，因为 Appilot 当前没有提供确定性合成工具，不能把未闭环的后期工作留给用户。长期仍可由 ImageProvider 配合 Appilot 的确定性合成能力提供更严格的像素完整性。

用户从外部平台生成成品后，可以“导入成品”；成品同样复制到活动的 `generated/` 受管目录并记录哈希。

## 11. 平台交付项

```ts
type Platform = "x" | "reddit" | "facebook";
type DeliveryStatus = "draft" | "ready" | "published" | "skipped";

interface PlatformDelivery {
  id: string;
  campaignId: string;
  platform: Platform;
  targetLabel?: string;
  revision: number;
  content: PlatformContent;
  visualBriefId: string;
  selectedAssetIds: string[];
  status: DeliveryStatus;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}
```

### 11.1 X

输出：

- 一条符合标准帖文长度的主帖；
- 一个备选首句，用于替换主帖开头而不是充当第二篇完整帖子；
- App Store 链接；
- 一份平台视觉变体和图片提示词；
- 最终长度和链接占位校验。

只有强推广或用户明确要求时才生成 Thread。平台限制属于可更新的确定性规则，不硬编码进 AI 提示词作为唯一校验。

推广判断、目标受众、主传播角度等操作者信息使用中文；X、Reddit 和 Facebook 的对外发布文案使用英文；供图片模型使用的完整提示词使用英文。

### 11.2 Reddit

Reddit 交付项绑定一个具体 subreddit。未配置社区时不生成假定通用的 Reddit 广告文案，而是先提示配置目标社区。

输出：

- 社区和目标受众；
- 为什么该版本适合该社区；
- 标题；
- 社区原生正文；
- 明确的开发者身份披露；
- 链接放置建议；
- 建议截图和图片提示词；
- 发帖前检查当前社区规则的提示。

禁止把 X 文案简单扩写，禁止伪装成第三方用户推荐。

### 11.3 Facebook

Facebook 交付项绑定产品 Page、具体 Group 或个人动态中的一种目标表面。没有明确目标时可以建议跳过 Facebook。

输出：

- 面向该目标受众的场景说明；
- 正文和 App Store 链接；
- 一张主视觉或两张截图的使用建议；
- 图片提示词；
- Group 场景下检查当前群组规则的提示。

Facebook 可以复用核心视觉，但不直接复制 X 的短文案。

## 12. 生成与修订

### 12.1 推广价值分析

在要求用户寻找截图之前，先发起一次较短的结构化 AI 请求，仅返回：

- 推广强度建议：`strong`、`light` 或 `skip`；
- 判断理由；
- 推荐的传播角度；
- 推荐平台；
- 推荐寻找的截图类型。

这一步不生成完整平台文案和图片提示词。若建议为 `skip`，用户可以直接结束流程，避免寻找素材和支付完整生成成本；用户也可以覆盖建议并继续。

### 12.2 完整推广包生成

用户确认传播角度并导入截图后，再发起第二次结构化 AI 请求，返回：

- 核心推广简报；
- 用户已启用且具备目标上下文的平台内容；
- 共用视觉简报和平台变体；
- 基于已选截图元数据的图片使用建议和外部 AI 生图提示词。

确定性代码负责 schema 校验、平台长度、必填字段、来源引用和状态迁移。AI 不负责写数据库、判定文件是否存在，也不在首版读取图片二进制。

### 12.3 单平台重新生成

用户要求重做某个平台时，只重新生成该平台交付项。请求仍必须包含：

- 完整来源快照；
- 已确认核心简报；
- 已选择素材的元数据和角色；
- 当前平台文案；
- 用户反馈或拒绝理由。

重新生成不能覆盖其他平台的手工修改。已经发布的修订不可被静默替换；新内容增加修订号。

## 13. 发布操作

首版只提供：

- 复制文案；
- 复制图片提示词；
- 在 Finder 中显示受管素材或导入成品；
- 打开对应平台；
- 用户点击“标记已发布”；
- 撤销误标记但保留审计时间。

不接入平台账号，不声称知道帖子是否真的发送成功。`publishedAt` 是用户确认的运营事件，不是平台回执。

一个平台标记发布后，活动进入 `partially_published`；所有未跳过平台均发布后进入 `published`。

## 14. 图片 API 的后续架构

当前文本 `AIProvider` 基于 OpenAI-compatible Chat Completions。图片生成和编辑在供应商之间没有足够一致的协议，不能直接假定现有文本 Provider 也支持图片。

后续单独引入：

```ts
interface ImageProvider {
  capabilities(): ImageProviderCapabilities;
  estimateCost(request: ImageGenerationRequest): Promise<CostEstimate | null>;
  generate(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
  edit?(request: ImageEditRequest): Promise<ImageGenerationResult>;
  cancel?(operationId: string): Promise<void>;
}
```

能力至少表达：

- 是否支持参考图片和多图输入；
- 支持的尺寸、比例、质量和输出格式；
- 是否支持编辑和高保真输入；
- 费用估算；
- 数据上传和保留说明。

接入条件：真实使用表明用户经常复制图片提示词，且外部平台往返成为主要摩擦。供应商和模型现在不确定。

成本与安全约束：

- 使用用户自己的 API Key；
- 生成前显示供应商、模型、质量、数量和预计最高费用；
- 默认一次只生成一张；
- 只有用户明确触发才生成变体；
- 不自动重试可能已经计费成功的未知结果；
- 记录实际用量和费用；
- 生成结果立即导入受管目录；
- 上传真实截图前明确提示图片将发送给第三方供应商。

## 15. 为产品生命线预留

本方案不恢复“趋势”，也不设计产品生命线的页面、图表或归因算法。只确保推广模块产生稳定事件：

```ts
interface PromotionPublishedEvent {
  id: string;
  campaignId: string;
  projectId: string;
  productId: string;
  releaseId: string;
  appVersion: string;
  platform: Platform;
  deliveryId: string;
  contentRevision: number;
  promotionAngle: string;
  assetIds: string[];
  occurredAt: string;
}
```

事件只能证明“用户在这个时间确认完成了该平台推广”，不能证明推广导致下载或排名变化。未来生命线可以把它与上架、下载和主要排名变化放到同一时间轴，但必须把时间相关性与因果归因分开。

## 16. 信息架构草图

```text
推广
├─ 已上架版本列表
│  ├─ v1.3.0 · 强推广 · 2/3 已发布
│  ├─ v1.2.9 · 轻量更新 · 已完成
│  └─ v1.2.8 · 建议跳过
└─ 活动详情
   ├─ 推广建议与主角度
   ├─ 推广素材（选择 1–2 张 / 导入成品）
   ├─ X
   ├─ Reddit · <subreddit>
   └─ Facebook · <Page/Group/Profile>
```

平台内容可以采用标签或分段切换，但素材和主传播角度属于活动级，不在平台间重复编辑。

## 17. 实施顺序

### P0：数据与素材基础

- 推广档案、活动、交付项、修订和事件的数据结构；
- 已上架版本只读来源快照；
- 素材选择、哈希、原子复制、去重和缺失检测；
- 受管素材预览和安全清理规则。

### P1：推广 MVP

- 独立“推广”导航与版本列表；
- 推广级别判断和核心角度确认；
- X、Reddit、Facebook 平台适配；
- 结构化图片提示词；
- 复制、打开平台、标记已发布；
- 结构化推广事件。

### P2：外部成品与可靠修订

- 导入外部 AI 生成成品；
- 平台选择实际使用的图片；
- 单平台重新生成；
- 发布后修订保护和审计。

### P3：可选 ImageProvider

- 确定首个供应商；
- BYOK、费用预估、输入图片、结果保存、取消与计费保护；
- 优先探索“生成背景 + 本地确定性叠加真实截图”的可靠路径。

### P4：Product Hunt Launch

- 仅面向首发或符合平台规则的重大更新；
- 独立的 tagline、描述、thumbnail、gallery、Maker first comment 和配套社交内容；
- 不复用普通小版本推广的完成条件。

产品生命线在推广事件和真实下载数据积累后另行设计，不属于 P0–P4 的隐含交付。

## 18. 验收标准

- 推广是独立模块，不出现在发布工作台内部；
- 正式推广包只关联已上架版本；
- 首版平台严格限定为 X、Reddit、Facebook；
- Reddit 没有目标社区、Facebook 没有目标表面时不生成伪具体内容；
- Reddit 可根据产品定位推荐候选社区，但不会自动保存，也不会声称已验证社区规则；
- AI 可以建议不推广；
- 每条产品主张可追溯到冻结的发布事实；
- 用户一次选择一至两张截图；
- 选择后图片被复制到 Appilot 受管目录并记录 SHA-256；
- 删除外部原文件不影响活动；
- 受管副本缺失时明确报错并要求重新导入；
- 外部生图提示词明确列出参考图片、角色、构图和禁止事项；
- 提示词不把“保持截图不变”误称为模型能够保证的结果；
- 首版不需要新的图片或社交平台 API Key；
- 单平台重做不覆盖其他平台手工内容；
- 标记已发布形成结构化事件，但不伪装成平台回执；
- 不实现、恢复或暗示已经实现产品生命线；
- ImageProvider 和 Product Hunt 明确保持为后续阶段。

## 19. 仍待后续决定

这些问题不阻塞 P0/P1 规格：

- 受管素材目录与现有备份、导出机制的最终整合方式；
- App 图标作为推广素材的可靠来源；
- 平台规则配置的更新机制；
- 首个 ImageProvider 的供应商和模型；
- 是否以及何时加入确定性宣传图合成器；
- Product Hunt 注册和首次 Launch 的具体产品选择；
- 产品生命线的信息架构与真实下载数据源。

## 20. 时效性参考

以下平台和 API 行为可能变化，实现相应阶段时必须重新核对官方资料：

- X 发帖与链接规则：<https://help.x.com/en/using-x/how-to-post>、<https://help.x.com/en/using-x/how-to-post-a-link>
- Reddit 社区规则：<https://support.reddithelp.com/hc/en-us/articles/360043503951-What-are-Reddit-s-rules>
- Product Hunt Launch Guide：<https://www.producthunt.com/launch>
- Product Hunt Relaunch：<https://help.producthunt.com/en/articles/484934-can-i-relaunch-my-product>
- OpenAI Image API：<https://developers.openai.com/api/docs/guides/image-generation>
