# Appilot 设计文档

> 状态：设计阶段 | 作者：@xingyuwang
> 当前版本：2026-07-15 第五次修订（Phase 0 最小闭环简化 + 审核意见落地）

## 文档索引

| 文件 | 内容 | Phase 0 相关性 |
|------|------|:---:|
| [产品规格](./superpowers/specs/appilot-product.md) | 定位与愿景、Phase 0 最小闭环范围、完整 MVP 范围、分级追踪模型 | ✅ §1.5 |
| [架构设计](./superpowers/specs/appilot-architecture.md) | 分层架构（含 Phase 0 简化架构）、Core Engine 组件（标注 Phase 0 实现哪些）、Plugin 接口、AI Engine、Phase 0 vs 完整 Schema | ✅ §3.0, §7.0 |
| [UI 设计](./superpowers/specs/appilot-ui.md) | Phase 0 3 屏最小 UI（§8.0）+ 完整 UI 愿景（§8.1–§8.8） | ✅ §8.0 |
| [构建计划](./superpowers/specs/appilot-build-plan.md) | Phase 0～5 交付清单（Phase 0 已重写为最小闭环，约 17 天） | ✅ Phase 0 |
| [横切关注点](./superpowers/specs/appilot-cross-cutting.md) | 错误处理、安全等基础设施（标注 Phase 0 vs Phase 1+） | ✅ 标注分明 |
| [评审记录](./superpowers/specs/appilot-review-log.md) | P0/P1/P2 风险 + 二次复核 + §19 Phase 0 简化评审 | ✅ §19 |

## 实施方案

| 文件 | 内容 |
|------|------|
| [实施方案](./superpowers/specs/2026-07-14-apppost-implementation-plan.md) | ⚠️ 已过时，基于旧设计的任务拆解。**待基于新 Phase 0 范围重写**。当前文件仅保留结构参考 |

## 原始文件

拆分前的完整设计文档保留在 [2025-07-14-appilot-mvp-design.md](./superpowers/specs/2025-07-14-appilot-mvp-design.md)（历史参考，不再更新）。

## 阅读路径

- **新加入项目的开发者** → 先读产品规格 §1.5（Phase 0 最小闭环），再读架构设计 §3.0 + §7.0（Phase 0 简化架构和 Schema）
- **需要了解"为什么这样设计"** → 评审记录 §19（Phase 0 简化评审）和 §16（完整评审中的 P0/P1/P2 风险）
- **需要实现 Phase 0** → 构建计划 Phase 0（what）+ 架构设计 §3.0/§7.0（how）+ UI 设计 §8.0（screens）
- **了解完整产品愿景** → 产品规格 §2–§17（完整 MVP 范围，Phase 0–5 全部完成后）
- **了解基础设施要求** → 横切关注点（注意 Phase 0 标注）
