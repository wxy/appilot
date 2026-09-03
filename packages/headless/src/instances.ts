/**
 * 实例任务推导器（v4）：把「期望任务集」差异同步到共享 DB tasks。
 *
 * 谁持有什么数据，就推导什么实例；但任务**类型与执行**全部来自核心
 * （executors.ts / core 纯函数），两壳共享同一 DB：
 * - DSH / Electron 项目级：github-sync:<name>（每注册项目一行）；
 * - Electron 富数据实例（rank 等）后续随 4c 接入同一机制。
 *
 * reconcileTaskInstances 语义：
 * - seed：expected 中 DB 缺的行 → 插入（nextRunAt=now，立即可被主 tick 执行）；
 * - prune：删除 DB 中「source 匹配且 kind 在本次管理集但 id 不在 expected」的行
 *   （项目移除/改名后不留幽灵实例）。不碰其他来源/其他 kind 的行。
 */
import type { AppilotStore } from './store.js';
import type { TaskRow, ProductRecordRow } from './schema.js';
import {
  GITHUB_SYNC_KIND,
  GITHUB_SYNC_INTERVAL_MINUTES,
  RANK_KIND,
  type GithubSyncInstanceArgs,
} from './executors.js';
import { storefrontsForLanguage } from '@appilot-labs/appilot-core/storefronts';

export interface TaskInstanceSpec {
  id: string;
  kind: string;
  title: string;
  intervalMinutes: number;
  instance: Record<string, unknown>;
}

export interface ReconcileResult {
  seeded: number;
  pruned: number;
}

/** 关键词池条目形状（Electron trackedKeywords 对象 JSON 保留，含状态）。 */
export interface KeywordPoolEntry {
  keyword?: unknown;
  language?: unknown;
  status?: unknown;
  pausedPlatforms?: string[];
}

/** rank 推导选项。 */
export interface RankInstancesOptions {
  /** 每次采集间隔（分钟；Electron 按 rankRunsPerDay 折算，缺省 720=每天 2 次）。 */
  intervalMinutes?: number;
  /** 暂停判定用平台（product.platform）；pausedPlatforms 含此平台的关键词跳过。 */
  platformForPause?: string;
}

/**
 * 由产品注册数据（product_records）推导期望 rank 实例集（P2：rank 脱离
 * electron-store 上下文，daemon/壳可用同一推导）。语言展开与 storefront 逻辑
 * 与 Electron reconcile 一致：en 产品只查 en；多语言产品查 [code, en]。
 * 调用方负责暂停判定（core rank-keywords）后传入已过滤的关键词池。
 */
export function rankInstancesFor(
  projectName: string,
  product: ProductRecordRow,
  pool: KeywordPoolEntry[],
  opts: RankInstancesOptions = {},
): TaskInstanceSpec[] {
  const intervalMinutes = opts.intervalMinutes ?? 720;
  const platform = product.platform ?? opts.platformForPause ?? null;
  if (!product.trackId) return [];
  const specs: TaskInstanceSpec[] = [];
  for (const code of product.supportedLanguages) {
    const queryLanguages = code === 'en' ? ['en'] : [code, 'en'];
    for (const kw of pool ?? []) {
      const keyword = String(kw.keyword ?? '');
      const lang = String(kw.language ?? '');
      if (!keyword || !lang) continue;
      if (kw.status === 'paused') continue;
      if (!queryLanguages.includes(lang)) continue;
      if (platform && Array.isArray(kw.pausedPlatforms) && kw.pausedPlatforms.includes(platform)) {
        continue;
      }
      for (const storefront of storefrontsForLanguage(code)) {
        const id = `${product.productId}:${lang}:${storefront}:${keyword}`;
        specs.push({
          id,
          kind: RANK_KIND,
          title: `排名采集: ${keyword} @ ${storefront} (${lang})`,
          intervalMinutes,
          instance: {
            projectName,
            productId: product.productId,
            keyword,
            queryLanguage: lang,
            storefront,
            platform,
            groupKey: platform
              ? `rank:${product.productId}:${platform}:${lang}:${storefront}`
              : `rank:${product.productId}:${lang}:${storefront}`,
          },
        });
      }
    }
  }
  return specs;
}

/** 项目级 github-sync 实例规格（每注册项目一行）。 */
export function githubSyncInstancesFor(
  projects: Array<{ name: string; path: string }>,
): TaskInstanceSpec[] {
  return (projects ?? []).map((p) => {
    const args: GithubSyncInstanceArgs = { projectName: p.name, path: p.path };
    return {
      id: `${GITHUB_SYNC_KIND}:${p.name}`,
      kind: GITHUB_SYNC_KIND,
      title: 'GitHub 发布同步',
      intervalMinutes: GITHUB_SYNC_INTERVAL_MINUTES,
      instance: args as unknown as Record<string, unknown>,
    };
  });
}

/**
 * 差异同步期望实例集到共享 DB。
 * @param source 实例来源（'dsh' | 'electron' | 'cli'）——prune 只清理该来源行。
 */
export function reconcileTaskInstances(
  store: AppilotStore,
  expected: TaskInstanceSpec[],
  source: string,
): ReconcileResult {
  const now = new Date().toISOString();
  const expectedIds = new Set(expected.map((e) => e.id));
  const managedKinds = new Set(expected.map((e) => e.kind));
  let seeded = 0;

  for (const spec of expected) {
    const existing = store.tasks.get(spec.id);
    if (existing) {
      // 存在则按需刷新参数/标题/身份（不改 nextRunAt/状态）。用 setIdentity
      // 覆盖已存在行的 kind/instance——镜像先建的行（kind=null）需升级为实例行。
      if (
        existing.kind !== spec.kind ||
        existing.title !== spec.title ||
        existing.intervalMinutes !== spec.intervalMinutes ||
        JSON.stringify(existing.instance ?? null) !== JSON.stringify(spec.instance)
      ) {
        store.tasks.upsert(
          {
            ...existing,
            title: spec.title,
            intervalMinutes: spec.intervalMinutes,
            kind: spec.kind,
            instance: spec.instance,
            source: existing.source ?? source,
          },
          { setIdentity: true },
        );
      }
      continue;
    }
    store.tasks.upsert({
      id: spec.id,
      title: spec.title,
      intervalMinutes: spec.intervalMinutes,
      lastRunAt: null,
      nextRunAt: now, // 立即可跑（主 tick 或 runNow）
      lastStatus: 'never',
      lastSummary: null,
      runCount: 0,
      source,
      kind: spec.kind,
      instance: spec.instance,
    });
    seeded += 1;
  }

  // prune：同来源 + 本次管理 kind + 不在期望集 → 移除
  let pruned = 0;
  const existing: TaskRow[] = store.tasks.all();
  for (const row of existing) {
    if (row.source !== source) continue;
    if (!row.kind || !managedKinds.has(row.kind)) continue;
    if (!expectedIds.has(row.id)) {
      if (store.tasks.remove(row.id)) pruned += 1;
    }
  }
  return { seeded, pruned };
}
