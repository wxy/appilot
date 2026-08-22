/**
 * Overview summary pure functions: rank-change detection and AI brief input.
 */

import type { ProjectProfile } from "./project-profile";

export interface RankSnapshotLike {
  keyword: string;
  language: string;
  storefront: string;
  rank: number | null;
  checkedAt: string;
}

export interface RankMover {
  keyword: string;
  language: string;
  storefront: string;
  previousRank: number | null;
  currentRank: number;
  delta: number | null; // positive = improved
}

export function computeRankMovers(snapshots: RankSnapshotLike[], days = 14): RankMover[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const byKey = new Map<string, RankSnapshotLike[]>();
  for (const snapshot of snapshots) {
    if (new Date(snapshot.checkedAt).getTime() < cutoff) continue;
    const key = `${snapshot.keyword}\u0000${snapshot.language}\u0000${snapshot.storefront}`;
    const list = byKey.get(key) || [];
    list.push(snapshot);
    byKey.set(key, list);
  }
  const movers: RankMover[] = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => new Date(a.checkedAt).getTime() - new Date(b.checkedAt).getTime());
    const current = list[list.length - 1];
    if (current.rank == null) continue;
    let previous: RankSnapshotLike | null = null;
    for (let i = list.length - 2; i >= 0; i--) {
      if (list[i].rank != null) { previous = list[i]; break; }
    }
    movers.push({
      keyword: current.keyword,
      language: current.language,
      storefront: current.storefront,
      previousRank: previous?.rank ?? null,
      currentRank: current.rank,
      delta: previous?.rank != null ? previous.rank - current.rank : null,
    });
  }
  movers.sort((a, b) => {
    const aScore = a.delta != null ? Math.abs(a.delta) : 999;
    const bScore = b.delta != null ? Math.abs(b.delta) : 999;
    return bScore - aScore;
  });
  return movers.slice(0, 15);
}

export interface OverviewBriefInput {
  name: string;
  description: string;
  platform: string;
  supportedLanguages: string[];
  keywordStats: { tracked: number; ranked: number; top10: number; paused: number };
  rankMovers: RankMover[];
  release: {
    tag: string;
    languageProgress: number;
    languageTotal: number;
    masterConfirmed: boolean;
    batchConfirmed: boolean;
    storeStatus: string | null;
  } | null;
  submissionKeywordCount: number;
  uiLanguage: string;
  /** Shared stable archive; the brief uses it as the cache-friendly prefix. */
  profile?: ProjectProfile;
}

export function buildBriefInput(args: {
  projectName: string;
  productName: string;
  description: string;
  platform: string;
  supportedLanguages: string[];
  trackedKeywords: { keyword?: string; language?: string; status?: string }[];
  rankSnapshots: RankSnapshotLike[];
  days?: number;
  releaseDraft: { name?: string | null; tag: string } | null;
  submissionDraft: {
    localizations?: {
      language?: string; name?: string; subtitle?: string; promotionalText?: string;
      description?: string; whatsNew?: string; keywords?: string;
    }[];
    masterConfirmedAt?: string;
    batchConfirmedAt?: string;
    storeStatus?: string;
  } | null;
  submissionKeywords: { language?: string; text?: string }[];
  profile?: ProjectProfile;
}): OverviewBriefInput {
  const days = args.days ?? 14;
  const active = args.trackedKeywords.filter((k) => k.status !== "paused");
  const activeKeys = new Set(
    active.map((k) => `${k.keyword ?? ""}\u0000${k.language ?? ""}`),
  );
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const bestByKeyword = new Map<string, number>();
  for (const snapshot of args.rankSnapshots) {
    if (snapshot.rank == null || new Date(snapshot.checkedAt).getTime() < cutoff) continue;
    const key = `${snapshot.keyword}\u0000${snapshot.language}`;
    if (!activeKeys.has(key)) continue;
    const prev = bestByKeyword.get(key);
    if (prev === undefined || snapshot.rank < prev) bestByKeyword.set(key, snapshot.rank);
  }
  const ranked = bestByKeyword.size;
  const top10 = [...bestByKeyword.values()].filter((rank) => rank <= 10).length;

  const localizations = args.submissionDraft?.localizations || [];
  const generatedLanguageCount = localizations.filter((loc) =>
    [loc.name, loc.subtitle, loc.promotionalText, loc.description, loc.whatsNew, loc.keywords]
      .some((value) => value && String(value).trim()),
  ).length;
  const submissionKeywordCount = args.submissionKeywords
    .flatMap((item) => String(item.text || "").split(","))
    .map((item) => item.trim())
    .filter(Boolean).length;

  return {
    name: args.productName || args.projectName,
    description: args.description || "",
    platform: args.platform,
    supportedLanguages: args.supportedLanguages,
    keywordStats: {
      tracked: active.length,
      ranked,
      top10,
      paused: args.trackedKeywords.length - active.length,
    },
    rankMovers: computeRankMovers(args.rankSnapshots, days),
    release: args.releaseDraft
      ? {
          tag: args.releaseDraft.tag,
          languageProgress: generatedLanguageCount,
          languageTotal: args.supportedLanguages.length || localizations.length,
          masterConfirmed: Boolean(args.submissionDraft?.masterConfirmedAt),
          batchConfirmed: Boolean(args.submissionDraft?.batchConfirmedAt),
          storeStatus: args.submissionDraft?.storeStatus ?? null,
        }
      : null,
    submissionKeywordCount,
    uiLanguage: "zh-Hans",
    profile: args.profile,
  };
}
