import type { RankSnapshotLike } from "../overview-summary";
import { storefrontsForLanguage } from "../storefronts";
import type { DiagnosticPackage, DiagnosticScope } from "./types";

export interface RankDiagnosticCoverage {
  source: "sqlite" | "project-fallback" | "live-query" | "none";
  snapshotCount: number;
  validSnapshotCount: number;
  invalidTimestampCount: number;
  futureTimestampCount: number;
  latestSeriesCount: number;
  freshSeriesCount: number;
  staleSeriesCount: number;
  latestRankedCount: number;
  latestUnrankedCount: number;
  newestObservedAt: string | null;
  oldestLatestObservedAt: string | null;
  expectedSeriesCount: number | null;
}

export interface RankDiagnosticInput {
  scope: DiagnosticScope;
  source: RankDiagnosticCoverage["source"];
  snapshots: RankSnapshotLike[];
  generatedAt?: string;
  staleAfterMs?: number;
  expectedSeriesCount?: number | null;
}

export interface RankDiagnosticKeyword {
  keyword?: string;
  language?: string;
  status?: string;
  pausedPlatforms?: string[];
  pendingPausePlatforms?: string[];
}

/**
 * Restrict diagnostic evidence to the series the selected product is currently
 * expected to collect. Historical, removed, globally paused, and platform-paused
 * keywords must not inflate the observed coverage.
 */
export function selectRankDiagnosticEvidence(input: {
  snapshots: RankSnapshotLike[];
  trackedKeywords: RankDiagnosticKeyword[];
  supportedLanguages: string[];
  platform: string;
}): { snapshots: RankSnapshotLike[]; expectedSeriesCount: number } {
  const expected = new Set<string>();
  for (const localization of input.supportedLanguages) {
    const queryLanguages = localization === "en" ? ["en"] : [localization, "en"];
    for (const item of input.trackedKeywords) {
      const keyword = String(item.keyword || "").trim();
      const language = String(item.language || "").trim();
      if (!keyword || !queryLanguages.includes(language) || item.status === "paused") continue;
      if ((item.pausedPlatforms || []).includes(input.platform)) continue;
      if ((item.pendingPausePlatforms || []).includes(input.platform)) continue;
      for (const storefront of storefrontsForLanguage(localization)) {
        expected.add(`${keyword}\u0000${language}\u0000${storefront}`);
      }
    }
  }
  return {
    snapshots: input.snapshots.filter((item) =>
      expected.has(`${item.keyword}\u0000${item.language}\u0000${item.storefront}`),
    ),
    expectedSeriesCount: expected.size,
  };
}

function pct(value: number, total: number): string {
  return total > 0 ? `${Math.round((value / total) * 100)}%` : "—";
}

export function buildRankDiagnosticPackage(
  input: RankDiagnosticInput,
): DiagnosticPackage<RankDiagnosticCoverage> {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const now = new Date(generatedAt).getTime();
  const staleAfterMs = input.staleAfterMs ?? 48 * 60 * 60 * 1000;
  const valid: RankSnapshotLike[] = [];
  let invalidTimestampCount = 0;
  let futureTimestampCount = 0;
  for (const item of input.snapshots) {
    const observedAt = new Date(item.checkedAt).getTime();
    if (!Number.isFinite(observedAt)) invalidTimestampCount += 1;
    else if (observedAt > now + 5 * 60_000) futureTimestampCount += 1;
    else valid.push(item);
  }

  const latestBySeries = new Map<string, RankSnapshotLike>();
  for (const item of valid) {
    const key = `${item.keyword}\u0000${item.language}\u0000${item.storefront}`;
    const previous = latestBySeries.get(key);
    if (!previous || new Date(item.checkedAt).getTime() > new Date(previous.checkedAt).getTime()) {
      latestBySeries.set(key, item);
    }
  }
  const latest = [...latestBySeries.values()];
  const fresh = latest.filter((item) => now - new Date(item.checkedAt).getTime() <= staleAfterMs);
  const stale = latest.filter((item) => now - new Date(item.checkedAt).getTime() > staleAfterMs);
  const ranked = latest.filter((item) => item.rank != null);
  const unranked = latest.filter((item) => item.rank == null);
  const times = latest.map((item) => item.checkedAt).sort();
  const expectedSeriesCount = input.expectedSeriesCount ?? null;
  const coverage: RankDiagnosticCoverage = {
    source: valid.length > 0 ? input.source : "none",
    snapshotCount: input.snapshots.length,
    validSnapshotCount: valid.length,
    invalidTimestampCount,
    futureTimestampCount,
    latestSeriesCount: latest.length,
    freshSeriesCount: fresh.length,
    staleSeriesCount: stale.length,
    latestRankedCount: ranked.length,
    latestUnrankedCount: unranked.length,
    newestObservedAt: times.at(-1) ?? null,
    oldestLatestObservedAt: times[0] ?? null,
    expectedSeriesCount,
  };
  const evidenceId = `rank-coverage:${input.scope.productId}:${generatedAt}`;
  const facts = latest.length > 0 ? [
    {
      id: "rank.series-coverage",
      statement: `共有 ${latest.length} 个排名序列；${fresh.length} 个在新鲜度窗口内，${stale.length} 个已过期。`,
      evidenceIds: [evidenceId],
    },
    {
      id: "rank.latest-results",
      statement: `各序列最新结果中 ${ranked.length} 个有排名，${unranked.length} 个未搜到（${pct(unranked.length, latest.length)}）。`,
      evidenceIds: [evidenceId],
    },
  ] : [];
  const anomalies = [];
  if (valid.length === 0) {
    anomalies.push({
      id: "rank.no-valid-data", severity: "blocking" as const,
      statement: "没有可用于排名诊断的有效快照。", evidenceIds: [evidenceId],
      interpretation: "只能建议先完成或修复排名采集，不能判断排名表现。",
    });
  }
  if (invalidTimestampCount > 0) {
    anomalies.push({
      id: "rank.invalid-timestamps", severity: "warning" as const,
      statement: `${invalidTimestampCount} 条快照的时间无效，已从诊断中排除。`, evidenceIds: [evidenceId],
      interpretation: "数据完整性需要修复；其余有效快照仍可用于有边界的判断。",
    });
  }
  if (futureTimestampCount > 0) {
    anomalies.push({
      id: "rank.future-timestamps", severity: "warning" as const,
      statement: `${futureTimestampCount} 条快照来自未来时间，已从诊断中排除。`, evidenceIds: [evidenceId],
      interpretation: "设备时钟或写入时间可能不一致；不能把这些快照当作最新数据。",
    });
  }
  if (latest.length > 0 && stale.length / latest.length >= 0.2) {
    anomalies.push({
      id: "rank.stale-coverage", severity: stale.length === latest.length ? "blocking" as const : "warning" as const,
      statement: `${stale.length}/${latest.length} 个序列的最新观测已过期。`, evidenceIds: [evidenceId],
      interpretation: "当前横向比较可能混合不同采集时间，应先刷新或缩小到新鲜序列。",
    });
  }
  if (expectedSeriesCount != null && expectedSeriesCount > 0 && latest.length / expectedSeriesCount < 0.8) {
    anomalies.push({
      id: "rank.expected-coverage-gap", severity: "blocking" as const,
      statement: `只观测到 ${latest.length}/${expectedSeriesCount} 个预期序列。`, evidenceIds: [evidenceId],
      interpretation: "覆盖缺口可能扭曲总体判断，应先确认调度范围和失败任务。",
    });
  }
  if (fresh.length >= 5 && fresh.every((item) => item.rank == null)) {
    anomalies.push({
      id: "rank.all-fresh-unranked", severity: "warning" as const,
      statement: `${fresh.length} 个新鲜序列的最新结果均未搜到排名。`, evidenceIds: [evidenceId],
      interpretation: "确认的是当前观测不可见；不能仅凭该结果区分选词过宽、商店/平台不匹配、真实表现或采集问题。",
    });
  }

  return {
    schemaVersion: 1,
    generatedAt,
    scope: input.scope,
    coverage,
    facts,
    anomalies,
    limitations: [
      "排名快照不包含搜索量、曝光、商品页转化率或下载量。",
      "未搜到排名不等于排名下降，也不能单独证明关键词选择或采集发生问题。",
      "该包只判断数据覆盖与最新可见性；变化和原因需要独立、带样本门槛的诊断。",
    ],
    evidenceIndex: [{
      id: evidenceId,
      kind: "rank-coverage",
      label: "排名覆盖与最新结果聚合",
      query: {
        projectId: input.scope.projectId,
        productId: input.scope.productId,
        generatedAt,
        staleAfterMs,
      },
    }],
  };
}
