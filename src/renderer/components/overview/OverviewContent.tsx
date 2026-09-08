/**
 * OverviewPage 的共享内容组件（纯 props，无 Electron/zustand/路由依赖）。
 *
 * 两个宿主共用同一套 UI：
 * - Electron：OverviewPage 负责取数（IPC + zustand + 路由），把数据与回调传入；
 * - DSH 客户端：esbuild 打包本文件，数据来自 appilot_overview 工具结果
 *   （映射成 Project/StoreProduct 形状），回调为简单跳转/无操作。
 *
 * 布局（自上而下，模拟发布流水线，先结论后细节）：
 * 标题/产品选择 → 副驾驶简报（置顶宽条）→ 三阶段卡（①开发 → ②发布 → ③上架）
 * → 竞品状况 → 排名分布 → 用户反馈（保持现状，不再强调）。
 *
 * 防重复约定（旧「健康概览行 / 发布摘要卡 / 项目状况卡」内容已归并进阶段卡）：
 * - repo/HEAD/工作区状态只出现在 ①开发；待处理提交数（draft.commitCount）只在
 *   ②发布出现一次（它属于发布物料的构成，语义=待处理提交）；
 * - 商店当前/目标版本与审核状态（deriveVersionStatus）只出现在 ③上架；
 * - GitHub 凭证徽标只出现在 ①开发，App Store 凭证徽标只出现在 ③上架；
 * - GitHub ↗ 外部仓库链接只在 ①开发卡出现。
 * 竞品数据由宿主经 props（competitorSummary/competitorHref）注入，DSH 缺数据
 * 传 null/空即可（本组件不调用 window）。
 *
 * 样式沿用原 Tailwind 类（Electron 编译进应用；DSH 侧用 scoped tailwind + 宿主主题）。
 */
import type { ComponentType, ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BriefSuggestion } from "@appilot-labs/appilot-core/ai/overview-brief";
import type { FeedbackTheme } from "@appilot-labs/appilot-core/feedback-inbox";
import { storefrontsForLanguage } from "@appilot-labs/appilot-core/storefronts";
import { storefrontDisplayName } from "@appilot-labs/appilot-core/storefronts";
import { ascStoreLiveVersion, deriveVersionStatus } from "@appilot-labs/appilot-core/version-status";
import { briefRuleSignals } from "../../lib/overview-brief";
import { matrixCellState, STALE_MS } from "../../lib/matrix";
import { formatHumanTime, languageLabel, platformLabel } from "../../lib/format";
import { localizationList } from "../../lib/release-localization";
import { cn } from "../../lib/utils";
import { KeywordRuby } from "../ui/KeywordRuby";
import { CredentialBadge } from "../ui/CredentialBadge";
import { EmptyState } from "../ui/EmptyState";
import { StatusChip } from "../ui/StatusChip";
import { btnSmPrimary, btnSmSecondary } from "../ui/styles";
import { FeedbackThemesCard } from "./FeedbackThemesCard";
import { overviewRankRows } from "./overviewData";
import type { CompetitorSummary } from "./overviewData";
import type { Project, RankSnapshot, StoreProduct } from "../../stores/project";

/** Link 注入点：Electron 用 react-router Link；DSH 传自己的轻量实现。 */
export type OverviewLink = ComponentType<{
  to: string;
  className?: string;
  children?: ReactNode;
  [key: string]: any;
}>;

export interface OverviewContentProps {
  project: Project | null;
  product: StoreProduct | null;
  releaseOverview: {
    draft: { name: string | null; tag: string; publishedAt: string; commitCount: number } | null;
    submission: any | null;
  } | null;
  ascInfo: { versions: any[]; builds: any[]; fetchedAt?: string } | null;
  storeCurrentVersion: string | null;
  /** 可选注入：项目活跃数据（每日提交数 + 发布），供 ①开发 的 GitHub 活跃块使用；缺省则只显示 repo 状态。 */
  activityData?: { commits: Record<string, number>; releases: { tag: string; publishedAt: string | null }[] };
  /** 可选注入：用户反馈聚类主题，供 FeedbackThemesCard 使用；缺省卡片内部取数。 */
  feedbackThemes?: FeedbackTheme[];
  /** 可选注入：竞品概览聚合（Electron 宿主从 competitors:overview 聚合）；DSH 等无竞品数据宿主不传/null。 */
  competitorSummary?: CompetitorSummary | null;
  /** 可选注入：去竞品页的跳转地址（宿主约定）；缺省/空则竞品卡只展示文字入口。 */
  competitorHref?: string;
  briefState: {
    status: "idle" | "loading" | "ready" | "error";
    suggestions: BriefSuggestion[];
    progress: { chars: number; phase: "reasoning" | "content" } | null;
    error: string;
  };
  /** 默认 react-router Link；DSH 侧传入无路由依赖的实现。 */
  LinkComponent?: OverviewLink;
  onSelectProduct: (id: string) => void;
  onOpenExternal: (url: string) => void;
  onRevealInFolder: (path: string) => void;
  onOpenSettings: (projectId: string) => void;
  onGenerateBrief: () => void;
  onBriefAction: (suggestion: BriefSuggestion, status: "adopted" | "ignored") => void;
}

const CHIP_BASE =
  "inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0";

/** 阶段卡内小标题（与旧 SummaryCard/健康块一致的标签样式）。 */
const STAGE_LABEL =
  "text-[11px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500";

/** 本地日键（YYYY-MM-DD），activityData.commits 的键按此语义聚合。 */
function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * activityData.commits 的最近 N 天提交汇总（本地日）。
 * 键可能带时间或时区，统一取前 10 位；越界/未来日期忽略。
 * commits 缺失或空对象 → null（调用方据此隐藏「GitHub 活跃」块、只显示 repo 状态）。
 */
function activityWindowStats(
  commits: Record<string, number> | undefined,
  days: number,
): { total: number; today: number; latestKey: string | null } | null {
  if (!commits || typeof commits !== "object") return null;
  const keys = Object.keys(commits);
  if (keys.length === 0) return null;
  const now = new Date();
  const today = localDayKey(now);
  const floor = localDayKey(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)),
  );
  let total = 0;
  let latestKey: string | null = null;
  for (const raw of keys) {
    const key = raw.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    const count = Math.max(0, Number(commits[raw]) || 0);
    if (count === 0) continue;
    if (key >= floor && key <= today) total += count;
    if (key <= today && (!latestKey || key > latestKey)) latestKey = key;
  }
  return { total, today: Math.max(0, Number(commits[today]) || 0), latestKey };
}

/** 三阶段卡的统一外壳：阶段序号 + 名称 + 单行导语 + 可选头部 CTA + 主体。 */
function StageCard({
  step,
  stepClass,
  title,
  lead,
  right,
  children,
}: {
  step: string;
  stepClass: string;
  title: ReactNode;
  lead: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex h-full flex-col rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
      <div className="flex items-start justify-between gap-3 px-5 pt-3.5 pb-1">
        <h3 className="flex items-center gap-2 min-w-0">
          <span
            className={cn(
              "inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-semibold shrink-0",
              stepClass,
            )}
          >
            {step}
          </span>
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
            {title}
          </span>
        </h3>
        {right}
      </div>
      <p className="px-5 pb-2 text-[11px] text-zinc-400 dark:text-zinc-500">{lead}</p>
      <div className="flex-1 px-5 pb-4 pt-1">{children}</div>
    </section>
  );
}

/** 三列摘要卡的统一外壳（header + 主体，卡片等高、主体可撑开）。 */
function SummaryCard({
  title,
  right,
  children,
  footer,
}: {
  title: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
        {right}
      </div>
      <div className="flex-1">{children}</div>
      {footer && (
        <div className="flex items-center gap-2 px-5 py-2.5 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40">
          {footer}
        </div>
      )}
    </div>
  );
}

export function OverviewContent(props: OverviewContentProps) {
  const {
    project,
    product,
    releaseOverview,
    ascInfo,
    storeCurrentVersion,
    activityData,
    feedbackThemes,
    competitorSummary,
    competitorHref,
    briefState,
    LinkComponent = Link,
    onSelectProduct,
    onOpenExternal,
    onRevealInFolder,
    onOpenSettings,
    onGenerateBrief,
    onBriefAction,
  } = props;

  if (!project || !product) {
    return <EmptyState title="还没有项目" desc="添加一个项目，副驾驶帮你看路。" />;
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
  const bestRankRow = rankRows[0] || null;
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
  // 分布词源 = 项目级共享关键词池（与排名页「排名分布」同源）。不能取
  // product.trackedKeywords：多产品项目里非主产品副本可能为空（DB product_records
  // 无该平台的词，如 ai-pulse-macos 的 iOS 产品 0 词但快照存在），按产品副本取数
  // 会导致 iOS 分布整列空白。平台维度由当前产品的 rankSnapshots/supportedLanguages
  // 表达；平台暂停的关键词不计入分布（矩阵仍显示，调度不采集）。
  const distributionKeywords = trackedActive.filter(
    (k) => !(k.pausedPlatforms || []).includes(product.platform),
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
  const ascConfigured = Boolean(project?.hasAscKey);
  const ascPending = ascConfigured && !ascInfo && submissionDraft?.appVersion;
  const effectiveVersionStatus = ascPending
    ? { key: "asc-pending" as const, label: "待同步", tone: "muted" as const, source: "asc" as const }
    : submissionDraft?.appVersion
      ? versionStatus
      : null;

  // ── 三阶段派生 ──
  // ① 开发：GitHub 活跃（近 7 天合计 + 今日）与 repo 状态。
  const activityStats = activityWindowStats(activityData?.commits, 7);
  // ② 发布：最新 Release（draft 优先，activityData.releases 兜底）。
  const latestReleaseName = releaseDraft ? releaseDraft.name || releaseDraft.tag : null;
  const latestReleaseDate = releaseDraft ? releaseDraft.publishedAt : null;
  const activityLatestRelease = activityData?.releases?.[0] ?? null;
  const fallbackReleaseName = activityLatestRelease?.tag || null;
  const fallbackReleaseDate = activityLatestRelease?.publishedAt || null;
  const releasePendingCommits = releaseDraft ? releaseDraft.commitCount : 0;
  // ③ 上架：商店当前版本（公开查询优先，ASC 兜底）vs 目标版本的审核状态。
  const liveStoreVersion = storeCurrentVersion || storeLiveVersion || null;
  const targetVersion = submissionDraft?.appVersion || null;
  const storeUnconfigured = !product.trackId && storeLinks.length === 0;

  const handledBriefIds = new Set(
    (project.briefActions || []).map((item) => item.id),
  );
  const rankRowsWithTranslation = rankRows.map((row) => ({
    ...row,
    translation:
      trackedKeywords.find(
        (k: any) => k.language === row.language && k.keyword === row.keyword,
      )?.translation || null,
  }));
  const ruleSignals = briefRuleSignals({
    rankRows: rankRowsWithTranslation,
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

  // ── 竞品概览派生（null → 空态；top 为全表，合计按全表求、TOP3 取前三条） ──
  const competitorEntries = competitorSummary?.top ?? [];
  const pressuredTotal = competitorEntries.reduce(
    (sum, item) => sum + (Number(item.pressuredCount) || 0),
    0,
  );
  const competitorTrackedTotal = competitorSummary?.totalTracked ?? competitorEntries.length;
  const gainedEvents = competitorSummary?.gained ?? 0;
  const droppedEvents = competitorSummary?.dropped ?? 0;
  const staleCompetitors = competitorSummary?.stale ?? 0;

  // ── 发布卡 CTA：有草稿 → 打开其发布工作台；否则 → 发布页 ──
  const releaseCardTo = releaseDraft?.tag
    ? `/release?tag=${encodeURIComponent(releaseDraft.tag)}`
    : "/release";

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
              onClick={() => onRevealInFolder(project.localPath)}
              className="group flex items-center gap-1 max-w-full min-w-0 truncate hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
              title="在访达中显示"
            >
              <span className="truncate">{project.localPath}</span>
              <span className="shrink-0 opacity-60 group-hover:opacity-100">⌗</span>
            </button>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0 min-w-0">
          <div className="flex items-center gap-1.5">
            {(project.storeProducts || []).map((item) => {
              const active = item.id === product.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onSelectProduct(item.id)}
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
            <button
              onClick={() => onOpenSettings(project.id)}
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
                title={languages.map((l) => languageLabel(l.code)).join(" · ")}
              >
                {languages.slice(0, 3).map((l) => (
                  <span
                    key={l.code}
                    className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[10px] text-zinc-600 dark:text-zinc-300"
                  >
                    {languageLabel(l.code)}
                  </span>
                ))}
                {languages.length > 3 && <span className="shrink-0">+{languages.length - 3}</span>}
              </span>
            )}
            {storeLinks[0] && (
              <>
                <span className="w-px h-3 bg-zinc-200 dark:bg-zinc-800" />
                <button
                  onClick={() => onOpenExternal(storeLinks[0].url)}
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
            <button onClick={onGenerateBrief} className={btnSmSecondary}>
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
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                    {(() => {
                      // 规则信号标题里嵌入的关键词，用 ruby 标注译文。
                      const brief = item as any;
                      if (!brief.keyword) return item.title;
                      const title = String(item.title || "");
                      const idx = title.indexOf(brief.keyword);
                      if (idx < 0) return title;
                      return (
                        <>
                          {title.slice(0, idx)}
                          <KeywordRuby
                            keyword={brief.keyword}
                            translation={brief.translation}
                            annotate={
                              brief.keywordLanguage !== "zh-Hans" &&
                              brief.keywordLanguage !== "zh-Hant"
                            }
                          />
                          {title.slice(idx + brief.keyword.length)}
                        </>
                      );
                    })()}
                  </p>
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate" title={item.reason}>
                    {item.reason}
                  </p>
                </div>
                <button
                  onClick={() => onBriefAction(item, "adopted")}
                  className={cn(btnSmSecondary, "!px-2.5 !py-1")}
                >
                  采纳
                </button>
                <button
                  onClick={() => onBriefAction(item, "ignored")}
                  className="px-2.5 py-1 text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                >
                  忽略
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 三阶段流水线：① 开发 → ② 发布 → ③ 上架（每阶段披露最重要的一个信号） */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        {/* ① 开发：GitHub 活跃 + 当前提交 + GitHub 凭证 */}
        <StageCard
          step="1"
          stepClass="bg-sky-50 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400"
          title="开发"
          lead="仓库当前提交与开发活跃"
          right={
            repoGithubUrl ? (
              <button
                onClick={() => onOpenExternal(repoGithubUrl)}
                className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline shrink-0"
                title="打开 GitHub 仓库"
              >
                GitHub ↗
              </button>
            ) : undefined
          }
        >
          <div className="space-y-3">
            {activityStats && (
              <div className="min-w-0">
                <p className={STAGE_LABEL}>GitHub 活跃 · 近 7 天</p>
                {activityStats.total > 0 ? (
                  <>
                    <p className="mt-1 text-lg font-semibold leading-tight text-zinc-900 dark:text-zinc-100">
                      {activityStats.total} 次提交
                    </p>
                    <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                      {activityStats.today > 0
                        ? `今日 ${activityStats.today} 次`
                        : "今日暂无提交"}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">近 7 天无提交</p>
                )}
              </div>
            )}
            <div className="min-w-0">
              <p className={STAGE_LABEL}>当前提交</p>
              {project.repo ? (
                <div className="mt-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                    <span
                      className="min-w-0 font-mono text-[12px] text-zinc-800 dark:text-zinc-200 truncate"
                      title={
                        project.repo.headMessage ||
                        project.repo.remoteUrl ||
                        project.localPath
                      }
                    >
                      {project.repo.headSha
                        ? `${project.repo.headSha.slice(0, 7)}${project.repo.branch && project.repo.branch !== "HEAD" ? ` @ ${project.repo.branch}` : ""}`
                        : project.repo.remoteUrl || "—"}
                    </span>
                    {project.repo.dirty && (
                      <StatusChip label="工作区有改动" tone="amber" />
                    )}
                  </div>
                  {project.repo.headDate && (
                    <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
                      上次提交 {formatHumanTime(project.repo.headDate)}
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                  未配置本地仓库路径
                </p>
              )}
            </div>
            <div>
              <p className={STAGE_LABEL}>GitHub 凭证</p>
              <div className="mt-1.5 flex items-center gap-1.5">
                <CredentialBadge
                  kind="github"
                  enabled={Boolean(project.hasGithubToken)}
                  projectId={project.id}
                  source={project.githubSource}
                />
                {!project.hasGithubToken && (
                  <button
                    onClick={() => onOpenSettings(project.id)}
                    className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline shrink-0"
                  >
                    去设置
                  </button>
                )}
              </div>
            </div>
          </div>
        </StageCard>

        {/* ② 发布：最新 Release + 待处理提交 + 文案/确认进度 */}
        <StageCard
          step="2"
          stepClass="bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400"
          title="发布"
          lead="GitHub Release 与下一个版本待发"
          right={
            <LinkComponent to={releaseCardTo} className={releaseDraft ? btnSmPrimary : btnSmSecondary}>
              去发布页
            </LinkComponent>
          }
        >
          <div>
            <p className={STAGE_LABEL}>最新 Release</p>
            {latestReleaseName || fallbackReleaseName ? (
              <div className="mt-1 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                  <LinkComponent
                    to={releaseCardTo}
                    className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                    title={latestReleaseName || fallbackReleaseName || undefined}
                  >
                    {latestReleaseName || fallbackReleaseName}
                  </LinkComponent>
                  {(latestReleaseDate || fallbackReleaseDate) && (
                    <span className="text-[11px] text-zinc-400 dark:text-zinc-500 shrink-0">
                      {formatHumanTime(latestReleaseDate || fallbackReleaseDate)}
                    </span>
                  )}
                </div>
                {releaseDraft && (
                  <>
                    {releasePendingCommits > 0 && (
                      <p className="mt-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-500">
                        {releasePendingCommits} 个提交待处理 · 下一个版本待发
                      </p>
                    )}
                    {(submissionDraft || confirmChip) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
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
                        {confirmChip && (
                          <StatusChip label={confirmChip.label} tone={confirmChip.tone} />
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                暂无发布记录（有新提交或新 tag 后自动发现素材）
              </p>
            )}
            {project.trafficError && (
              <p
                className="mt-2 text-[11px] text-red-500 dark:text-red-400 truncate"
                title={project.trafficError}
              >
                流量采集异常：{project.trafficError}
              </p>
            )}
          </div>
        </StageCard>

        {/* ③ 上架与表现：版本状态 + TOP10/最好名次/采集新鲜度 + App Store 凭证 */}
        <StageCard
          step="3"
          stepClass="bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          title="上架"
          lead="商店版本与榜单表现"
        >
          <div className="space-y-3">
            <div className="min-w-0">
              <p className={STAGE_LABEL}>上架状态</p>
              <div className="mt-1 flex items-center gap-2 flex-wrap">
                {effectiveVersionStatus && targetVersion ? (
                  <>
                    <StatusChip
                      label={effectiveVersionStatus.label}
                      tone={effectiveVersionStatus.tone}
                    />
                    <span className="font-mono text-[12px] text-zinc-800 dark:text-zinc-200">
                      目标 v{targetVersion}
                    </span>
                  </>
                ) : (
                  <span
                    className={cn(
                      "text-sm font-semibold",
                      liveStoreVersion
                        ? "text-zinc-900 dark:text-zinc-100"
                        : "text-zinc-400 dark:text-zinc-500",
                    )}
                  >
                    商店 v{liveStoreVersion ?? "—"}
                  </span>
                )}
              </div>
              <p
                className={cn(
                  "mt-1 text-[11px]",
                  effectiveVersionStatus?.tone === "red"
                    ? "text-red-500 dark:text-red-400"
                    : effectiveVersionStatus?.tone === "amber"
                      ? "text-amber-600 dark:text-amber-500"
                      : "text-zinc-400 dark:text-zinc-500",
                )}
              >
                {targetVersion
                  ? liveStoreVersion
                    ? `商店当前 v${liveStoreVersion}`
                    : "商店暂未查到该版本"
                  : liveStoreVersion
                    ? "暂无新版本在途"
                    : submissionDraft
                      ? "发布版本尚未填写"
                      : storeUnconfigured
                        ? "未配置商店/上架信息"
                        : "未获取到商店信息"}
              </p>
            </div>

            <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3 min-w-0">
              <p className={STAGE_LABEL}>表现</p>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800 px-2.5 py-2 min-w-0">
                  <p className="text-[10px] text-zinc-400 dark:text-zinc-500">TOP10 词数</p>
                  <p
                    className={cn(
                      "mt-0.5 text-lg font-semibold leading-tight",
                      trackedActive.length === 0 || top10Count === 0
                        ? "text-zinc-400 dark:text-zinc-500"
                        : "text-emerald-600 dark:text-emerald-400",
                    )}
                  >
                    {trackedActive.length === 0 ? "—" : top10Count}
                  </p>
                  <p className="mt-0.5 text-[10px] text-zinc-400 dark:text-zinc-500 truncate">
                    {trackedActive.length === 0
                      ? "未跟踪关键词"
                      : rankRows.length > 0
                        ? `在榜 ${rankRows.length} 词`
                        : "暂无上榜记录"}
                  </p>
                </div>
                <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800 px-2.5 py-2 min-w-0">
                  <p className="text-[10px] text-zinc-400 dark:text-zinc-500">最好名次</p>
                  <p
                    className={cn(
                      "mt-0.5 text-lg font-semibold leading-tight truncate",
                      bestRankRow
                        ? "text-zinc-900 dark:text-zinc-100"
                        : "text-zinc-400 dark:text-zinc-500",
                    )}
                    title={bestRankRow ? `#${bestRankRow.bestRank} ${bestRankRow.keyword}` : undefined}
                  >
                    {bestRankRow ? `#${bestRankRow.bestRank}` : "—"}
                  </p>
                  <p className="mt-0.5 text-[10px] text-zinc-400 dark:text-zinc-500 truncate">
                    {bestRankRow
                      ? `${bestRankRow.keyword} · ${storefrontDisplayName(bestRankRow.storefront)}`
                      : trackedActive.length === 0
                        ? "未跟踪关键词"
                        : "暂无上榜记录"}
                  </p>
                </div>
              </div>
              <p
                className={cn(
                  "mt-2 text-[11px]",
                  dataStale ? "text-red-500 dark:text-red-400" : "text-zinc-400 dark:text-zinc-500",
                )}
              >
                {newestCheckedAt ? (
                  dataStale
                    ? `数据过期 · 上次采集 ${formatHumanTime(newestCheckedAt)}`
                    : `数据截至 ${formatHumanTime(newestCheckedAt)}`
                ) : trackedActive.length === 0 ? (
                  "尚未跟踪关键词"
                ) : (
                  "等待首次采集"
                )}
              </p>
            </div>

            <div>
              <p className={STAGE_LABEL}>App Store 凭证</p>
              <div className="mt-1.5 flex items-center gap-1.5">
                <CredentialBadge
                  kind="asc"
                  enabled={Boolean(project.hasAscKey)}
                  projectId={project.id}
                  source={project.ascSource}
                />
                {!project.hasAscKey && (
                  <button
                    onClick={() => onOpenSettings(project.id)}
                    className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline shrink-0"
                  >
                    去设置
                  </button>
                )}
              </div>
            </div>
          </div>
        </StageCard>
      </div>

      {/* 竞品状况卡：跟踪数 / 压我方词 / 进退榜事件 + TOP3（数据由宿主经 competitorSummary 注入） */}
      <div className="mb-4">
        <SummaryCard
          title="竞品状况"
          right={
            competitorHref ? (
              <LinkComponent
                to={competitorHref}
                className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline shrink-0"
              >
                去竞品页 →
              </LinkComponent>
            ) : undefined
          }
        >
          {!competitorSummary || competitorEntries.length === 0 ? (
            <div className="px-5 py-7 text-center">
              <p className="text-xs text-zinc-400 dark:text-zinc-500">尚未查看竞品</p>
              {competitorHref ? (
                <LinkComponent
                  to={competitorHref}
                  className="mt-1 inline-block text-xs text-amber-600 dark:text-amber-400 hover:underline"
                >
                  去竞品页 →
                </LinkComponent>
              ) : (
                <span className="mt-1 block text-xs text-zinc-300 dark:text-zinc-600">
                  去竞品页
                </span>
              )}
            </div>
          ) : (
            <>
              <div className="px-5 pt-3 flex flex-wrap items-center gap-1.5">
                <span className={cn(CHIP_BASE, "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400")}>
                  跟踪 {competitorTrackedTotal}
                </span>
                <span
                  className={cn(
                    CHIP_BASE,
                    pressuredTotal > 0
                      ? "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400"
                      : "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                  )}
                  title="竞品压制我方词数合计（竞品 ≤200 且领先或我方未进榜）"
                >
                  {pressuredTotal > 0 ? `压我方词 ${pressuredTotal}` : "暂无压制词"}
                </span>
                {gainedEvents > 0 && (
                  <span className={cn(CHIP_BASE, "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400")}>
                    新上榜 +{gainedEvents}
                  </span>
                )}
                {droppedEvents > 0 && (
                  <span className={cn(CHIP_BASE, "bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400")}>
                    跌出 {droppedEvents}
                  </span>
                )}
                {staleCompetitors > 0 && (
                  <span className={cn(CHIP_BASE, "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400")}>
                    停滞 {staleCompetitors}
                  </span>
                )}
              </div>
              <div className="px-2 pb-3 pt-1">
                {competitorEntries.slice(0, 3).map((entry, index) => (
                  <div key={`${entry.name}-${index}`} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="w-4 shrink-0 text-[11px] font-mono text-zinc-400 dark:text-zinc-500">
                      {index + 1}
                    </span>
                    <span
                      className="min-w-0 flex-1 truncate text-xs text-zinc-800 dark:text-zinc-200"
                      title={entry.name}
                    >
                      {entry.name}
                    </span>
                    <span className="shrink-0 text-[10px] text-zinc-400 dark:text-zinc-500">
                      指数 {entry.index}
                    </span>
                    <span
                      className={cn(
                        CHIP_BASE,
                        "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400",
                      )}
                      title="该竞品压制我方的关键词数"
                    >
                      压 {entry.pressuredCount} 词
                    </span>
                  </div>
                ))}
                {competitorEntries.length > 3 && (
                  <p className="px-3 pt-1 text-[10px] text-zinc-400 dark:text-zinc-500">
                    …还有 {competitorEntries.length - 3} 个竞品
                  </p>
                )}
              </div>
            </>
          )}
        </SummaryCard>
      </div>

      {/* 排名分布（全局，最新快照 × 全部商店） */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm mb-4">
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
            <LinkComponent to="/keywords" className={btnSmSecondary}>
              {trackedActive.length === 0 ? "去生成关键词" : "去排名页"}
            </LinkComponent>
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

      {/* 用户反馈（保持现状，置于页尾不强调） */}
      <div>
        <FeedbackThemesCard
          project={project}
          themes={feedbackThemes}
          LinkComponent={LinkComponent}
        />
      </div>
    </div>
  );
}
