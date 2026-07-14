# AppPost 设计文档

> 状态：设计阶段 | 作者：@xingyuwang
> 当前版本：2026-07-14 第四次修订

## 文档索引

| 文件 | 内容 | 行数 |
|------|------|------|
| [产品规格](./superpowers/specs/apppost-product.md) | 定位与愿景、MVP 范围（平台与功能）、开放问题、分级追踪模型 | ~140 |
| [架构设计](./superpowers/specs/apppost-architecture.md) | 分层架构、Core Engine 组件、Plugin 接口、AI Engine、数据模型 | ~1000 |
| [UI 设计](./superpowers/specs/apppost-ui.md) | 首次使用流程、主窗口布局、Composer/Inbox/Analytics 原型 | ~260 |
| [构建计划](./superpowers/specs/apppost-build-plan.md) | Phase 0～5 交付清单 | ~100 |
| [横切关注点](./superpowers/specs/apppost-cross-cutting.md) | 错误处理、日志、i18n、安全、后台策略、项目结构 | ~150 |
| [评审记录](./superpowers/specs/apppost-review-log.md) | 历次评审发现的 P0/P1/P2 风险及落地状态 | ~90 |

## 实施方案

| 文件 | 内容 |
|------|------|
| [实施方案](./superpowers/specs/2026-07-14-apppost-implementation-plan.md) | 任务拆解、工时估算、执行规范（⚠️ 待更新——设计已多次修订） |

## 原始文件

拆分前的完整设计文档保留在 [2025-07-14-apppost-mvp-design.md](./superpowers/specs/2025-07-14-apppost-mvp-design.md)（历史参考，不再更新）。

## 阅读路径

- **新加入项目的开发者** → 先读产品规格，再读架构设计
- **需要了解"为什么这样设计"** → 评审记录中的 P0/P1/P2 风险和决策理由
- **需要实现某个 Phase** → 构建计划（what）+ 架构设计（how）
- **设计 UI** → UI 设计中的 ASCII 原型
- **了解基础设施要求** → 横切关注点
