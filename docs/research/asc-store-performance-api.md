# ASC 商店表现 API 结论与经验

日期：2026-08-29  
状态：暂停 / 放弃当前实现

## 1. 背景与目标

总览页曾计划新增“商店表现”卡片，展示 App Store Connect 最近 30 天的：

- 商品页浏览量（page views）
- 下载量（downloads）
- 浏览到下载的转化率（conversion rate）

实现尝试使用 App Store Connect Analytics Reports API：

```text
GET  /apps/{appId}/analyticsReportRequests
POST /analyticsReportRequests
GET  /analyticsReportRequests/{id}/reports
GET  /analyticsReports/{id}/instances
GET  /analyticsReportInstances/{id}/segments
```

目标是同步 TSV segment 后聚合成 30 天摘要，并放入定时任务缓存。

## 2. 最终结论

**当前产品不采用该模块。**

核心原因不是工程实现困难，而是 Apple 的权限模型要求过重：

1. Analytics Reports API 的 report request 需要至少一次 Admin 权限创建。
2. Finance、Sales and Reports 角色可以读取已有报表，但不能创建 request。
3. App Manager 角色不能访问 Analytics Reports API。
4. 无法依赖“用户 ASC 里已经有现成 request”，因为普通新用户不能保证存在。
5. 要求用户临时换 Admin key 再换回低权限 key，对真实用户不可接受，也带来不必要的安全风险。

因此，即使技术上能解析 TSV，也不应该把这个能力放进当前用户流程。

## 3. 实测结果

使用当前 App Manager API key 验证：

| 接口 | 结果 | 说明 |
| --- | ---: | --- |
| `/apps/{id}/appStoreVersions` | 200 | 可读版本信息 |
| `/apps/{id}/builds` | 200 | 可读构建状态 |
| `/apps/{id}/customerReviews` | 200 | 可读用户评论 |
| `/apps/{id}/analyticsReportRequests` | 403 | App Manager 不能访问 Analytics Reports |

Sales Reports / Finance Reports 是另一类官方报表，主要面向销量、收入、下载单位等；即使可读，也不能替代 App Analytics 的 impressions、page views、conversion 漏斗数据。

## 4. API 结构经验

Analytics Reports API 是异步报表流水线：

1. `analyticsReportRequests` 表示持续或一次性的报表请求。
2. `analyticsReports` 表示某个请求下可用的报表类别。
3. `analyticsReportInstances` 表示某个处理日期的报表实例。
4. `analyticsReportInstances/{id}/segments` 返回 TSV segment 下载地址。
5. segment URL 是预签名地址，下载时不需要再带 Authorization header。

容易踩到的点：

- `granularity` 不是 report request 的有效 filter；request 使用 `accessType`，如 `ONGOING`。
- `ONGOING` request 会生成 daily / weekly / monthly 数据，granularity 属于报表实例层，不是 request filter。
- 首次创建 request 后，报表通常需要 1–2 天才生成。
- 长期不读取报表，request 可能因 inactivity 停止，恢复仍可能需要 Admin 权限。
- API 错误不应静默吞掉；否则 403 会伪装成“暂无数据”。

## 5. 产品边界

当前 Appilot 仍保留 App Manager 密钥可以支撑的能力：

- 构建状态同步
- App Store 版本同步
- 商店元数据同步
- 用户评论读取

但不再把“商店表现”作为当前功能目标。

未来只有以下情况才值得重启：

1. Apple 提供 App Manager 可读的直接 App Analytics endpoint。
2. Apple 允许 App Manager 或更细粒度 scope 创建/读取 Analytics report request。
3. ASC 网页提供可安全授权的报表订阅流程，而不是要求临时 Admin API key。

## 6. 如果未来重启

建议采用显式高级初始化流程，而不是在普通同步里隐式请求：

```text
默认密钥：Sales and Reports
启动检查：GET /apps/{id}/analyticsReportRequests

有 ONGOING request：
  -> 正常读取 reports / instances / segments

没有 ONGOING request：
  -> 明确提示需要一次性 Admin bootstrap
  -> Admin key 只在内存中使用
  -> 只执行 POST 创建 request
  -> 立即从应用中清除
  -> 引导用户在 ASC 撤销 Admin key
  -> 日常继续使用 Sales and Reports key
```

但这条流程不适合作为默认路径，也不应要求所有用户完成。
