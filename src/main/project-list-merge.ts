/**
 * 读侧切换的合并层（纯逻辑、无 electron 依赖）：
 * DB 组装视图(assembleProjectViews)为主，electron kv['projects'] 仅作兜底补齐：
 * - 只补 DB 尚无/滞后的字段（如 createdAt、repo 全字段、DB 快照为空时用 kv 快照），
 *   其余（注册表/产品/关键词/扩展列/快照）以 DB 为准；
 * - kv 中存在但 DB 尚未同步的“新鲜项目”原样保留（registry 同步有 ~300ms 防抖）；
 * - DB 视图无法覆盖的字段缺失不会丢数据。
 *
 * 目标：切换后 UI 列表与切换前（纯 kv）在数据上等价；DB 逐渐补齐后即可去掉 kv。
 */
import type { DbProjectView } from './project-db-view';

/** 合并输出：DB 视图 + kv 兜底字段（createdAt 等）。 */
export type UiProduct = DbProjectView['storeProducts'][number] & {
  createdAt?: string | null;
};
export type MergedUiProject = Omit<DbProjectView, 'storeProducts'> & {
  createdAt?: string | null;
  storeProducts: UiProduct[];
};

export interface MergeOutcome {
  projects: MergedUiProject[];
  /** 来自 kv 兜底（DB 缺失）的项目 id */
  fromKvOnlyIds: string[];
  /** DB 视图 id 列表 */
  dbIds: string[];
}

/** 兜底补齐时从 kv 侧继承的顶层键（DB 视图缺、但 UI 仍消费的字段）。 */
const PROJECT_FALLBACK_KEYS = ['createdAt', 'repo', 'artworkUrl', 'storeSubmissionDrafts'] as const;
/** 产品级兜底键。 */
const PRODUCT_FALLBACK_KEYS = ['createdAt'] as const;
/** 产品级"rich 字段"：DB 为空/缺失时以 kv 为准（文案/关键词/移除/语言/链接）。 */
const PRODUCT_RICH_KEYS = [
  'trackedKeywords',
  'submissionKeywords',
  'removedKeywords',
  'storeLinks',
  'supportedLanguages',
] as const;

function pick<K extends string>(obj: Record<string, unknown>, keys: readonly K[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

export function buildUiProjects(
  dbViews: DbProjectView[],
  kvProjects: any[],
): MergeOutcome {
  const dbById = new Map<string, DbProjectView>();
  for (const v of dbViews) dbById.set(v.id, v);

  const fromKvOnlyIds: string[] = [];
  const projects: MergedUiProject[] = [];

  for (const kv of kvProjects || []) {
    if (!kv || typeof kv !== 'object' || !kv.id) continue;
    const db = dbById.get(kv.id);
    if (!db) {
      // DB 尚未同步该“新鲜项目”：原样保留（原 kv 对象）
      fromKvOnlyIds.push(kv.id);
      projects.push(kv as MergedUiProject);
      continue;
    }

    // 产品合并：以 DB 产品为准，补齐 kv 侧额外字段；快照 DB 为空且 kv 有值时用 kv
    const kvProducts = Array.isArray(kv.storeProducts) ? kv.storeProducts : [];
    const storeProducts = (db.storeProducts || []).map((dp) => {
      const kp = kvProducts.find((p: any) => p && p.id === dp.id);
      if (!kp) return dp;
      const extra = pick(kp, PRODUCT_FALLBACK_KEYS);
      const rich: Record<string, unknown> = {};
      for (const key of PRODUCT_RICH_KEYS) {
        const dbVal = (dp as Record<string, unknown>)[key];
        const kvVal = (kp as Record<string, unknown>)[key];
        // DB 侧为空/缺列而 kv 有值时，以 kv 为准（保文案/关键词不丢、语言名不退化）
        const dbEmpty = dbVal == null || (Array.isArray(dbVal) && dbVal.length === 0);
        if (dbEmpty && Array.isArray(kvVal) && kvVal.length > 0) rich[key] = kvVal;
      }
      const rankSnapshots =
        Array.isArray(dp.rankSnapshots) && dp.rankSnapshots.length > 0
          ? dp.rankSnapshots
          : Array.isArray(kp.rankSnapshots)
            ? kp.rankSnapshots
            : [];
      return { ...dp, ...extra, ...rich, rankSnapshots };
    });

    const fallback = pick(kv, PROJECT_FALLBACK_KEYS);
    // 项目级语言对象以 kv 为准（带真实展示名）；DB 只存 code 清单
    const langs =
      Array.isArray(kv.supportedLanguages) && kv.supportedLanguages.length > 0
        ? kv.supportedLanguages
        : db.supportedLanguages;
    projects.push({ ...db, ...fallback, supportedLanguages: langs, storeProducts } as MergedUiProject);
  }

  // DB 里有、kv 里没有（如 DSH/hydrate 新增但 kv 尚未补回）的项目也展示
  const kvIds = new Set((kvProjects || []).map((p: any) => p?.id).filter(Boolean));
  for (const v of dbViews) {
    if (!kvIds.has(v.id)) projects.push(v as MergedUiProject);
  }

  return { projects, fromKvOnlyIds, dbIds: [...dbById.keys()] };
}
