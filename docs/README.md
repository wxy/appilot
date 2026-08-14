# Appilot 设计文档

> 状态：重新定位中 | 作者：@xingyuwang
> 当前版本：2026-08-14 第七次修订（重新定位为 Apple 应用增长 / ASO 运营代理）

## 文档索引

| 文件 | 内容 | 当前方向 |
|------|------|:---:|
| [产品规格](./superpowers/specs/appilot-product.md) | Apple 运营代理：定位、范围、核心流程、agent loop、数据源 | ✅ §1–§2 |
| [架构设计](./superpowers/specs/appilot-architecture.md) | agent loop 架构：采集器 + AI Reasoning + 项目/渠道/关键词/排名模型 | ✅ §3 |
| [构建计划](./superpowers/specs/appilot-build-plan.md) | Apple 运营代理的 Phase A–F | ✅ §13 |
| [评审记录](./superpowers/specs/appilot-review-log.md) | §21 设计转向决策清单 + 数据源验证结果 | ✅ §21 |
| [UI 设计](./superpowers/specs/appilot-ui.md) | 历史 UI（GitHub + Twitter 时代），待按新方向重写 | — |
| [横切关注点](./superpowers/specs/appilot-cross-cutting.md) | 错误处理、日志、安全等基础设施（沿用） | — |

## 实施方案

| 文件 | 内容 |
|------|------|
| [实施方案](./superpowers/specs/appilot-implementation-plan.md) | 历史方案（GitHub + Twitter），待按 Phase A–F 重写 ⚠️ |

## 原始文件

拆分前的完整设计文档保留在 [2025-07-14-appilot-mvp-design.md](./superpowers/specs/2025-07-14-appilot-mvp-design.md)（历史参考，不再更新）。

## 阅读路径

- **了解当前方向** → 产品规格 §2（Apple 运营代理）+ 架构设计 §3（agent loop）+ 构建计划 §13（Phase A–F）
- **了解为什么转向** → 评审记录 §21（设计转向决策清单 + 数据源验证）
- **准备实现** → 构建计划 Phase A–F（what）+ 架构设计 §3（how）
- **历史参考** → 产品规格 §15 起、架构 §4 起、构建计划 §13H（GitHub + Twitter 时代，已废弃）
