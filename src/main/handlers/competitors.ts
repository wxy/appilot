import { ipcMain } from "electron";
import {
  createCompetitor,
  searchCompetitorCandidatesAcross,
} from "../../engine/competitor-radar";
import { runOpsSyncNow } from "../scheduler";
import { getStore } from "../store";
import { assertNonEmptyString } from "../util";

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
    return competitorsFor(s, projectId);
  });

  ipcMain.handle("competitors:save", async (_event, projectId: string, competitor: any) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    if (!competitor?.name) throw new Error("竞品名称不能为空");
    const s = await getStore();
    const list = competitorsFor(s, projectId);
    const normalized = competitor.id
      ? competitor
      : createCompetitor({
          name: String(competitor.name).trim(),
          trackId: competitor.trackId ? String(competitor.trackId) : null,
          platform: competitor.platform || "unknown",
          githubUrl: competitor.githubUrl || null,
          notes: competitor.notes || "",
          linkedKeywords: Array.isArray(competitor.linkedKeywords)
            ? competitor.linkedKeywords
            : undefined,
        });
    const index = list.findIndex((item: any) => item.id === normalized.id);
    const next = index >= 0
      ? [...list.slice(0, index), normalized, ...list.slice(index + 1)]
      : [...list, normalized];
    saveCompetitors(s, projectId, next);
    return next;
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

  ipcMain.handle("competitors:sync", async (_event, projectId: string) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    return runOpsSyncNow(projectId);
  });
}
