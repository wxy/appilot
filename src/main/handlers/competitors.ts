import { ipcMain } from "electron";
import {
  createCompetitor,
  findCompetitorByName,
  migrateCompetitor,
  searchCompetitorCandidatesAcross,
} from "@appilot-labs/appilot-core/competitor-radar";
import { runOpsSyncNow } from "../scheduler";
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
    const { buildCompetitorIntel, competitorIndexHistory } = await import("../competitor-intel");
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
      return { competitor, intel, indexHistory };
    });
    profiles.sort((a, b) => b.intel.index - a.intel.index || b.intel.pressuredCount - a.intel.pressuredCount);
    return profiles;
  });

  // 立即为所有竞品的关联关键词补采排名（无需等待下次定时关键词抓取）。
  ipcMain.handle("competitors:refreshRanks", async (_event, projectId: string) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    const s = await getStore();
    const list = competitorsFor(s, projectId);
    const { collectCompetitorRankSnapshots } = await import("@appilot-labs/appilot-core/competitor-radar");
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

  // 自动发现（P3）：只扫我方「在榜词」（决策 2）——每个词取我方名次最好的
  // 商店做一次前 N 名搜索；命中已跟踪竞品 → 回填该词排名（进入竞争面聚合），
  // 未跟踪 App 记入候选。每日限流一次，可 force 重扫。
  ipcMain.handle("competitors:scanOnChart", async (_event, projectId: string, productId: string, opts?: { force?: boolean }) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    productId = assertNonEmptyString(productId, "productId");
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const project = projects.find((p: any) =>
      (p.storeProducts || []).some((sp: any) => sp?.id === productId),
    );
    if (!project) return { ok: false, error: "Product not found" };
    const product = (project.storeProducts || []).find((sp: any) => sp?.id === productId);
    const platform: "ios" | "macos" = product?.platform === "macos" ? "macos" : "ios";
    const entity = platform === "macos" ? "macSoftware" : "software";

    // 每日限流（force 跳过）。
    const scanState: Record<string, { lastScanAt: string }> = s.get("competitorScanState") || {};
    const last = scanState[productId]?.lastScanAt;
    if (!opts?.force && last && Date.now() - new Date(last).getTime() < 24 * 3600_000) {
      return { ok: false, throttled: true, lastScanAt: last };
    }

    // 我方在榜词（窗口内 ≤200，含语言），每词取我方名次最好的商店作为扫描点。
    const ownSnapshots: any[] = (() => {
      try {
        const dbRows = sharedStore().snapshots.history(project.name, { productId });
        if (Array.isArray(dbRows) && dbRows.length > 0) return dbRows;
      } catch {
        // 回退
      }
      return Array.isArray(product?.rankSnapshots) ? product.rankSnapshots : [];
    })();
    const windowAgo = Date.now() - 7 * 86_400_000;
    const perKw = new Map<string, { language: string; keyword: string; storefront: string; rank: number }>();
    for (const snap of ownSnapshots) {
      if (!snap?.keyword || !snap?.storefront) continue;
      if (snap.checkedAt && new Date(snap.checkedAt).getTime() < windowAgo) continue;
      const rank = typeof snap.rank === "number" && snap.rank > 0 ? snap.rank : null;
      if (rank == null || rank > 200) continue; // 只扫在榜词
      const language = String(snap.language ?? "en");
      const key = `${language}\u0000${snap.keyword}`;
      const cur = perKw.get(key);
      if (!cur || rank < cur.rank) perKw.set(key, { language, keyword: snap.keyword, storefront: snap.storefront, rank });
    }
    const targets = [...perKw.values()].sort((a, b) => a.rank - b.rank).slice(0, 40);

    const list = competitorsFor(s, projectId).map(migrateCompetitor);
    const ranksAll: Record<string, Record<string, any[]>> = s.get("competitorRankSnapshots") || {};
    const rankById: Record<string, any[]> = ranksAll[projectId] || {};
    const selfTrackId = String(product?.trackId ?? "");
    const { searchCompetitorCandidatesAcross } = await import("@appilot-labs/appilot-core/competitor-radar");

    const foundByCompetitor: Record<string, number> = {};
    const newCandidates: Array<{ trackId: string; trackName: string; rank: number | null }> = [];
    const seenNew = new Set<string>();
    let checked = 0;
    for (const t of targets) {
      checked += 1;
      let results: any[] = [];
      try {
        results = await searchCompetitorCandidatesAcross({ term: t.keyword, countries: [t.storefront], entity });
      } catch {
        continue; // 单词失败不阻断
      }
      for (const c of results || []) {
        if (!c || c.trackId == null) continue;
        if (String(c.trackId) === selfTrackId) continue;
        const matched = list.find((comp: any) => {
          const ids = [
            comp?.trackId,
            ...Object.values(comp?.trackIds || {}),
          ].filter(Boolean).map(String);
          return ids.includes(String(c.trackId));
        });
        if (matched) {
          const rank = typeof c.ranks?.[t.storefront] === "number" ? c.ranks[t.storefront] : null;
          const prev = rankById[matched.id] || [];
          const nextRanks = prev.filter(
            (item: any) =>
              !(
                item.keyword === t.keyword &&
                item.storefront === t.storefront &&
                (item.platform == null || item.platform === platform)
              ),
          );
          nextRanks.push({
            keyword: t.keyword,
            language: t.language,
            storefront: t.storefront,
            platform,
            rank,
            checkedAt: new Date().toISOString(),
          });
          rankById[matched.id] = nextRanks.slice(-300);
          foundByCompetitor[matched.id] = (foundByCompetitor[matched.id] ?? 0) + 1;
        } else if (!seenNew.has(String(c.trackId))) {
          seenNew.add(String(c.trackId));
          newCandidates.push({
            trackId: String(c.trackId),
            trackName: c.trackName || "未知应用",
            rank: typeof c.ranks?.[t.storefront] === "number" ? c.ranks[t.storefront] : null,
          });
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 150)); // 温和节流
    }

    if (checked > 0) {
      ranksAll[projectId] = rankById;
      s.set("competitorRankSnapshots", ranksAll);
      const discoveriesAll: Record<string, any[]> = s.get("competitorDiscoveries") || {};
      const merged = new Map<string, any>((discoveriesAll[projectId] || []).map((d: any) => [String(d.trackId), d]));
      for (const n of newCandidates) merged.set(n.trackId, { ...n, discoveredAt: new Date().toISOString() });
      discoveriesAll[projectId] = [...merged.values()].slice(-100);
      s.set("competitorDiscoveries", discoveriesAll);
    }
    scanState[productId] = { lastScanAt: new Date().toISOString() };
    s.set("competitorScanState", scanState);
    notifyDataChanged("competitors");
    return {
      ok: true,
      checked,
      updatedCompetitors: Object.keys(foundByCompetitor).length,
      foundKeywords: Object.values(foundByCompetitor).reduce((a: number, b: number) => a + b, 0),
      newCandidates: newCandidates.length,
    };
  });
}
