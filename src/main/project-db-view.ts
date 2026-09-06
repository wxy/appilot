/**
 * DB → 项目视图组装（阶段二「读侧切换」核心，纯逻辑、无 electron 依赖）。
 *
 * 现状：UI 项目列表（projects:list）的唯一事实源是 electron `kv['projects']`；
 * DB 侧已有 projects(注册表) / product_records / project_meta。本模块把这三者
 * 组装成与 UI 消费相近的“项目视图”，作为读侧切换到 DB 的第一步：
 * - registry 行 → 项目（id 暂取 name：注册表未存 electron project id，见下方注释）；
 * - product_records → storeProducts[]（含 parsed trackedKeywords/storeLinks）；
 * - project_meta → repo 状态；
 * - opts.includeSnapshots=true 时按产品拉取 rank_snapshots（升序历史点），
 *   默认关闭：快照主副本仍在 kv，阶段二后期再把读侧切到 DB。
 *
 * ⚠️ id 说明：electron kv 中的 project.id 未镜像进注册表；当前 electron 项目 id
 * 与 name 一致，故以 name 兜底。若历史存在不一致，需先在注册表补 id 列再切读侧。
 */

import type { AppilotStore } from '@appilot-labs/appilot-headless';

export interface DbProjectView {
  name: string;
  id: string;
  localPath: string;
  productType: string | null;
  supportedLanguages: { code: string; name: string }[];
  artworkUrl: string | null;
  repo: {
    githubUrl: string | null;
    remoteUrl: string | null;
    headSha: string | null;
    headDate: string | null;
    capturedAt: string | null;
  } | null;
  storeProducts: {
    id: string;
    platform: string;
    trackId: number | null;
    bundleId: string | null;
    trackName: string | null;
    artworkUrl: string | null;
    supportedLanguages: { code: string; name: string }[];
    trackedKeywords: unknown[];
    storeLinks: unknown[];
    rankSnapshots: unknown[];
  }[];
}

const SNAPSHOT_READ_LIMIT = 200_000;

export interface AssembleOptions {
  includeSnapshots?: boolean;
}

export function assembleProjectViews(
  store: AppilotStore,
  opts: AssembleOptions = {},
): DbProjectView[] {
  return store.projects.list().map((rec) => {
    const products = store.products.listByProject(rec.name);
    const meta = store.meta.get(rec.name);
    const languages = new Map<string, { code: string; name: string }>();
    for (const code of rec.languages || []) languages.set(code, { code, name: code });
    for (const p of products) {
      for (const code of p.supportedLanguages || []) {
        if (!languages.has(code)) languages.set(code, { code, name: code });
      }
    }

    const storeProducts = products.map((p) => {
      let rankSnapshots: unknown[] = [];
      if (opts.includeSnapshots) {
        const rows = store.snapshots.recent(rec.name, {
          productId: p.productId,
          limit: SNAPSHOT_READ_LIMIT,
        });
        // recent 为 checkedAt 降序（最新在前）→ 翻转为升序历史点
        rankSnapshots = [...rows].reverse();
      }
      return {
        id: p.productId,
        platform: p.platform ?? 'unknown',
        trackId: p.trackId,
        bundleId: p.bundleId,
        trackName: p.trackName,
        artworkUrl: p.artworkUrl,
        supportedLanguages: (p.supportedLanguages || []).map((code) => ({ code, name: code })),
        trackedKeywords: p.trackedKeywords ?? [],
        storeLinks: p.storeLinks ?? [],
        rankSnapshots,
      };
    });

    return {
      name: rec.name,
      id: rec.name, // 注册表未存 electron project id；当前 id 与 name 一致，以此兜底
      localPath: rec.path,
      productType:
        rec.platform === 'ios' || rec.platform === 'macos' ? rec.platform : null,
      supportedLanguages: [...languages.values()],
      artworkUrl: rec.artworkUrl ?? storeProducts.find((p) => p.artworkUrl)?.artworkUrl ?? null,
      repo: meta
        ? {
            githubUrl: meta.githubUrl,
            remoteUrl: meta.githubUrl,
            headSha: meta.headSha,
            headDate: meta.headDate,
            capturedAt: meta.updatedAt,
          }
        : rec.githubUrl
          ? {
              githubUrl: rec.githubUrl,
              remoteUrl: rec.githubUrl,
              headSha: null,
              headDate: null,
              capturedAt: rec.updatedAt,
            }
          : null,
      storeProducts,
    };
  });
}
