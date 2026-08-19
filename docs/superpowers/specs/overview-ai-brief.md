# 总览副驾驶简报（Overview AI Brief）设计规格

> 所属：[Appilot 设计文档集](./README.md) | 日期：2026-08-20 | 状态：已确认
> 关联：总览页现状见 [appilot-ui.md §8.4](./appilot-ui.md)（副驾驶简报 = hero）、[appilot-product.md §2](./appilot-product.md)（AI 运营代理定位）。

## 1. 定位

总览页顶部的「副驾驶简报」卡片，回答一句话问题：**现在该做什么**。

- 是全页最醒目的 hero，位于指标行上方；
- 产出 ≤3 条可执行建议，每条引用真实数据、可跳转到对应页面、可「采纳/忽略」；
- **只建议、不执行**：采纳只做记录与跳转，不直接修改 App Store 元数据（Human-in-the-loop）。

## 2. 数据输入（全部为现有数据，不新增采集）

| 输入 | 来源 | 用途 |
|---|---|---|
| 近 14 天排名变化（进榜/掉榜/升降，按词×语言×商店） | `product.rankSnapshots` | 掉榜提醒、上升确认 |
| 关键词统计（跟踪数、入榜数、前 10、暂停数） | `product.trackedKeywords` | 覆盖度判断 |
| 发布状态（草稿版本、语言进度、母本/整批确定、storeStatus） | `release:list` + `storeSubmissionDrafts` | 发布待办 |
| 产品档案（名称、README 描述、支持语言、平台） | 项目记录 + `readRepoDescription` | 上下文 |
| 提交关键词 vs 跟踪关键词 | `product.submissionKeywords` | 覆盖缺口 |

## 3. 输出结构

一次生成返回最多 3 条建议，严格 JSON：

```json
{
  "suggestions": [
    {
      "title": "把 night walk 加入英文跟踪",
      "reason": "美区 #5 → #12，近 7 天持续下滑，且未覆盖该词",
      "action": "keywords",
      "target": "night walk"
    }
  ]
}
```

- `action` ∈ `keywords | release | trend`，`target` 为可选辅助字段；
- 建议的稳定 `id` 由 `title + action + target` 哈希生成，用于去重（同一条建议重复生成/采纳/忽略可识别）；
- `reason` 必须引用给定数据，不允许编造。

## 4. 规则信号（无 AI 兜底）

AI 未配置、未生成或生成失败时，用确定性规则提供同构信号（同样 ≤3 条、可采纳/忽略、可跳转）：

1. 关键词排名下滑（`rankRows` 中 trend = down）→ 排名页；
2. 发布文案未补齐（`generatedLanguageCount < languageTotal`）→ 发布工作台；
3. 无跟踪关键词 → 排名页生成；否则存在暂停关键词 → 排名页处理。

规则信号与 AI 建议共用同一 UI 与动作日志。

## 5. UI 与交互

卡片位于指标行上方，四种状态：

| 状态 | 内容 |
|---|---|
| idle | 规则信号（若有）+ 「生成简报」按钮 |
| loading | 骨架 + 进度（复用 thinking/content 进度模式） |
| ready | AI 建议列表，逐条 [采纳] [忽略]，已处理条目不再显示；全部处理完显示「本周事项已清空」 |
| error | 错误文案 + 重试按钮；AI 未配置时引导去设置页 |

每条建议：序号 + 标题 + 原因（一行，悬停看全文）+ 动作徽标 + [采纳] [忽略]。

采纳：记录 + 跳转对应页面（`keywords` → 排名页，`release` → 发布工作台）；忽略：记录，同 id 不再展示。

## 6. 存储

- 建议本身不持久化（每次生成取最新数据）；
- 动作日志持久化在项目记录：`project.briefActions: [{ id, action, status: adopted|ignored, createdAt }]`，按 id 去重（upsert），上限 200 条；
- 动作日志是反馈闭环的地基：后续「长期效果」页可展示「采纳 X → 两周后排名变化」。

## 7. 边界与约束

- 只建议不执行；跳转只指向 Appilot 内部页面；
- 防幻觉：上下文只给真实数据，要求 reason 引用数据，JSON schema 校验，空结果抛错；
- 成本控制：一次生成 1 次调用，`maxTokens` 4000、`thinking` disabled、输出仅几百 token；
- 多平台：按当前查看的平台生成（与整页视图一致）；跨平台汇总建议等汇总视图落地后再做；
- 触发方式：仅手动「生成简报」，不做自动调度（成本可控；每日自动生成列入后续里程碑）。

## 8. 里程碑

- **M1**：简报卡骨架 + 规则信号（纯渲染层，无 AI 也能用）；
- **M2**：AI 生成（引擎 + IPC + UI 完整闭环）；
- **M3（后续计划，不在本规格实施范围）**：每日自动生成、建议效果追踪（长期效果时间线）、多平台汇总建议。
