import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BriefSuggestion } from "../../../engine/ai/overview-brief";
import { storefrontsForLanguage } from "../../../engine/storefronts";
import { storefrontDisplayName } from "../../../engine/storefronts";
import { ascStoreLiveVersion, deriveVersionStatus } from "../../../engine/version-status";
import { briefRuleSignals } from "../../lib/overview-brief";
import { matrixCellState, STALE_MS } from "../../lib/matrix";
import { formatHumanTime, languageLabel, platformLabel } from "../../lib/format";
import { localizationList } from "../../lib/release-localization";
import { cn } from "../../lib/utils";
import { useProject, type RankSnapshot } from "../../stores/project";
import { CredentialBadge } from "../ui/CredentialBadge";
import { EmptyState } from "../ui/EmptyState";
import { StatusChip } from "../ui/StatusChip";
import { btnSmPrimary, btnSmSecondary } from "../ui/styles";
import { CompetitorRadarCard } from "./CompetitorRadarCard";
import { FeedbackThemesCard } from "./FeedbackThemesCard";
import { TrafficCard } from "./TrafficCard";
import { ValueFlash } from "../ui/ValueFlash";
import {
  MetricBlock,
  overviewRankRows,
} from "./overviewData";

export function OverviewPage() {
  const { projects, currentProjectId, currentProductId, selectProduct, recordBriefAction } = useProject();
  const navigate = useNavigate();
  const project = projects.find((p) => p.id === currentProjectId);
  const product = project?.storeProducts?.find((item) => item.id === currentProductId) || project?.storeProducts?.[0] || null;
  const [releaseOverview, setReleaseOverview] = useState<{
    draft: { name: string | null; tag: string; publishedAt: string; commitCount: number } | null;
    submission: any | null;
  } | null>(null);
  const [ascInfo, setAscInfo] = useState<{ versions: any[]; builds: any[]; fetchedAt?: string } | null>(null);
  const [storeCurrentVersion, setStoreCurrentVersion] = useState<string | null>(null);
  const [briefState, setBriefState] = useState<{
    status: "idle" | "loading" | "ready" | "error";
    suggestions: BriefSuggestion[];
    progress: { chars: number; phase: "reasoning" | "content" } | null;
    error: string;
  }>({ status: "idle", suggestions: [], progress: null, error: "" });

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    setReleaseOverview(null);
    (window as any).appilot?.release?.list(project.id)
      .then((result: any) => {
        if (cancelled) return;
        const latest = result?.latestDraft || null;
        const release = (result?.releases || [])[0] || null;
        const submission =
          (release?.submissionDrafts || []).find(
            (item: any) => item?.productId === product?.id,
          ) || null;
        setReleaseOverview(
          latest
            ? {
                draft: {
                  name: latest.name,
                  tag: latest.tag,
                  publishedAt: latest.publishedAt,
                  commitCount: Array.isArray(latest.material?.commits)
                    ? latest.material.commits.length
                    : 0,
                },
                submission,
              }
            : null,
        );
      })
      .catch(() => {
        if (!cancelled) setReleaseOverview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [project?.id, product?.id]);

  // Version status derivation: ASC when available, public store lookup as
  // the no-credential fallback (current live version only).
  useEffect(() => {
    if (!product?.id) return;
    let cancelled = false;
    (window as any).appilot?.asc?.status(product.id)
      .then((info: any) => { if (!cancelled) setAscInfo(info); })
      .catch(() => { if (!cancelled) setAscInfo(null); });
    (window as any).appilot?.store?.currentVersion(product.id)
      .then((info: any) => { if (!cancelled) setStoreCurrentVersion(info?.version || null); })
      .catch(() => { if (!cancelled) setStoreCurrentVersion(null); });
    return () => { cancelled = true; };
  }, [product?.id]);

  if (!project || !product) {
    return (
      <EmptyState
        title="还没有项目"
        desc="添加一个项目，副驾驶帮你看路。"
      />
    );
  }

  const languages = product.supportedLanguages || [];
  const storeLinks = product.storeLinks || [];
  const trackedKeywords = project.trackedKeywords || [];
  const trackedActive = trackedKeywords.filter((k) => k.status !== "paused");
  const pausedCount = trackedKeywords.length - trackedActive.length;
  const pendingPauseCount = trackedKeywords.filter((k) =>
    (k.pendingPausePlatforms || []).includes(product.platform),
  ).length;
  const rankSnapshots = product.rankSnapshots || [];
  const rankRows = overviewRankRows(trackedActive, rankSnapshots);
  const top10Count = rankRows.filter((row) => row.bestRank <= 10).length;
  const bestRankNow = rankRows[0]?.bestRank ?? null;
  const newestSnapshot = rankSnapshots.reduce<RankSnapshot | null>(
    (latest, snapshot) =>
      !latest || new Date(snapshot.checkedAt).getTime() > new Date(latest.checkedAt).getTime()
        ? snapshot
        : latest,
    null,
  );
  const newestCheckedAt = newestSnapshot?.checkedAt || null;
  const dataStale = newestCheckedAt ? Date.now() - new Date(newestCheckedAt).getTime() > STALE_MS : false;
  // 全局排名分布（最新快照）：全部关键词 × 当前产品全部商店。
  const RANK_BUCKETS = [
    { key: "top10", label: "TOP10", color: "#15803d", opacity: 1 },
    { key: "r11_50", label: "11–50", color: "#22c55e", opacity: 0.9 },
    { key: "r51_100", label: "51–100", color: "#a3e635", opacity: 0.75 },
    { key: "r101_200", label: "101–200", color: "#facc15", opacity: 0.6 },
    { key: "unranked", label: "未进榜", color: "#a1a1aa", opacity: 0.35 },
  ] as const;
  const allStorefronts = Array.from(
    new Set(
      (product.supportedLanguages || []).flatMap((lang: any) =>
        storefrontsForLanguage(lang.code),
      ),
    ),
  );
  // 平台暂停的关键词不计入分布（矩阵仍显示，调度不采集）。
  const distributionKeywords = (product.trackedKeywords || []).filter(
    (k: any) =>
      k.status !== "paused" &&
      !(k.pausedPlatforms || []).includes(product.platform),
  );
  const distributionData: {
    storefront: string;
    top10: number;
    r11_50: number;
    r51_100: number;
    r101_200: number;
    unranked: number;
  }[] = allStorefronts
    .map((storefront) => {
      const buckets = { top10: 0, r11_50: 0, r51_100: 0, r101_200: 0, unranked: 0 };
      for (const row of distributionKeywords) {
        const cell = matrixCellState(rankSnapshots, row.keyword, storefront);
        const rank = cell.rank;
        if (rank == null || cell.beyond200) buckets.unranked += 1;
        else if (rank <= 10) buckets.top10 += 1;
        else if (rank <= 50) buckets.r11_50 += 1;
        else if (rank <= 100) buckets.r51_100 += 1;
        else buckets.r101_200 += 1;
      }
      return {
        storefront: storefrontDisplayName(storefront),
        top10: buckets.top10,
        r11_50: buckets.r11_50,
        r51_100: buckets.r51_100,
        r101_200: buckets.r101_200,
        unranked: buckets.unranked,
      };
    })
    .sort(
      (a, b) =>
        (b.top10 * 100 + b.r11_50 * 50 + b.r51_100 * 20 + b.r101_200 * 5) -
        (a.top10 * 100 + a.r11_50 * 50 + a.r51_100 * 20 + a.r101_200 * 5),
    );
  const DistributionTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow px-3 py-2 text-xs">
        <p className="font-medium mb-1">{label}</p>
        {RANK_BUCKETS.map((bucket) => {
          const item = payload.find((p: any) => p.dataKey === bucket.key);
          return (
            <div key={bucket.key} className="flex items-center gap-2 py-0.5">
              <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: bucket.color }} />
              <span className="text-zinc-600 dark:text-zinc-300">{bucket.label}</span>
              <span className="ml-auto pl-3 font-medium text-zinc-800 dark:text-zinc-100">
                {item?.value ?? 0}
              </span>
            </div>
          );
        })}
      </div>
    );
  };
  const repoGithubUrl = project.repo?.githubUrl || null;
  const releaseDraft = releaseOverview?.draft ?? null;
  const submissionDraft = releaseOverview?.submission ?? null;
  const submissionLanguages = submissionDraft ? localizationList(submissionDraft) : [];
  const generatedLanguageCount = submissionLanguages.filter((loc: any) =>
    [loc.name, loc.subtitle, loc.promotionalText, loc.description, loc.whatsNew, loc.keywords]
      .some((value) => value && String(value).trim()),
  ).length;
  const languageTotal = languages.length || submissionLanguages.length;
  const confirmChip = submissionDraft
    ? submissionDraft.batchConfirmedAt
      ? ({ label: "整批已确定", tone: "emerald" } as const)
      : submissionDraft.masterConfirmedAt
        ? ({ label: "母本已确定", tone: "amber" } as const)
        : null
    : null;
  const versionStatus = submissionDraft
    ? deriveVersionStatus({
        appVersion: submissionDraft.appVersion || "",
        ascVersions: ascInfo?.versions ?? null,
        storeCurrentVersion,
      })
    : null;
  const storeLiveVersion = ascStoreLiveVersion(ascInfo?.versions);
  // ASC configured but not synced → "待同步", never "未配置"; no version yet
  // → show no status chip at all ("版本待定" is the honest label).
  const ascConfigured = Boolean(project?.hasAscKey);
  const ascPending = ascConfigured && !ascInfo && submissionDraft?.appVersion;
  const effectiveVersionStatus = ascPending
    ? { key: "asc-pending" as const, label: "待同步", tone: "muted" as const, source: "asc" as const }
    : submissionDraft?.appVersion
      ? versionStatus
      : null;
  const handledBriefIds = new Set(
    (project.briefActions || []).map((item) => item.id),
  );
  const ruleSignals = briefRuleSignals({
    rankRows,
    trackedActiveCount: trackedActive.length,
    pausedCount,
    pendingPauseCount,
    languageTotal,
    generatedLanguageCount,
  }).filter((signal) => !handledBriefIds.has(signal.id));
  const briefSuggestions = briefState.suggestions.filter(
    (item) => !handledBriefIds.has(item.id),
  );
  const showRuleSignals =
    briefState.status === "idle" || briefState.status === "error";
  const visibleBriefItems = showRuleSignals ? ruleSignals : briefSuggestions;

  const handleGenerateBrief = useCallback(async () => {
    if (!project || !product) return;
    setBriefState({ status: "loading", suggestions: [], progress: null, error: "" });
    try {
      const result = await (window as any).appilot?.projects?.generateBrief(
        project.id,
        product.id,
      );
      setBriefState({
        status: "ready",
        suggestions: result?.suggestions || [],
        progress: null,
        error: "",
      });
    } catch (err: any) {
      setBriefState({
        status: "error",
        suggestions: [],
        progress: null,
        error: err?.message || "生成失败",
      });
    }
  }, [project?.id, product?.id]);

  useEffect(() => {
    const off = (window as any).appilot?.projects?.onBriefProgress?.((progress: any) => {
      if (progress && typeof progress.chars === "number") {
        setBriefState((prev) => ({
          ...prev,
          progress: {
            chars: progress.chars,
            phase: progress.phase === "content" ? "content" : "reasoning",
          },
        }));
      }
    });
    return () => off?.();
  }, []);

  const handleBriefAction = useCallback(
    async (suggestion: BriefSuggestion, status: "adopted" | "ignored") => {
      if (!project) return;
      await recordBriefAction(project.id, {
        id: suggestion.id,
        action: suggestion.action,
        status,
      });
      if (status === "adopted") {
        if (suggestion.action === "release") {
          navigate(
            releaseDraft?.tag
              ? `/release?tag=${encodeURIComponent(releaseDraft.tag)}`
              : "/release",
          );
        } else if (suggestion.action === "trend") {
          navigate("/trend");
        } else {
          navigate(
            suggestion.target
              ? `/keywords?keyword=${encodeURIComponent(suggestion.target)}`
              : "/keywords",
          );
        }
      }
    },
    [project?.id, recordBriefAction, navigate, releaseDraft?.tag],
  );

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* App identity */}
      <div className="flex items-center gap-3 mb-5">
        {product.artworkUrl ? (
          <img
            src={product.artworkUrl}
            alt=""
            className="w-12 h-12 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm object-cover"
          />
        ) : (
          <div className="w-12 h-12 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center">
            <span className="text-amber-500 text-lg">⌖</span>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 truncate">
            {product.trackName || project.name}
          </h2>
          <div className="flex items-center gap-1 mt-0.5 text-xs font-mono text-zinc-400 dark:text-zinc-500 min-w-0">
            <button
              onClick={() => (window as any).appilot?.revealInFolder?.(project.localPath)}
              className="group flex items-center gap-1 max-w-full min-w-0 truncate hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
              title="在访达中显示"
            >
              <span className="truncate">{project.localPath}</span>
              <span className="shrink-0 opacity-60 group-hover:opacity-100">⌗</span>
            </button>
            {repoGithubUrl && (
              <>
                <span className="shrink-0">(</span>
                <button
                  onClick={() => {
                    if (repoGithubUrl) (window as any).appilot?.openExternal(repoGithubUrl);
                  }}
                  className="shrink-0 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                  title="打开 GitHub 仓库"
                >
                  GitHub
                </button>
                <span className="shrink-0">)</span>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0 min-w-0">
          <div className="flex items-center gap-1.5">
            {(project.storeProducts || []).map((item) => {
              const active = item.id === product.id;
              return (
                <button
                  key={item.id}
                  onClick={() => selectProduct(item.id)}
                  title={active ? "当前查看的平台" : `切换到 ${platformLabel(item.platform)}`}
                  className={cn(
                    "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors",
                    active
                      ? "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-1 ring-amber-500/30"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700",
                  )}
                >
                  {platformLabel(item.platform)}
                </button>
              );
            })}
            <CredentialBadge
              kind="github"
              enabled={Boolean(project.hasGithubToken)}
              projectId={project.id}
              source={project.githubSource}
            />
            <CredentialBadge
              kind="asc"
              enabled={Boolean(project.hasAscKey)}
              projectId={project.id}
              source={project.ascSource}
            />
            <button
              onClick={() => navigate(`/projects/${project.id}/settings`)}
              className="inline-flex items-center px-2.5 h-7 rounded-full border border-zinc-200 dark:border-zinc-700 text-[11px] text-zinc-500 dark:text-zinc-400 hover:border-amber-500/50 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
              title="仓库路径、GitHub 链接与 API 凭据"
            >
              项目设置
            </button>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
            {languages.length > 0 && (
              <span
                className="flex items-center gap-1 min-w-0"
                title={languages.map((l) => l.name).join(" · ")}
              >
                {languages.slice(0, 3).map((l) => (
                  <span
                    key={l.code}
                    className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[10px] text-zinc-600 dark:text-zinc-300"
                  >
                    {l.name}
                  </span>
                ))}
                {languages.length > 3 && <span className="shrink-0">+{languages.length - 3}</span>}
              </span>
            )}
            {storeLinks[0] && (
              <>
                <span className="w-px h-3 bg-zinc-200 dark:bg-zinc-800" />
                <button
                  onClick={() => (window as any).appilot?.openExternal(storeLinks[0].url)}
                  className="text-[11px] font-medium text-amber-600 dark:text-amber-400 hover:underline shrink-0"
                  title={storeLinks[0].name}
                >
                  App Store ↗
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Copilot brief */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm mb-4">
        <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">副驾驶简报</h3>
          {briefState.status === "loading" ? (
            <span className="text-[11px] text-zinc-400 dark:text-zinc-500 shrink-0">
              {briefState.progress?.phase === "content" ? "生成中" : "思考中"} · {briefState.progress?.chars ?? 0} 字
            </span>
          ) : (
            <button onClick={handleGenerateBrief} className={btnSmSecondary}>
              生成简报
            </button>
          )}
        </div>
        {briefState.status === "error" && (
          <p className="px-5 py-2 text-[11px] text-red-500 dark:text-red-400 border-b border-zinc-100 dark:border-zinc-800">
            {briefState.error}（已显示规则信号）
          </p>
        )}
        {briefState.status === "loading" ? (
          <div className="px-5 py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">
            AI 正在分析排名与发布状态…
          </div>
        ) : visibleBriefItems.length === 0 ? (
          <div className="px-5 py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">
            {briefState.status === "ready" ? "本周事项已清空" : "暂无建议，点「生成简报」让副驾驶看路"}
          </div>
        ) : (
          <ul>
            {visibleBriefItems.map((item, index) => (
              <li
                key={item.id}
                className="flex items-center gap-3 px-5 py-2 border-b border-zinc-100 dark:border-zinc-800 last:border-b-0"
              >
                <span className="w-4 shrink-0 text-xs font-mono text-zinc-400 dark:text-zinc-500">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">{item.title}</p>
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate" title={item.reason}>
                    {item.reason}
                  </p>
                </div>
                <button
                  onClick={() => handleBriefAction(item, "adopted")}
                  className={cn(btnSmSecondary, "!px-2.5 !py-1")}
                >
                  采纳
                </button>
                <button
                  onClick={() => handleBriefAction(item, "ignored")}
                  className="px-2.5 py-1 text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                >
                  忽略
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <MetricBlock
          to="/keywords?scope=tracked"
          label="跟踪关键词"
          value={String(trackedActive.length)}
          sub={pausedCount > 0 ? `暂停 ${pausedCount}` : "跟踪中"}
        />
        <MetricBlock
          to="/keywords?scope=ranked"
          label="当前入榜"
          value={String(rankRows.length)}
          sub={bestRankNow !== null ? `最佳 #${bestRankNow}` : "暂无上榜"}
        />
        <MetricBlock to="/keywords?scope=top10" label="前 10" value={String(top10Count)} highlight={top10Count > 0} />
        <MetricBlock
          to="/keywords"
          label="最近采集"
          value={newestCheckedAt ? formatHumanTime(newestCheckedAt) : "—"}
          warn={dataStale}
          sub={dataStale ? "数据已过期" : "排名页详情"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <TrafficCard project={project} />
        <CompetitorRadarCard project={project} />
        <FeedbackThemesCard project={project} />
      </div>

      {/* Rank trend chart + top keywords */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="lg:col-span-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">排名分布</h3>
            <div className="flex items-center gap-2.5 shrink-0">
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                {newestCheckedAt ? (
                  <span className={cn(dataStale && "text-amber-600 dark:text-amber-400")}>
                    数据截至 {formatHumanTime(newestCheckedAt)}
                  </span>
                ) : (
                  "暂无数据"
                )}
              </span>
            </div>
          </div>
          {trackedActive.length === 0 || distributionData.length === 0 ? (
            <div className="h-56 flex flex-col items-center justify-center gap-3">
              <p className="text-sm text-zinc-400 dark:text-zinc-500">
                {trackedActive.length === 0
                  ? "还没有跟踪关键词"
                  : "暂无排名数据"}
              </p>
              <Link to="/keywords" className={btnSmSecondary}>
                {trackedActive.length === 0 ? "去生成关键词" : "去排名页"}
              </Link>
            </div>
          ) : (
            <div className="p-3">
              <ResponsiveContainer width="100%" height={224}>
                <AreaChart data={distributionData} margin={{ top: 8, right: 16, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                  <XAxis
                    dataKey="storefront"
                    tick={{ fontSize: 10, fill: "#a1a1aa" }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={28}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 10, fill: "#a1a1aa" }}
                    tickLine={false}
                    axisLine={false}
                    width={44}
                  />
                  <Tooltip content={<DistributionTooltip />} />
                  {RANK_BUCKETS.map((bucket) => (
                    <Area
                      key={bucket.key}
                      type="monotone"
                      dataKey={bucket.key}
                      stackId="1"
                      stroke="none"
                      fill={bucket.color}
                      fillOpacity={bucket.opacity}
                      name={bucket.label}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                {RANK_BUCKETS.map((bucket) => (
                  <span
                    key={bucket.key}
                    className="inline-flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400"
                  >
                    <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: bucket.color }} />
                    {bucket.label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Top 关键词</h3>
            <Link to="/keywords" className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline">
              查看全部 →
            </Link>
          </div>
          {rankRows.length === 0 ? (
            <div className="p-8 text-center text-sm text-zinc-400 dark:text-zinc-500">暂无排名数据</div>
          ) : (
            <ul>
              {rankRows.slice(0, 5).map((row, index) => (
                <Link
                  key={`${row.language}:${row.keyword}`}
                  to={`/keywords?keyword=${encodeURIComponent(row.keyword)}&lang=${encodeURIComponent(row.language)}`}
                  className={cn(
                    "flex items-center gap-2.5 px-4 py-2 border-b border-zinc-100 dark:border-zinc-800 last:border-b-0 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors",
                    row.stale && "opacity-55",
                  )}
                >
                  <span className="w-4 shrink-0 text-xs font-mono text-zinc-400 dark:text-zinc-500">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 font-mono text-[13px] text-zinc-800 dark:text-zinc-200 truncate">
                    {row.keyword}
                  </span>
                  {row.language === "en" ? (
                    <span className="shrink-0 inline-flex px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                      全局
                    </span>
                  ) : (
                    <span className="shrink-0 text-[10px] text-zinc-400 dark:text-zinc-500">
                      {languageLabel(row.language)}
                    </span>
                  )}
                  <ValueFlash
                    value={row.bestRank}
                    mode="box"
                    className={cn(
                      "shrink-0 w-8 text-right font-mono text-[13px] font-semibold",
                      row.bestRank <= 10
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-zinc-800 dark:text-zinc-200",
                    )}
                  >
                    #{row.bestRank}
                  </ValueFlash>
                  <span className="shrink-0 w-11 text-right text-[11px]">
                    {row.trend === "up" && (
                      <span className="text-emerald-600 dark:text-emerald-400">▲{row.delta}</span>
                    )}
                    {row.trend === "down" && (
                      <span className="text-red-500 dark:text-red-400">▼{Math.abs(row.delta ?? 0)}</span>
                    )}
                    {row.trend === "new" && <span className="text-amber-600 dark:text-amber-400">进榜</span>}
                    {row.trend === "same" && <span className="text-zinc-400">—</span>}
                  </span>
                </Link>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Release status */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm px-5 py-3.5 flex items-center gap-3 mb-4">
        <span className="shrink-0 text-lg text-amber-500">📦</span>
        {releaseDraft ? (
          <>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <Link
                  to={releaseDraft?.tag ? `/release?tag=${encodeURIComponent(releaseDraft.tag)}` : "/release"}
                  className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                >
                  {releaseDraft.name || releaseDraft.tag}
                </Link>
                {releaseDraft.commitCount > 0 && (
                  <span className="text-[11px] text-zinc-400 dark:text-zinc-500 shrink-0">
                    · {releaseDraft.commitCount} 次提交
                  </span>
                )}
                {submissionDraft && (
                  <StatusChip
                    label={
                      generatedLanguageCount > 0
                        ? `${generatedLanguageCount}/${languageTotal} 语言`
                        : "未生成文案"
                    }
                    tone={
                      languageTotal > 0 && generatedLanguageCount >= languageTotal
                        ? "emerald"
                        : "muted"
                    }
                  />
                )}
                {confirmChip && <StatusChip label={confirmChip.label} tone={confirmChip.tone} />}
                {effectiveVersionStatus && <StatusChip label={effectiveVersionStatus.label} tone={effectiveVersionStatus.tone} />}
                {effectiveVersionStatus && (
                  <span
                    className="inline-flex px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[10px] text-zinc-500 dark:text-zinc-400"
                    title={
                      effectiveVersionStatus.source === "asc"
                        ? "来自 App Store 凭证查询"
                        : effectiveVersionStatus.source === "store-lookup"
                          ? "来自 App Store 公开查询（未配置 App Store 凭证）"
                          : "未配置 App Store 凭证，无法确认"
                    }
                  >
                    {effectiveVersionStatus.source === "asc"
                      ? "App Store"
                      : effectiveVersionStatus.source === "store-lookup"
                        ? "商店"
                        : "未配置"}
                  </span>
                )}
                {submissionDraft?.appVersion && storeLiveVersion && (
                  storeLiveVersion === submissionDraft.appVersion ? (
                    <span className="text-[11px] text-emerald-600 dark:text-emerald-500">
                      商店版本 v{storeLiveVersion}，与目标一致
                    </span>
                  ) : (
                    <span className="text-[11px] text-amber-600 dark:text-amber-500">
                      商店当前版本 v{storeLiveVersion} ≠ 目标 v{submissionDraft.appVersion}
                    </span>
                  )
                )}
              </div>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                {formatHumanTime(releaseDraft.publishedAt)} 更新 · 提交素材
              </p>
            </div>
            <Link
              to={releaseDraft?.tag ? `/release?tag=${encodeURIComponent(releaseDraft.tag)}` : "/release"}
              className={btnSmPrimary}
            >
              打开发布工作台
            </Link>
          </>
        ) : (
          <>
            <p className="flex-1 min-w-0 text-sm text-zinc-400 dark:text-zinc-500 truncate">
              暂无待处理发布（有新提交或新 tag 后自动发现素材）
            </p>
            <Link to="/release" className={btnSmSecondary}>
              去发布页
            </Link>
          </>
        )}
      </div>

    </div>
  );
}
