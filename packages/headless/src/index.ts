/**
 * @appilot-labs/appilot-headless — Appilot 无头核心包。
 *
 * 定位：单一核心，多个薄壳（Electron / DSH / CLI / MCP）共用的数据与调度层。
 * Phase 1：SQLite Store（WAL + 事务 + 租约）；Phase 2：统一 DB 路径 + 旧 JSON 迁移。
 */
export { SCHEMA_VERSION } from './schema.js';
export type { ProjectRow, RankSnapshotRow, TaskRow, LeaseRow, ProjectMetaRow, ProductRecordRow, ReleaseCacheRow } from './schema.js';
export { openStore } from './store.js';
export type { AppilotStore } from './store.js';
export { defaultDbPath, defaultLegacyRegistryPath, importLegacyRegistry } from './paths.js';
export { createLeaseScheduler } from './scheduler.js';
export type {
  ScheduledJob,
  ScheduledJobContext,
  LeaseScheduler,
  LeaseSchedulerOptions,
  TaskExecutor,
  TaskExecutorContext,
  SchedulerAccelOptions,
} from './scheduler.js';
export { createHeadlessService } from './service.js';
export type { HeadlessService } from './service.js';
export { buildHeadlessJobs } from './jobs.js';
export type { HeadlessJobsOptions } from './jobs.js';
export {
  buildHeadlessExecutors,
  buildRankExecutor,
  runRankInstance,
  GITHUB_SYNC_KIND,
  GITHUB_SYNC_INTERVAL_MINUTES,
  RANK_KIND,
  RANK_INTERVAL_MINUTES,
} from './executors.js';
export type { HeadlessExecutorsOptions, GithubSyncInstanceArgs, RankInstanceArgs } from './executors.js';
export { githubSyncInstancesFor, rankInstancesFor, reconcileTaskInstances } from './instances.js';
export type { TaskInstanceSpec, ReconcileResult, KeywordPoolEntry, RankInstancesOptions } from './instances.js';
