/**
 * 写侧切换的统一入口（纯逻辑、无 electron 依赖）：把一个 electron 项目（kv 里的
 * 富对象）完整镜像到共享 DB——注册表(projects, 含 id) + project_meta + product_records
 * （含 submissionKeywords/removedKeywords 扩展列）。
 *
 * 供各写 handler（add/updateSettings/saveTrackedKeywords/removeTrackedKeyword/
 * restore/resume/clearRemoved…）在写完 kv 后立即调用，保证读侧（DB 组装，见
 * project-db-view / project-list-merge）无滞后；比依赖 registry-sync 轮询
 * 更及时。未来 kv 退役后，本函数成为写入 DB 的唯一路径。
 */
import type { AppilotStore } from '@appilot-labs/appilot-headless';
import { registryRecordOf } from './registry-sync-core';
import { toProductRows, toProjectMeta, type ElectronProjectRich } from './rich-data-sync';

export interface WriteSyncResult {
  /** 是否写注册表（name/localPath 齐备才算有效项目） */
  registry: boolean;
  meta: number;
  products: number;
}

export function syncProjectToDb(
  store: AppilotStore,
  project: ElectronProjectRich,
): WriteSyncResult {
  const hasIdentity = Boolean(project?.name && project?.localPath);
  if (!hasIdentity) {
    return { registry: false, meta: 0, products: 0 };
  }
  store.projects.save(registryRecordOf(project));
  let meta = 0;
  const m = toProjectMeta(project);
  if (m) {
    store.meta.save(m);
    meta = 1;
  }
  const rows = toProductRows(project);
  for (const row of rows) store.products.upsert(row);
  // 草稿(storeSubmissionDrafts) 镜像进 project_blobs（写切(2) 前置：kv projects
  // 退役后草稿仍可读）。仅当字段存在时更新。⚠️ 防误清：快照里草稿为空数组但 DB
  // 已有非空草稿时跳过（避免不含草稿的快照把发布历史草稿覆盖成空）。
  if (Object.prototype.hasOwnProperty.call(project, "storeSubmissionDrafts")) {
    try {
      const drafts = Array.isArray(project.storeSubmissionDrafts) ? project.storeSubmissionDrafts : [];
      if (drafts.length === 0) {
        const existing = store.blobs.get("storeSubmissionDrafts", String(project.name));
        if (Array.isArray(existing) && existing.length > 0) return { registry: true, meta, products: rows.length };
      }
      store.blobs.put("storeSubmissionDrafts", String(project.name), drafts);
    } catch (err: any) {
      // 草稿镜像失败不阻断项目同步
    }
  }
  return { registry: true, meta, products: rows.length };
}
