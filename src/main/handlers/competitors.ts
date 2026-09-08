import { ipcMain } from "electron";
import {
  createCompetitor,
  findCompetitorByName,
  migrateCompetitor,
  searchCompetitorCandidatesAcross,
} from "@appilot-labs/appilot-core/competitor-radar";
import {
  isItunesSearchForbidden,
  itunesSearchBlockFriendlyMessage,
  itunesSearchBlockUntilIsoForNow,
} from "@appilot-labs/appilot-core/rank-collector";
import {
  armItunesSearchBlock,
  itunesSearchBlockState,
  refreshProductRankKeywords,
  runOpsSyncNow,
} from "../scheduler";
import { sharedStore } from "../registry-sync";
import { blobGet } from "../db-blob-read";
import { getStore } from "../store";
import { assertNonEmptyString } from "../util";
import { notifyDataChanged } from "../data-sync";

function competitorsFor(store: any, projectId: string): any[] {
  return (store.get("competitors") || {})[projectId] || [];
}

function saveCompetitors(store: any, projectId: string, list: any[]): void {
  const all = store.get("competitors") || {};
  all[projectId] = list;
  store.set("competitors", all);
}

// 新增/合并一条竞品记录的纯列表逻辑（competitors:save 共用）：
// 同名竞品（同一品牌另一平台的列表）自动合并、trackIds 按平台字段并入；返回新列表与
// 是否发生同名合并（savedId 用于排名回填）。
function mergeCompetitorInto(list: any[], competitor: any): { next: any[]; merged: boolean; savedId: string | null } {
  const platform: "ios" | "macos" | "unknown" =
    competitor.platform === "macos"
      ? "macos"
      : competitor.platform === "ios"
        ? "ios"
        : "unknown";
  // 同时接受新模型 trackIds 和旧模型 trackId+platform，统一写入按平台字段。
  const trackIds = {
    ...(competitor.trackIds || {}),
    ...(platform !== "unknown" && competitor.trackId
      ? { [platform]: String(competitor.trackId) }
      : {}),
  };
  let merged = false;
  let savedId: string | null = null;
  let next: any[];
  if (competitor.id) {
    // 更新既有竞品。
    const index = list.findIndex((item: any) => item.id === competitor.id);
    const previous = index >= 0 ? list[index] : competitor;
    const normalized = {
      ...previous,
      ...competitor,
      trackId: previous.trackId ?? competitor.trackId ?? null,
      platform: previous.platform ?? platform,
      trackIds: { ...(previous.trackIds || {}), ...trackIds },
    };
    next = index >= 0
      ? [...list.slice(0, index), normalized, ...list.slice(index + 1)]
      : [...list, normalized];
    savedId = normalized.id;
  } else {
    // 新增：同名竞品（同一品牌另一平台的列表）自动合并，不新建重复条目。
    const sameName = findCompetitorByName(list, competitor.name);
    if (sameName) {
      const index = list.findIndex((item: any) => item.id === sameName.id);
      const normalized = {
        ...sameName,
        trackIds: { ...(sameName.trackIds || {}), ...trackIds },
        linkedKeywords: Array.isArray(competitor.linkedKeywords)
          ? [...new Map(
              [...(sameName.linkedKeywords || []), ...competitor.linkedKeywords].map(
                (link: any) => [`${link.keyword}\u0000${link.language}`, link],
              ),
            ).values()]
          : sameName.linkedKeywords,
      };
      next = [...list.slice(0, index), normalized, ...list.slice(index + 1)];
      merged = true;
      savedId = sameName.id;
    } else {
      const normalized = createCompetitor({
        name: String(competitor.name).trim(),
        trackId: (Object.values(trackIds)[0] as string | undefined) ?? null,
        platform,
        trackIds,
        githubUrl: competitor.githubUrl || null,
        notes: competitor.notes || "",
        linkedKeywords: Array.isArray(competitor.linkedKeywords)
          ? competitor.linkedKeywords
          : undefined,
      });
      next = [...list, normalized];
      savedId = normalized.id;
    }
  }
  return { next, merged, savedId };
}

export function registerCompetitorsHandlers(): void {
  ipcMain.handle("competitors:list", async (_event, projectId: string) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    const s = await getStore();
    return competitorsFor(s, projectId).map(migrateCompetitor);
  });

  ipcMain.handle("competitors:save", async (_event, projectId: string, competitor: any) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    if (!competitor?.name) throw new Error("竞品名称不能为空");
    const s = await getStore();
    const list = competitorsFor(s, projectId);
    const { next, merged, savedId } = mergeCompetitorInto(list, competitor);
    saveCompetitors(s, projectId, next);
    // 用搜索结果里已带出的各商店排名立即回填，不用等下一次调度抓取。
    const seedRanks = Array.isArray(competitor.seedRanks)
      ? competitor.seedRanks
      : [];
    if (savedId && seedRanks.length > 0) {
      const ranksAll: Record<string, Record<string, any[]>> =
        s.get("competitorRankSnapshots") || {};
      const rankById: Record<string, any[]> = ranksAll[projectId] || {};
      let nextRanks = [...(rankById[savedId] || [])];
      for (const seed of seedRanks) {
        if (!seed.keyword || !seed.storefront) continue;
        const seedPlatform: "ios" | "macos" =
          seed.platform === "macos" ? "macos" : "ios";
        // 替换同 (关键词, 商店, 平台) 旧条目，并清理无平台旧数据。
        nextRanks = nextRanks.filter(
          (item: any) =>
            !(
              item.keyword === seed.keyword &&
              item.storefront === seed.storefront &&
              (item.platform == null || item.platform === seedPlatform)
            ),
        );
        nextRanks.push({
          keyword: seed.keyword,
          language: seed.language || "en",
          storefront: seed.storefront,
          platform: seedPlatform,
          rank: typeof seed.rank === "number" ? seed.rank : null,
          checkedAt: new Date().toISOString(),
        });
      }
      rankById[savedId] = nextRanks.slice(-300);
      ranksAll[projectId] = rankById;
      s.set("competitorRankSnapshots", ranksAll);
    }
    notifyDataChanged("competitors");
    return { list: next, merged };
  });

  ipcMain.handle("competitors:remove", async (_event, projectId: string, competitorId: string) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    competitorId = assertNonEmptyString(competitorId, "competitorId");
    const s = await getStore();
    saveCompetitors(
      s,
      projectId,
      competitorsFor(s, projectId).filter((item: any) => item.id !== competitorId),
    );
    notifyDataChanged("competitors");
    return true;
  });

  ipcMain.handle("competitors:search", async (_event, opts: {
    term?: string;
    country?: string;
    countries?: string[];
    platform?: string;
    excludeTrackIds?: string[];
    excludeBundleIds?: string[];
  }) => {
    const term = assertNonEmptyString(opts?.term, "term");
    const countries =
      Array.isArray(opts?.countries) && opts.countries.length > 0
        ? opts.countries.filter((c: string) => c)
        : [assertNonEmptyString(opts?.country, "country")];
    // iTunes Search 403 熔断门控：冷却期内不再发起候选搜索（与调度 tick 读同一
    // app_kv 键 itunesSearchBlockedUntil；getStore().get 与 headless store.kv 均指
    // 同一 app_kv 表——主进程或 daemon 任一侧触发都在这拦下）。非该 API 的不受影响。
    const s = await getStore();
    const block = itunesSearchBlockState(s);
    if (block.blocked && block.until) {
      throw new Error(itunesSearchBlockFriendlyMessage(block.until));
    }
    try {
      return await searchCompetitorCandidatesAcross({
        term,
        countries,
        entity: opts?.platform === "macos" ? "macSoftware" : "software",
        excludeTrackIds: Array.isArray(opts?.excludeTrackIds) ? opts.excludeTrackIds : undefined,
        excludeBundleIds: Array.isArray(opts?.excludeBundleIds) ? opts.excludeBundleIds : undefined,
      });
    } catch (err: any) {
      // 竞品搜索本身命中 403（core 多商店合并已把 Forbidden 冒泡到这里）→ 触发
      // 熔断写键（复用 scheduler 导出；依赖方向 handlers → scheduler，无循环）。
      if (isItunesSearchForbidden(err)) {
        armItunesSearchBlock(s, `competitors:search "${term}"`);
        const after = itunesSearchBlockState(s);
        throw new Error(itunesSearchBlockFriendlyMessage(after.until ?? itunesSearchBlockUntilIsoForNow()));
      }
      throw err;
    }
  });

  ipcMain.handle("competitors:snapshots", async (_event, projectId: string, competitorId: string) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    competitorId = assertNonEmptyString(competitorId, "competitorId");
    const s = await getStore();
    const kvInner = (s.get("competitorSnapshots") || {})[projectId];
    const dbInner = blobGet(sharedStore(), "competitorSnapshots", projectId) as Record<string, unknown> | undefined;
    return (dbInner?.[competitorId] ?? kvInner?.[competitorId]) || [];
  });

  ipcMain.handle("competitors:rankSnapshots", async (_event, projectId: string, competitorId: string) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    competitorId = assertNonEmptyString(competitorId, "competitorId");
    const s = await getStore();
    const kvInnerR = (s.get("competitorRankSnapshots") || {})[projectId];
    const dbInnerR = blobGet(sharedStore(), "competitorRankSnapshots", projectId) as Record<string, unknown> | undefined;
    return (dbInnerR?.[competitorId] ?? kvInnerR?.[competitorId]) || [];
  });

  // 竞品总览（P1 数据层）：按产品(平台)聚合每个竞品的竞争面与竞争指数。
  // 多平台分开统计：platform 由产品决定，只聚合该平台的快照（决策 3）。
  ipcMain.handle("competitors:overview", async (_event, projectId: string, productId: string) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    productId = assertNonEmptyString(productId, "productId");
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const project = projects.find((p: any) =>
      (p.storeProducts || []).some((sp: any) => sp?.id === productId),
    );
    if (!project) return [];
    const product = (project.storeProducts || []).find((sp: any) => sp?.id === productId);
    const platform: "ios" | "macos" = product?.platform === "macos" ? "macos" : "ios";
    // 我方快照以 DB rank_snapshots 为源（kv projects 已退役）；缺数据时回退产品副本。
    const ownSnapshots: any[] = (() => {
      try {
        const dbRows = sharedStore().snapshots.history(project.name, { productId });
        if (Array.isArray(dbRows) && dbRows.length > 0) return dbRows;
      } catch {
        // 回退
      }
      return Array.isArray(product?.rankSnapshots) ? product.rankSnapshots : [];
    })();
    const list = competitorsFor(s, projectId).map(migrateCompetitor);
    const kvInnerR = (s.get("competitorRankSnapshots") || {})[projectId] || {};
    const dbInnerR = blobGet(sharedStore(), "competitorRankSnapshots", projectId) as Record<string, unknown> | undefined;
    const { buildCompetitorIntel, competitorIndexHistory, competitorFaceEvents } = await import("../competitor-intel");
    const profiles = list.map((competitor: any) => {
      const ranks: any[] = dbInnerR?.[competitor.id] ?? kvInnerR?.[competitor.id] ?? [];
      const linked = Array.isArray(competitor.linkedKeywords)
        ? competitor.linkedKeywords
        : undefined;
      const intel = buildCompetitorIntel({
        platform,
        rankEntries: ranks,
        ownSnapshots,
        linkedKeywords: linked,
      });
      const indexHistory = competitorIndexHistory({
        platform,
        rankEntries: ranks,
        ownSnapshots,
        linkedKeywords: linked,
      });
      const events = competitorFaceEvents({ platform, rankEntries: ranks });
      return { competitor, intel, indexHistory, events };
    });
    profiles.sort((a, b) => b.intel.index - a.intel.index || b.intel.pressuredCount - a.intel.pressuredCount);
    return profiles;
  });

  ipcMain.handle("competitors:sync", async (_event, projectId: string) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    return runOpsSyncNow(projectId);
  });

  // 手动「重抓我方关键词」：把该产品在 scheduledTasks 里的全部 rank 任务各重跑一次。
  // 竞品采集已是「抓我方关键词命中即记录」（见 scheduler runRankTask）——重跑中结果里
  // 出现的已跟踪竞品会被顺手记下名次，无需任何按 (竞品 × 关联词) 驱动的额外采集。
  // 抓词过程本身会刷新数据，这里再统一通知一次保证 UI 即时更新。
  ipcMain.handle("competitors:refreshKeywords", async (_event, projectId: string, productId: string) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    productId = assertNonEmptyString(productId, "productId");
    const result = await refreshProductRankKeywords(projectId, productId);
    notifyDataChanged("competitors");
    return result;
  });
}
