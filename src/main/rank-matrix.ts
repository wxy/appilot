/**
 * 排名采集覆盖热力图数据层（原型确认后落 React 版）。
 *
 * 全局监督视图：产品 × (语言×商店) 矩阵，每格点阵 = 关键字每 5 词一桶，
 * 桶色 = 该桶在窗口内的采集覆盖状态。回答「哪些市场的排名关键词覆盖齐全、哪里掉队」。
 *
 * 语义（与原型一致）：
 * - 窗口：成功快照 checkedAt 距今 ≤ 12h（严格周期对齐）算"采到"；
 * - 桶状态：任一 error → 红；全采到 → 绿；部分 → 黄；0 且全部未到期 → 灰
 *   （等待中，正常）；0 且有已到期未采 → 橙（掉队）。
 * - 列 = (queryLanguage × storefront)：同一商店跟踪多语言时分列；
 *   格 = product × 该 (语言, 商店) 下全部 keyword 实例。
 * - 产品行标签用仓库名（projectName）+ 平台（UI 层拼装），productId 仅作身份/兜底。
 *
 * 纯 node（不 import electron），可单测。
 */
import type { AppilotStore, TaskRow } from '@appilot-labs/appilot-headless';
import { STOREFRONTS_BY_LANGUAGE } from '@appilot-labs/appilot-core/storefronts';

/** 英语地区商店（英语关键词×英语商店 = "英语"组；×其他语言商店 = "全局"组）。 */
const EN_STOREFRONTS = new Set(STOREFRONTS_BY_LANGUAGE.en ?? []);

/** 每桶关键词数（用户确认 4 词一桶，更细粒度）。 */
export const COVERAGE_BUCKET_KEYWORDS = 4;
/** 覆盖窗口：成功快照不超过此时长即视为本轮已采到（严格 12h）。 */
export const COVERAGE_WINDOW_MS = 12 * 60 * 60 * 1000;

export type BucketTone = 'cov' | 'half' | 'part' | 'err' | 'pend' | 'stale';

export interface MatrixBucket {
  tone: BucketTone;
  /** 桶内元素（keyword@lang），用于 hover 明细。 */
  keywords: Array<{ keyword: string; lang: string }>;
}

export interface MatrixColumn {
  lang: string;
  storefront: string;
  /**
   * 展示分组（表头合并行）：
   * - 'local:en'：英语关键词 × 英语地区商店（英语组）
   * - 'global'：英语关键词 × 其他语言商店（全局组——英语是全球通用检索语言）
   * - 'local:<lang>'：本地化语言关键词（按 lang 分组，不区分商店地区）
   */
  group: string;
}

/** 列分组名（local:en / global / local:de …）。 */
export function columnGroupOf(lang: string, storefront: string): string {
  if (lang === 'en') {
    return EN_STOREFRONTS.has(storefront) ? 'local:en' : 'global';
  }
  return `local:${lang}`;
}

export interface MatrixCell {
  /** 该格关键字实例数（0 = 该产品不跟踪此 (语言,商店)）。 */
  total: number;
  buckets: MatrixBucket[];
}

export interface MatrixRow {
  /** productId（含平台段，如 msszspx4-r12ipi:ios）。 */
  productId: string;
  /** 仓库名（product_records.projectName；行标签主体）。 */
  projectName: string | null;
  /** 平台（ios/macos…）。 */
  platform: string | null;
  /** product_records trackName（hover 补充）。 */
  productName: string | null;
  /** cells 与 columns 对齐（无跟踪的列为空 cell）。 */
  cells: MatrixCell[];
}

export interface RankCoverageMatrix {
  columns: MatrixColumn[];
  rows: MatrixRow[];
  /** 聚合时刻（ISO）。 */
  generatedAt: string;
}

/** 单桶基调（最差优先：error > 过期未采 > 覆盖比例）。 */
export function bucketTone(
  insts: TaskRow[],
  latestByKey: Record<string, string>,
  now: number,
  windowMs: number = COVERAGE_WINDOW_MS,
): { tone: BucketTone; keywords: Array<{ keyword: string; lang: string }> } {
  let err = 0;
  let cov = 0;
  let pend = 0;
  let stale = 0;
  const keywords = insts.map((it) => ({
    keyword: String((it.instance as any)?.keyword ?? it.id),
    lang: String((it.instance as any)?.queryLanguage ?? 'en'),
  }));
  for (const it of insts) {
    const inst = (it.instance ?? {}) as any;
    if (it.lastStatus === 'error') {
      err += 1;
      continue;
    }
    const latest = latestByKey[`${inst.productId}|${inst.keyword}|${inst.queryLanguage ?? 'en'}|${inst.storefront}`];
    if (latest && now - new Date(latest).getTime() <= windowMs) cov += 1;
    else if (it.nextRunAt && new Date(it.nextRunAt).getTime() > now) pend += 1;
    else stale += 1;
  }
  // 色阶（用户确认）：满→绿；≥半数→中间（青，没采完但过半）；(0,半)→黄；
  // 有失败→红；0 且未到期→灰；0 且有已到期未采→橙
  const len = insts.length;
  const tone: BucketTone =
    err > 0
      ? 'err'
      : len > 0 && cov === len
        ? 'cov'
        : len > 0 && cov / len >= 0.5
          ? 'half'
          : cov > 0
            ? 'part'
            : stale > 0
              ? 'stale'
              : 'pend';
  return { tone, keywords };
}

/** 组内实例按 (keyword, lang) 排序后每 N 个一桶。 */
export function chunkInstances(insts: TaskRow[], size: number = COVERAGE_BUCKET_KEYWORDS): TaskRow[][] {
  const sorted = [...insts].sort((a, b) => {
    const ka = String(((a.instance ?? {}) as any)?.keyword ?? '');
    const kb = String(((b.instance ?? {}) as any)?.keyword ?? '');
    const la = String(((a.instance ?? {}) as any)?.queryLanguage ?? '');
    const lb = String(((b.instance ?? {}) as any)?.queryLanguage ?? '');
    return (ka + '|' + la).localeCompare(kb + '|' + lb);
  });
  const out: TaskRow[][] = [];
  for (let i = 0; i < sorted.length; i += size) out.push(sorted.slice(i, i + size));
  return out;
}

/** 构建覆盖热力图（DB 直读；window/now 可注入以便测试）。 */
export function buildRankCoverageMatrix(
  store: AppilotStore,
  opts: { now?: number; windowMs?: number } = {},
): RankCoverageMatrix {
  const now = opts.now ?? Date.now();
  const windowMs = opts.windowMs ?? COVERAGE_WINDOW_MS;
  const latestByKey = store.snapshots.latestCheckedAtByKey();

  const rankInsts = store.tasks.all().filter((t) => t.kind === 'rank');
  // 组：productId × lang × storefront
  const groups = new Map<string, TaskRow[]>();
  for (const t of rankInsts) {
    const inst = (t.instance ?? {}) as any;
    if (!inst.productId || !inst.storefront) continue;
    const lang = String(inst.queryLanguage ?? 'en');
    const k = `${inst.productId}|${lang}|${inst.storefront}`;
    (groups.get(k) ?? groups.set(k, [] as TaskRow[]).get(k)!)!.push(t);
  }

  // 产品元信息（仓库名/平台/trackName）
  const metaByProduct = new Map<string, { projectName: string | null; platform: string | null; productName: string | null }>();
  for (const p of store.projects.list()) {
    for (const pr of store.products.listByProject(p.name)) {
      metaByProduct.set(pr.productId, {
        projectName: p.name,
        platform: pr.platform ?? null,
        productName: pr.trackName ?? null,
      });
    }
  }

  // 列 = (lang, storefront) 并集。分组：英语组(英语×英语商店) → 全局组
  // (英语×其他语言商店) → 其余本地化语言组。组内按 (lang, storefront) 排序。
  const colSet = new Set<string>();
  for (const k of groups.keys()) {
    const [, lang, storefront] = k.split('|');
    colSet.add(`${lang}|${storefront}`);
  }
  const groupRank = (g: string) =>
    g === 'local:en' ? 0 : g === 'global' ? 1 : 2;
  const columns: MatrixColumn[] = [...colSet]
    .map((s) => {
      const [lang, storefront] = s.split('|');
      return { lang, storefront, group: columnGroupOf(lang, storefront) };
    })
    .sort((a, b) => {
      const ga = groupRank(a.group);
      const gb = groupRank(b.group);
      if (ga !== gb) return ga - gb;
      return (a.lang + '|' + a.storefront).localeCompare(b.lang + '|' + b.storefront);
    });

  const productIds = [...new Set([...groups.keys()].map((k) => k.split('|')[0]))].sort();
  const rows: MatrixRow[] = productIds.map((productId) => {
    const meta = metaByProduct.get(productId);
    const cells: MatrixCell[] = columns.map((col) => {
      const insts = groups.get(`${productId}|${col.lang}|${col.storefront}`) ?? [];
      if (insts.length === 0) return { total: 0, buckets: [] };
      const buckets = chunkInstances(insts).map((chunk) => {
        const { tone, keywords } = bucketTone(chunk, latestByKey, now, windowMs);
        return { tone, keywords };
      });
      return { total: insts.length, buckets };
    });
    return {
      productId,
      projectName: meta?.projectName ?? null,
      platform: meta?.platform ?? null,
      productName: meta?.productName ?? null,
      cells,
    };
  });

  return { columns, rows, generatedAt: new Date(now).toISOString() };
}
