import { ipcMain } from "electron";
import {
  createCompetitor,
  findCompetitorByName,
  migrateCompetitor,
  searchCompetitorCandidatesAcross,
} from "../../engine/competitor-radar";
import { runOpsSyncNow } from "../scheduler";
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
    return searchCompetitorCandidatesAcross({
      term,
      countries,
      entity: opts?.platform === "macos" ? "macSoftware" : "software",
      excludeTrackIds: Array.isArray(opts?.excludeTrackIds) ? opts.excludeTrackIds : undefined,
      excludeBundleIds: Array.isArray(opts?.excludeBundleIds) ? opts.excludeBundleIds : undefined,
    });
  });

  ipcMain.handle("competitors:snapshots", async (_event, projectId: string, competitorId: string) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    competitorId = assertNonEmptyString(competitorId, "competitorId");
    const s = await getStore();
    return (s.get("competitorSnapshots") || {})[projectId]?.[competitorId] || [];
  });

  ipcMain.handle("competitors:rankSnapshots", async (_event, projectId: string, competitorId: string) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    competitorId = assertNonEmptyString(competitorId, "competitorId");
    const s = await getStore();
    return (s.get("competitorRankSnapshots") || {})[projectId]?.[competitorId] || [];
  });

  // 立即为所有竞品的关联关键词补采排名（无需等待下次定时关键词抓取）。
  ipcMain.handle("competitors:refreshRanks", async (_event, projectId: string) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    const s = await getStore();
    const list = competitorsFor(s, projectId);
    const { collectCompetitorRankSnapshots } = await import("../../engine/competitor-radar");
    const ranksAll: Record<string, Record<string, any[]>> =
      s.get("competitorRankSnapshots") || {};
    const rankById: Record<string, any[]> = ranksAll[projectId] || {};
    for (const competitor of list) {
      const ranks = await collectCompetitorRankSnapshots(competitor);
      if (ranks.length === 0) continue;
      const prev = rankById[competitor.id] || [];
      const kept = prev.filter(
        (item: any) =>
          !ranks.some(
            (r: any) =>
              r.keyword === item.keyword &&
              r.storefront === item.storefront &&
              (item.platform == null || r.platform === item.platform),
          ),
      );
      rankById[competitor.id] = [...kept, ...ranks].slice(-300);
    }
    ranksAll[projectId] = rankById;
    s.set("competitorRankSnapshots", ranksAll);
    notifyDataChanged("competitors");
    return true;
  });

  ipcMain.handle("competitors:sync", async (_event, projectId: string) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    return runOpsSyncNow(projectId);
  });
}
