# Future schedule balancing

Implemented in headless scheduling; no renderer dependency.

- Only enabled rank tasks with explicit automatic provenance, no current-round adjustment, and a non-error status are eligible. Unknown legacy schedules, manual schedules and retries remain protected.
- Every 15 minutes the leader considers the next 24 hours. The first 30 minutes are frozen. Acceleration, suspension and iTunes circuit-breaker cooldown suppress balancing.
- A 15-minute bucket's target capacity is ceil(1.5 × enabled future tasks within 24 hours / 96). All task kinds contribute to load, but only eligible rank tasks can move.
- Move only surplus tasks earlier, by at most min(4 hours, 20% of interval), never before last execution + 80% of interval. Prefer lower-load buckets, breaking ties by proximity. Insufficient earlier capacity leaves residual peaks intact.
- scheduleJson stores origin, originalDueAt and balancedAt. Each cycle can be adjusted once. After an advanced cycle executes, its next deadline is based on originalDueAt + interval, skipping already elapsed cycles. This prevents cumulative phase drift.
- Generic writes that change deadline or interval discard provenance. Store compare-and-set rejects stale balancing plans after intervening edits. Successful ordinary automatic execution establishes provenance for the next cycle; runNow and accelerated execution protect the next cycle as manual. Retry writes preserve the original cycle anchor but exclude the retry from balancing.
- Schema v15 adds nullable scheduleJson. Legacy rows remain null; migration does not rebalance or infer historical intent. Thus rollout is gradual after normal automatic executions, not an immediate redistribution of all legacy tasks.
- Per-task logs contain before/after deadlines; batch logs contain applied count, target capacity and planned peak. The last balancing check is persisted across daemon restarts.

Validation: pure planning and temporary SQLite tests cover bounds, unknown/manual/retry/disabled/error exclusions, repeat planning, persistence, stale-plan rejection, cycle anchoring, manual execution and v14 migration. Production sleep/wake acceptance remains separate.
