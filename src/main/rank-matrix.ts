/**
 * 排名采集覆盖热力图数据层（原型确认后落 React 版）。
 *
 * 全局监督视图：产品 × 商店矩阵，每格点阵 = 关键字每 5 词一桶，
 * 桶色 = 该桶在窗口内的采集覆盖状态。回答「哪些市场覆盖齐全、哪里掉队」。
 *
 * 语义（与原型一致）：
 * - 窗口：成功快照 checkedAt 距今 ≤ 12h（严格周期对齐）算"采到"；
 * - 桶状态：任一 error → 红；全采到 → 绿；部分 → 黄；0 且全部未到期 → 灰
 *   （等待中，正常）；0 且有已到期未采 → 橙（掉队）。
 * - 语言隐含于商店（storefront 集合由产品语言决定），格 = product × storefront
 *   下全部 keyword×language 实例。
 *
 * 纯 node（不 import electron），可单测。
 */
import type { AppilotStore, TaskRow } from '@appilot-labs/appilot-headless';

/** 每桶关键词数（产品参数，与原型一致）。 */
export const COVERAGE_BUCKET_KEYWORDS = 5;
/** 覆盖窗口：成功快照不超过此时长即视为本轮已采到（严格 12h）。 */
export const COVERAGE_WINDOW_MS = 12 * 60 * 60 * 1000;

export type BucketTone = 'cov' | 'part' | 'err' | 'pend' | 'stale';

export interface MatrixBucket {
  tone: BucketTone;
  /** 桶内元素（keyword@lang），用于 hover 明细。 */
  keywords: Array<{ keyword: string; lang: string }>;
}

export interface MatrixCell {
  storefront: string;
  /** 该格关键字实例数。 */
  total: number;
  buckets: MatrixBucket[];
}

export interface MatrixRow {
  /** productId（含平台段，如 msszspx4-r12ipi:ios）。 */
  productId: string;
  /** product_records trackName（无则 null）。 */
  productName: string | null;
  cells: MatrixCell[];
}

export interface RankCoverageMatrix {
  storefronts: string[];
  rows: MatrixRow[];
  /** 聚合时刻（ISO）。 */
  generatedAt: string;
}

/** 单桶基调（最差优先：error > stale > 覆盖比例）。 */
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
  const tone: BucketTone =
    err > 0 ? 'err' : cov === insts.length && insts.length > 0 ? 'cov' : cov > 0 ? 'part' : stale > 0 ? 'stale' : 'pend';
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
  const groups = new Map<string, TaskRow[]>();
  for (const t of rankInsts) {
    const inst = (t.instance ?? {}) as any;
    if (!inst.productId || !inst.storefront) continue;
    const k = `${inst.productId}|${inst.storefront}`;
    (groups.get(k) ?? groups.set(k, [] as TaskRow[]).get(k)!)!.push(t);
  }
  const productNameOf = new Map<string, string | null>();
  for (const p of store.projects.list()) {
    for (const pr of store.products.listByProject(p.name)) {
      productNameOf.set(pr.productId, pr.trackName ?? null);
    }
  }
  const storefronts = [...new Set([...groups.keys()].map((k) => k.split('|')[1]))].sort();
  const productIds = [...new Set([...groups.keys()].map((k) => k.split('|')[0]))].sort();

  const rows: MatrixRow[] = productIds.map((productId) => ({
    productId,
    productName: productNameOf.get(productId) ?? null,
    cells: storefronts.map((storefront) => {
      const insts = groups.get(`${productId}|${storefront}`) ?? [];
      const buckets = chunkInstances(insts).map((chunk) => {
        const { tone, keywords } = bucketTone(chunk, latestByKey, now, windowMs);
        return { tone, keywords };
      });
      return { storefront, total: insts.length, buckets };
    }),
  }));

  return { storefronts, rows, generatedAt: new Date(now).toISOString() };
}
