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

export type OverviewIssueSeverity = "high" | "medium" | "low";
export type OverviewIssueCategory = "data-quality" | "ranking" | "release" | "feedback";

export interface OverviewDetectedIssue {
  id: string;
  category: OverviewIssueCategory;
  severity: OverviewIssueSeverity;
  title: string;
  evidence: string;
  action: "keywords" | "release" | "trend";
  target: string | null;
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

export function detectOverviewIssues(input: {
  keywordStats: { tracked: number; ranked: number; top10: number; paused: number };
  rankMovers: RankMover[];
  release: OverviewBriefInput["release"];
  feedbackThemes: { title: string; evidenceCount: number; topQuotes: string[] }[];
}): OverviewDetectedIssue[] {
  const issues: OverviewDetectedIssue[] = [];
  const { tracked, ranked } = input.keywordStats;

  if (tracked === 0) {
    issues.push({
      id: "keyword-coverage-empty",
      category: "data-quality",
      severity: "high",
      title: "尚未建立有效关键词观察面",
      evidence: "当前没有处于跟踪状态的关键词，无法判断搜索排名变化。",
      action: "keywords",
      target: null,
    });
  } else if (ranked === 0) {
    issues.push({
      id: "rank-snapshots-empty",
      category: "data-quality",
      severity: "high",
      title: "关键词排名数据缺失",
      evidence: `${tracked} 个跟踪关键词中，没有关键词形成近 14 天有效排名快照。`,
      action: "keywords",
      target: null,
    });
  } else if (ranked / tracked < 0.6) {
    issues.push({
      id: "rank-snapshots-partial",
      category: "data-quality",
      severity: "medium",
      title: "关键词排名覆盖不足",
      evidence: `${tracked} 个跟踪关键词中仅 ${ranked} 个形成近 14 天有效快照。`,
      action: "keywords",
      target: null,
    });
  }

  for (const mover of input.rankMovers.filter((item) => item.delta != null && item.delta <= -5).slice(0, 2)) {
    const drop = Math.abs(mover.delta || 0);
    issues.push({
      id: `rank-drop:${mover.language}:${mover.storefront}:${mover.keyword}`,
      category: "ranking",
      severity: drop >= 10 ? "high" : "medium",
      title: `关键词「${mover.keyword}」显著掉榜`,
      evidence: `${mover.storefront} 商店从第 ${mover.previousRank} 名降至第 ${mover.currentRank} 名，下降 ${drop} 位。`,
      action: "trend",
      target: mover.keyword,
    });
  }

  if (
    input.release &&
    input.release.languageTotal > 0 &&
    input.release.languageProgress < input.release.languageTotal
  ) {
    issues.push({
      id: `release-localization:${input.release.tag}`,
      category: "release",
      severity: input.release.languageProgress === 0 ? "high" : "medium",
      title: `发布 ${input.release.tag} 的本地化尚未完成`,
      evidence: `已生成 ${input.release.languageProgress}/${input.release.languageTotal} 个目标语言的文案。`,
      action: "release",
      target: input.release.tag,
    });
  }

  const feedbackTheme = [...input.feedbackThemes]
    .filter((theme) => theme.evidenceCount >= 2)
    .sort((a, b) => b.evidenceCount - a.evidenceCount)[0];
  if (feedbackTheme) {
    issues.push({
      id: `feedback-theme:${feedbackTheme.title}`,
      category: "feedback",
      severity: feedbackTheme.evidenceCount >= 5 ? "high" : "medium",
      title: `用户反馈集中在「${feedbackTheme.title}」`,
      evidence: `该主题包含 ${feedbackTheme.evidenceCount} 条反馈证据。`,
      action: "trend",
      target: feedbackTheme.title,
    });
  }

  const severityScore: Record<OverviewIssueSeverity, number> = { high: 3, medium: 2, low: 1 };
  return issues
    .sort((a, b) => severityScore[b.severity] - severityScore[a.severity])
    .slice(0, 5);
}

export interface OverviewBriefInput {
  name: string;
  description: string;
  platform: string;
  supportedLanguages: string[];
  keywordStats: { tracked: number; ranked: number; top10: number; paused: number };
  rankMovers: RankMover[];
  detectedIssues: OverviewDetectedIssue[];
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
  /** 用户反馈主题（来自 feedback-inbox 聚类），供周报引用。 */
  feedbackThemes?: { title: string; evidenceCount: number; topQuotes: string[] }[];
  /** 竞品近 7 天动态摘要。 */
  competitorDeltas?: { name: string; change: string }[];
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
  feedbackThemes?: { title: string; evidenceCount: number; topQuotes: string[] }[];
  competitorDeltas?: { name: string; change: string }[];
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

  const keywordStats = {
    tracked: active.length,
    ranked,
    top10,
    paused: args.trackedKeywords.length - active.length,
  };
  const rankMovers = computeRankMovers(
    args.rankSnapshots.filter((snapshot) =>
      activeKeys.has(`${snapshot.keyword}\u0000${snapshot.language}`),
    ),
    days,
  );
  const release = args.releaseDraft
    ? {
        tag: args.releaseDraft.tag,
        languageProgress: generatedLanguageCount,
        languageTotal: args.supportedLanguages.length || localizations.length,
        masterConfirmed: Boolean(args.submissionDraft?.masterConfirmedAt),
        batchConfirmed: Boolean(args.submissionDraft?.batchConfirmedAt),
        storeStatus: args.submissionDraft?.storeStatus ?? null,
      }
    : null;
  const feedbackThemes = args.feedbackThemes || [];

  return {
    name: args.productName || args.projectName,
    description: args.description || "",
    platform: args.platform,
    supportedLanguages: args.supportedLanguages,
    keywordStats,
    rankMovers,
    detectedIssues: detectOverviewIssues({ keywordStats, rankMovers, release, feedbackThemes }),
    release,
    submissionKeywordCount,
    uiLanguage: "zh-Hans",
    feedbackThemes,
    competitorDeltas: args.competitorDeltas || [],
    profile: args.profile,
  };
}
