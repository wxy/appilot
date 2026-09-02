/**
 * @appilot-labs/appilot-headless — Appilot 无头核心包。
 *
 * 定位：单一核心，多个薄壳（Electron / DSH / CLI / MCP）共用的数据与调度层。
 * 本阶段（Phase 1）提供 SQLite Store；调度器租约见后续阶段。
 */
export { SCHEMA_VERSION } from './schema.js';
export type { ProjectRow, RankSnapshotRow, TaskRow, LeaseRow } from './schema.js';
export { openStore } from './store.js';
export type { AppilotStore } from './store.js';
