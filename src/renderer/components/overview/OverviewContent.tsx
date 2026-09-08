/**
 * OverviewPage 的共享内容组件（纯 props，无 Electron/zustand/路由依赖）。
 *
 * 两个宿主共用同一套 UI：
 * - Electron：OverviewPage 负责取数（IPC + zustand + 路由），把数据与回调传入；
 * - DSH 客户端：esbuild 打包本文件，数据来自 appilot_overview 工具结果
 *   （映射成 Project/StoreProduct 形状），回调为简单跳转/无操作。
 *
 * 布局（自上而下）：
 * 标题/产品选择 → 副驾驶简报（置顶宽条）
 * → 第一行：三张卡 md 三列（窄屏堆叠）：① 开发 → ② 发布 → ③ 上架
 * → 第二行：④ 竞品与表现独占一整行（宽卡，卡内 md 两栏分区）
 * → 排名分布（保留）→ 用户反馈（保持现状，置于页尾不强调）。
 *
 * 防重复约定（阶段内分工，避免同一数字并排出现两次）：
 * - GitHub ↗ 外部链接 + GitHub 凭证就绪/去设置只在 ①开发 标题行右侧（顶部）；
 *   repo 分支/工作区状态、GitHub 流量异常（trafficError）归 ①开发卡底（仓库侧，
 *   一行小字无分隔横线；提交 sha 不重复展示，已在上次提交指标副注/tooltip）。
 * - ①开发「指标卡优先」：四枚等宽小指标 = 自上次发布以来提交（draft.commitCount）
 *   / PR（repoMetrics.pullsSince）/ 开放 Issue（repoMetrics.issues.open）/
 *   上次提交（repo.headDate 只显示天粒度「今天/N 天」，完整时间在 tooltip；
 *   副注含 headSha 短值）。下方 GitHub 活跃为
 *   ProjectActivityCard 同款近 4 个月（120 天）热力图（activityHeatmap 纯函数，
 *   activityData.commits + 发布日黄框标注），横向铺满卡宽；无数据 → 「无活跃数据」。
 * - ②发布卡：每个「文案」（project.storeSubmissionDrafts 一条）一行、按 updatedAt
 *   倒序；顶部一句话小结「最新文案后又 +N 提交 · +M PR」（与 ① 同源同值，但以
 *   一句话而非指标卡呈现，避免视觉重复）只出现在 ②；语言进度 n/total 只在 ② 行内。
 * - ③上架：顶部版本不一致提示（商店已上架 vX ≠ 草稿目标 vY → 黄/红条）+ 一行式
 *   紧凑小格（横向 wrap，每格 title 说明）：商店当前版本 / 目标+审核状态
 *   （deriveVersionStatus）/ 最新构建状态与时间 / 商店评价（reviews:list 聚合的
 *   评分★与评论数，宿主未接线则不展示）/ App 商店 ↗（storeLinks[0]）/
 *   信息更新于（fetchedAt）。App Store 凭证就绪/去设置只在 ③标题行右侧
 *   （与 ① GitHub 凭证位置风格一致）。不放关键词/竞品。
 * - ④竞品与表现（整行宽卡，卡内分区分层阅读）：顶部并排「关键词表现」与「竞品
 *   概况」（后者为一行等宽小指标，与 ① MiniMetric 同款）→ 中部 TOP3（名次+名称+
 *   指数+压 n 词）与「我方占优商店」（领先 n/m 竞品列表，最多展示 3 个、超出显示
 *   +还有 N 个；能力② computeCompetitorAdvantage 产物）→ 下部
 *   优势/劣势关键词两栏对比（chip 只显示词名，领先/被压计数进 title）；
 *   无竞品 → 「尚未查看竞品」。
 *
 * 竞品数据由宿主经 props（competitorSummary/competitorAdvantage/competitorHref）
 * 注入，repo 指标经 repoMetrics、② 文案行经 drafts、GitHub 活跃经 activityData
 * 注入；DSH 缺数据传 null/空即可（本组件不调用 window）。
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
import { AppleIcon } from "../ui/Icons";
import { EmptyState } from "../ui/EmptyState";
import { StatusChip } from "../ui/StatusChip";
import { btnSmPrimary, btnSmSecondary } from "../ui/styles";
import { FeedbackThemesCard } from "./FeedbackThemesCard";
import { activityHeatmap, overviewRankRows } from "./overviewData";
import type {
  CompetitorAdvantage,
  CompetitorSummary,
  SubmissionDraftRow,
  SubmissionDraftStatus,
} from "./overviewData";
import type { Project, RankSnapshot, StoreProduct } from "../../stores/project";

/** Link 注入点：Electron 用 react-router Link；DSH 传自己的轻量实现。 */
export type OverviewLink = ComponentType<{
  to: string;
  className?: string;
  children?: ReactNode;
  [key: string]: any;
}>;

/** 能力①：GitHub repo 指标（overview:repoMetrics 结果；null 表示未取数/失败）。 */
export interface OverviewRepoMetrics {
  ok: boolean;
  /** 自上次发布以来新建的 PR 数；null = 子指标失败（降级）。 */
  pullsSince: number | null;
  issues: { open: number; closed: number } | null;
  /** pullsSince 的统计边界 tag（无发布历史时为 null → 显示为当前 open PR 数）。 */
  sinceTag: string | null;
  sinceIso: string | null;
  error?: string;
}

/** ③上架的商店评价摘要（宿主经 reviews:list 聚合；recent30 = 近 30 天新增评论数）。 */
export interface StoreReviewSummary {
  total: number;
  average: number | null;
  recent30: number;
  /** 任一商店最近一次评论同步时间（ISO；无 → null）。 */
  lastSyncedAt: string | null;
}

export interface OverviewContentProps {
  project: Project | null;
  product: StoreProduct | null;
  releaseOverview: {
    draft: { name: string | null; tag: string; publishedAt: string; commitCount: number } | null;
    submission: any | null;
  } | null;
  ascInfo: { versions: any[]; builds: any[]; fetchedAt?: string } | null;
  storeCurrentVersion: string | null;
  /** 可选注入：项目活跃数据（每日提交数 + 发布日），供 ①开发 的近 4 个月热力图使用；缺省则只显示 repo 状态。 */
  activityData?: { commits: Record<string, number>; releases: { tag: string; publishedAt: string | null }[] };
  /** 可选注入：③上架的商店评价摘要（评分★/评论数）。undefined = 宿主未接线 → 不展示该格；null = 已接线但无数据。 */
  storeReviews?: StoreReviewSummary | null;
  /** 可选注入：②发布卡按时间倒序的「文案」行（宿主从 project.storeSubmissionDrafts 聚合）；空 → 空态。 */
  drafts?: SubmissionDraftRow[];
  /** 可选注入：①开发卡 repo 指标（能力①：PR + issues）；null/未取数 → 不展示。 */
  repoMetrics?: OverviewRepoMetrics | null;
  /** 可选注入：用户反馈聚类主题，供 FeedbackThemesCard 使用；缺省卡片内部取数。 */
  feedbackThemes?: FeedbackTheme[];
  /** 可选注入：竞品概览聚合（Electron 宿主从 competitors:overview 聚合）；DSH 等无竞品数据宿主不传/null。 */
  competitorSummary?: CompetitorSummary | null;
  /** 可选注入：竞品优势聚合（能力②，computeCompetitorAdvantage 的产物）。 */
  competitorAdvantage?: CompetitorAdvantage | null;
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

/** ②发布卡行状态 chip（当前/已发布/草案）。 */
const DRAFT_STATUS_META: Record<
  SubmissionDraftStatus,
  { label: string; tone: "muted" | "amber" | "emerald" }
> = {
  current: { label: "当前", tone: "amber" },
  published: { label: "已发布", tone: "emerald" },
  draft: { label: "草案", tone: "muted" },
};

/**
 * 提交数 → 热力图格色阶（与旧 ProjectActivityCard 同款 GitHub 绿，原样沿用）。
 * count = 0 灰；1–5/6–20/21–50/50+ 四档加深。
 */
function commitTierClass(count: number): string {
  if (count === 0) return "bg-zinc-100 dark:bg-zinc-800";
  if (count <= 5) return "bg-emerald-200 dark:bg-emerald-900";
  if (count <= 20) return "bg-emerald-400 dark:bg-emerald-700";
  if (count <= 50) return "bg-emerald-600 dark:bg-emerald-500";
  return "bg-emerald-800 dark:bg-emerald-300";
}

/** ①开发卡里的等宽小指标（MetricBlock 的紧凑非链接版，等宽三列用）。 */
function MiniMetric({
  label,
  value,
  sub,
  muted,
  title,
}: {
  label: string;
  value: string;
  sub?: string;
  muted?: boolean;
  title?: string;
}) {
  return (
    <div
      title={title}
      className={cn(
        "min-w-0 rounded-xl border px-2 py-2",
        muted
          ? "border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-800/30"
          : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm",
      )}
    >
      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 truncate text-xl font-mono font-semibold leading-none",
          muted
            ? "text-zinc-400 dark:text-zinc-500"
            : "text-zinc-900 dark:text-zinc-100",
        )}
      >
        {value}
      </p>
      {sub && (
        <p
          className="mt-1 truncate text-[10px] text-zinc-400 dark:text-zinc-500"
          title={sub}
        >
          {sub}
        </p>
      )}
    </div>
  );
}

/** ③上架卡的一行式小格：灰底小格 = 标签 + 内容（放不下给 title/tooltip）。 */
function FactCell({
  label,
  title,
  children,
}: {
  label: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div
      title={title}
      className="min-w-0 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-800/30 px-2.5 py-1.5"
    >
      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        {label}
      </p>
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        {children}
      </div>
    </div>
  );
}

/** 去发布页的深链（有 tag 按 tag；无 tag 回退整卡 CTA 地址）。 */
function releaseDraftDeepLink(tag: string | null | undefined, fallback: string): string {
  return tag ? `/release?tag=${encodeURIComponent(tag)}` : fallback;
}

/** 与旧 ProjectActivityCard 相同的「按天」相对时间：今天/昨天/N 天前/N 个月前。 */
function dayTimeLabel(day: string): string {
  const diff = Date.now() - new Date(`${day}T23:59:59`).getTime();
  const hours = Math.floor(diff / (60 * 60 * 1000));
  if (hours <= 0) return "今天";
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "昨天";
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  return `${months} 个月前`;
}

/** 「上次提交」指标值：只显示天粒度（当天 → 今天，更早 → N 天），避免长文案
 *  挤掉数值；完整时间由调用方放入 title tooltip。 */
function commitAgeLabel(iso: string): string {
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return "—";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTargetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const dayDiff = Math.round(
    (startOfToday.getTime() - startOfTargetDay.getTime()) / 86_400_000,
  );
  if (dayDiff <= 0) return "今天";
  return `${dayDiff} 天`;
}

/**
 * ①开发卡的 GitHub 活跃热力图——旧 ProjectActivityCard 的格子图实现「原样迁移」：
 * - activityData.commits（近 120 天 git log）→ 近 4 个月热力图：统计窗口自周一起
 *   的整周列排布（今天之前的对齐填充/未来格不可见），横向铺满卡宽（列数固定，
 *   每格 aspect-square 自适应），颜色按当日提交数深浅；
 * - releases（宿主 release 数据，带 publishedAt）→ 命中发布的日期黄框标注
 *   （与旧版一致：ring-amber 描边）；
 * - 无提交键 → 「无活跃数据」。数据侧为纯函数 activityHeatmap（overviewData，可测）。
 */
function GitHubActivityBlock({
  commits,
  releases,
}: {
  commits?: Record<string, number>;
  releases?: { tag: string; publishedAt: string | null }[];
}) {
  const heat = activityHeatmap(commits, releases);
  if (!heat) {
    return (
      <div className="min-w-0">
        <p className={STAGE_LABEL}>GitHub 活跃</p>
        <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">无活跃数据</p>
      </div>
    );
  }
  const columnCount = heat.weeks.length;
  const monthLabels: { col: number; text: string }[] = [];
  let lastMonth = -1;
  heat.weeks.forEach((week, col) => {
    for (const day of week.days) {
      if (day.preRange) continue;
      const month = Number(day.date.slice(5, 7));
      if (month !== lastMonth) {
        monthLabels.push({ col, text: `${month}月` });
        lastMonth = month;
      }
    }
  });
  return (
    <div className="min-w-0">
      <p className={STAGE_LABEL}>GitHub 活跃 · 近 4 个月</p>
      <div className="mt-2 w-full">
        {/* 月份标签：锚在对应周列起点，横向随网格自适应。 */}
        <div className="relative mb-0.5 h-3.5 w-full">
          {monthLabels.map((label) => (
            <span
              key={`${label.text}-${label.col}`}
              className="absolute text-[9px] leading-none text-zinc-400 dark:text-zinc-500"
              style={{ left: `${(label.col / columnCount) * 100}%` }}
            >
              {label.text}
            </span>
          ))}
        </div>
        <div className="flex w-full gap-[3px]">
          {heat.weeks.map((week) => (
            <div key={week.weekStart} className="flex min-w-0 flex-1 flex-col gap-[3px]">
              {week.days.map((day) => (
                <div
                  key={day.date}
                  className={cn(
                    "w-full rounded-[2px]",
                    day.preRange || day.future ? "invisible" : commitTierClass(day.count),
                    day.releaseTag &&
                      !day.preRange &&
                      !day.future &&
                      "ring-1 ring-amber-400 ring-offset-1 ring-offset-white dark:ring-offset-zinc-900",
                  )}
                  style={{ aspectRatio: "1 / 1" }}
                  title={
                    day.preRange || day.future
                      ? undefined
                      : `${day.date} · ${day.count} 次提交` +
                        (day.releaseTag ? ` · released ${day.releaseTag}` : "")
                  }
                />
              ))}
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="inline-flex items-center gap-1">
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500">少</span>
            {[0, 3, 12, 35, 60].map((n) => (
              <span key={n} className={cn("h-2 w-2 rounded-[2px]", commitTierClass(n))} />
            ))}
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500">多</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-[2px] ring-1 ring-amber-400 ring-offset-1 ring-offset-white dark:ring-offset-zinc-900 bg-zinc-100 dark:bg-zinc-800" />
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500">发布</span>
          </span>
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500 whitespace-nowrap">
            {heat.total} 次提交
            {heat.releaseCount > 0 ? ` · ${heat.releaseCount} 个发布日` : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

/** 四阶段卡的统一外壳：阶段序号 + 名称 + 单行导语 + 可选头部 CTA + 主体。 */
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

/** ASC 构建处理状态的展示色。 */
function buildTone(state: string | null): "emerald" | "amber" | "red" | "muted" {
  const upper = String(state || "").toUpperCase();
  if (upper === "VALID") return "emerald";
  if (upper === "PROCESSING" || upper === "UPLOADING") return "amber";
  if (upper === "INVALID" || upper === "FAILED" || upper === "REJECTED") return "red";
  return "muted";
}

/** 版本号数值比较（忽略前导 v/大小写；非纯数字段按 0 计），用于商店 vs 草稿版本提示。 */
function compareVersion(a: string, b: string): number {
  const pa = String(a).trim().replace(/^[vV]/, "").split(".");
  const pb = String(b).trim().replace(/^[vV]/, "").split(".");
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i += 1) {
    const na = Number(pa[i]) || 0;
    const nb = Number(pb[i]) || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

export function OverviewContent(props: OverviewContentProps) {
  const {
    project,
    product,
    releaseOverview,
    ascInfo,
    storeCurrentVersion,
    activityData,
    storeReviews,
    drafts,
    repoMetrics,
    feedbackThemes,
    competitorSummary,
    competitorAdvantage,
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

  // ── 版本/文案数据（②③ 共用基础）──
  const repoGithubUrl = project.repo?.githubUrl || null;
  const releaseDraft = releaseOverview?.draft ?? null;
  const submissionDraft = releaseOverview?.submission ?? null;
  const submissionLanguages = submissionDraft ? localizationList(submissionDraft) : [];
  const generatedLanguageCount = submissionLanguages.filter((loc: any) =>
    [loc.name, loc.subtitle, loc.promotionalText, loc.description, loc.whatsNew, loc.keywords]
      .some((value) => value && String(value).trim()),
  ).length;
  const languageTotal = languages.length || submissionLanguages.length;
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
  const releaseCardTo = releaseDraft?.tag
    ? `/release?tag=${encodeURIComponent(releaseDraft.tag)}`
    : "/release";

  // ── ① 开发：四枚等宽小指标（自上次发布以来提交/PR + 开放 Issue + 上次提交）──
  const pendingCommits = releaseDraft ? releaseDraft.commitCount : null;
  const repoPulls = repoMetrics?.ok ? repoMetrics.pullsSince : null;
  const repoIssues = repoMetrics?.ok ? repoMetrics.issues : null;
  const repoSinceTag = repoMetrics?.ok ? repoMetrics.sinceTag : null;
  const repoMetricError = repoMetrics && !repoMetrics.ok ? repoMetrics.error ?? null : null;
  // 上次提交：repo HEAD（本地仓库快照：headDate + headSha）优先；无仓库快照时
  // 用活跃热力图的最近活跃日兜底（旧 ProjectActivityCard 同款按天相对时间）。
  const repoHeadSha = project.repo?.headSha || null;
  const repoHeadDate = project.repo?.headDate || null;
  const lastActivityDay = (() => {
    const heat = activityHeatmap(activityData?.commits, activityData?.releases);
    return heat ? heat.lastCommitDay : null;
  })();
  const lastCommitIso = repoHeadDate || (lastActivityDay ? `${lastActivityDay}T23:59:59` : null);
  const lastCommitSub = repoHeadSha
    ? repoHeadSha.slice(0, 7)
    : lastActivityDay
      ? `活跃于 ${dayTimeLabel(lastActivityDay)}`
      : null;

  // ── ② 发布：文案行（宿主聚合，按 updatedAt 倒序）+ 顶部一句话小结 ──
  const draftRows: SubmissionDraftRow[] = Array.isArray(drafts) ? drafts : [];
  // 小结与 ①「自上次发布以来提交/PR」同源同值，这里以一句话（非指标卡）呈现，
  // 避免两个数字并排重复：最新文案行之上的「距上次发布后又 +N 提交 · +M PR」。
  const latestCopyNote = (() => {
    if (draftRows.length === 0 || !releaseDraft) return null;
    const parts: string[] = [];
    if (pendingCommits && pendingCommits > 0) parts.push(`+${pendingCommits} 提交`);
    if (repoPulls && repoPulls > 0) parts.push(`+${repoPulls} PR`);
    if (parts.length === 0) return null;
    return `最新文案后又 ${parts.join(" · ")}`;
  })();

  // ── ③ 上架：版本不一致提示 + 一行式（商店版本/目标审核/构建/评价/商店链接/更新于）──
  const liveStoreVersion = storeCurrentVersion || storeLiveVersion || null;
  const targetVersion = submissionDraft?.appVersion || null;
  const storeUnconfigured = !product.trackId && storeLinks.length === 0;
  const latestBuild = (ascInfo?.builds || [])
    .slice()
    .sort((a: any, b: any) =>
      String(b.uploadedDate || "").localeCompare(String(a.uploadedDate || "")),
    )[0] as { version?: string; processingState?: string; uploadedDate?: string | null } | undefined;
  // 目标版本在 ASC 里的版本对象（状态 + 创建时间，title 说明用，不虚造「提审时间」）。
  const targetAscVersion = targetVersion
    ? (ascInfo?.versions || []).find(
        (v: any) => String(v.versionString || "").trim() === targetVersion,
      ) || null
    : null;
  // 商店当前版本 ≠ 草稿目标版本 → 提示条（目标比商店旧则红，否则黄）。
  const versionMismatch = (() => {
    if (!liveStoreVersion || !targetVersion) return null;
    const live = String(liveStoreVersion).trim();
    const target = String(targetVersion).trim();
    if (!live || !target || compareVersion(live, target) === 0) return null;
    return { live, target, downgrade: compareVersion(target, live) < 0 };
  })();

  // ── ④ 竞品与表现（整行宽卡）：关键词表现 + 竞品压制面 + 能力②聚合 ──
  const competitorEntries = competitorSummary?.top ?? [];
  const pressuredTotal = competitorEntries.reduce(
    (sum, item) => sum + (Number(item.pressuredCount) || 0),
    0,
  );
  const competitorTrackedTotal = competitorSummary?.totalTracked ?? competitorEntries.length;
  const gainedEvents = competitorSummary?.gained ?? 0;
  const droppedEvents = competitorSummary?.dropped ?? 0;
  const staleCompetitors = competitorSummary?.stale ?? 0;
  const advantage = competitorAdvantage && competitorAdvantage.hasData ? competitorAdvantage : null;
  const dominantStorefrontsTotal = advantage?.dominantStorefronts.length ?? 0;
  const dominantStorefronts = advantage?.dominantStorefronts.slice(0, 3) ?? [];
  const advantageWords = advantage?.advantageKeywords.slice(0, 3) ?? [];
  const disadvantageWords = advantage?.disadvantageKeywords.slice(0, 3) ?? [];
  const translationFor = (language: string, keyword: string): string | null => {
    const match = trackedActive.find(
      (k: any) => k.language === language && k.keyword === keyword,
    );
    return (match as any)?.translation || null;
  };

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

  const hasCompetitorData = Boolean(competitorSummary) && competitorEntries.length > 0;

  // ④ 顶部「关键词表现」状态条（TOP10 词数 / 最好名次 / 采集新鲜度 三格并排，
  // 一眼总数）——与竞品有无数据无关，无竞品空态也展示。
  const keywordPerformanceBlock = (
    <div className="min-w-0">
      <p className={STAGE_LABEL}>关键词表现</p>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <div
          className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800 px-2 py-1.5 min-w-0"
          title={trackedActive.length > 0 ? `共跟踪 ${trackedActive.length} 个关键词` : "尚未跟踪关键词"}
        >
          <p className="truncate text-[10px] text-zinc-400 dark:text-zinc-500">TOP10 词数</p>
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
          <p className="mt-0.5 truncate text-[10px] text-zinc-400 dark:text-zinc-500">
            {trackedActive.length === 0 ? "未跟踪关键词" : `共 ${trackedActive.length} 词`}
          </p>
        </div>
        <div
          className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800 px-2 py-1.5 min-w-0"
          title={
            bestRankRow
              ? `#${bestRankRow.bestRank} ${bestRankRow.keyword} · ${storefrontDisplayName(bestRankRow.storefront)}`
              : undefined
          }
        >
          <p className="truncate text-[10px] text-zinc-400 dark:text-zinc-500">最好名次</p>
          <p
            className={cn(
              "mt-0.5 text-lg font-semibold leading-tight truncate",
              bestRankRow ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-400 dark:text-zinc-500",
            )}
          >
            {bestRankRow ? `#${bestRankRow.bestRank}` : "—"}
          </p>
          <p className="mt-0.5 truncate text-[10px] text-zinc-400 dark:text-zinc-500">
            {bestRankRow
              ? `${bestRankRow.keyword} · ${storefrontDisplayName(bestRankRow.storefront)}`
              : trackedActive.length === 0
                ? "未跟踪关键词"
                : "暂无上榜记录"}
          </p>
        </div>
        <div
          className={cn(
            "rounded-lg border px-2 py-1.5 min-w-0",
            dataStale
              ? "bg-red-50 dark:bg-red-500/10 border-red-100 dark:border-red-500/20"
              : "bg-zinc-50 dark:bg-zinc-800/50 border-zinc-100 dark:border-zinc-800",
          )}
          title={newestCheckedAt ? `最近一次排名采集 ${newestCheckedAt}` : undefined}
        >
          <p className="truncate text-[10px] text-zinc-400 dark:text-zinc-500">采集新鲜度</p>
          <p
            className={cn(
              "mt-0.5 text-lg font-semibold leading-tight truncate",
              newestCheckedAt
                ? dataStale
                  ? "text-red-600 dark:text-red-400"
                  : "text-zinc-900 dark:text-zinc-100"
                : "text-zinc-400 dark:text-zinc-500",
            )}
            title={newestCheckedAt ? `上次采集 ${formatHumanTime(newestCheckedAt)}` : undefined}
          >
            {newestCheckedAt
              ? formatHumanTime(newestCheckedAt)
              : trackedActive.length === 0
                ? "—"
                : "等待首采"}
          </p>
          <p
            className={cn(
              "mt-0.5 truncate text-[10px]",
              dataStale ? "text-red-500 dark:text-red-400" : "text-zinc-400 dark:text-zinc-500",
            )}
          >
            {newestCheckedAt
              ? dataStale
                ? "数据过期"
                : "数据截至"
              : trackedActive.length === 0
                ? "未跟踪关键词"
                : "等待首次采集"}
          </p>
        </div>
      </div>
    </div>
  );

  // ④ 顶部「竞品概况」指标条（与 ① 开发卡 MiniMetric 同款等宽小指标：一行五格，
  // 每格数值 + 小标签 + title tooltip；零值灰显，保持一行等宽排布）。
  const competitorOverviewBlock = (
    <div className="min-w-0">
      <p className={STAGE_LABEL}>竞品概况</p>
      <div className="mt-2 grid grid-cols-5 gap-1.5 min-w-0">
        <MiniMetric
          label="跟踪"
          value={String(competitorTrackedTotal)}
          muted={competitorTrackedTotal === 0}
          title="当前跟踪的竞品总数（TOP3 竞品按指数降序展示）"
        />
        <MiniMetric
          label="压我方词"
          value={String(pressuredTotal)}
          muted={pressuredTotal === 0}
          title="竞品压制我方词数合计（竞品 ≤200 且领先或我方未进榜）"
        />
        <MiniMetric
          label="新上榜"
          value={gainedEvents > 0 ? `+${gainedEvents}` : "0"}
          muted={gainedEvents === 0}
          title={`竞品词新进榜（≤200）的事件计数${gainedEvents === 0 ? "（0 = 近期无新上榜）" : ""}`}
        />
        <MiniMetric
          label="跌出"
          value={String(droppedEvents)}
          muted={droppedEvents === 0}
          title={`竞品词跌出榜单的事件计数${droppedEvents === 0 ? "（0 = 近期无跌出）" : ""}`}
        />
        <MiniMetric
          label="停滞"
          value={String(staleCompetitors)}
          muted={staleCompetitors === 0}
          title="排名停滞/长期未刷新的竞品数（宿主未提供快照时间信号时为 0）"
        />
      </div>
    </div>
  );

  const advantageWordsTotal = advantage?.advantageKeywords.length ?? 0;
  const disadvantageWordsTotal = advantage?.disadvantageKeywords.length ?? 0;

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

      {/* 第一行：三张卡（① 开发 / ② 发布 / ③ 上架；md 三列，窄屏堆叠） */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        {/* ① 开发：四指标 + GitHub 活跃热力图 + repo 状态（卡底） */}
        <StageCard
          step="1"
          stepClass="bg-sky-50 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400"
          title="开发"
          lead="上次发布以来提交/PR、Issue 与近 4 个月活跃"
          right={
            repoGithubUrl || project.hasGithubToken ? (
              <div className="flex shrink-0 items-center gap-1.5 min-w-0">
                {repoGithubUrl && (
                  <button
                    onClick={() => onOpenExternal(repoGithubUrl)}
                    className="shrink-0 text-[11px] font-medium text-amber-600 dark:text-amber-400 hover:underline"
                    title="打开 GitHub 仓库"
                  >
                    GitHub ↗
                  </button>
                )}
                {project.hasGithubToken ? (
                  <span
                    className="inline-flex shrink-0 items-center rounded-full bg-emerald-50 dark:bg-emerald-500/10 px-2 h-5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400"
                    title={
                      project.githubSource
                        ? `GitHub 凭证已配置（${project.githubSource === "global" ? "全局" : "项目覆盖"}），用于 PR/Issue/私有发布统计`
                        : "GitHub 凭证已配置，用于 PR/Issue/私有发布统计"
                    }
                  >
                    凭证就绪
                  </span>
                ) : (
                  <button
                    onClick={() => onOpenSettings(project.id)}
                    className="shrink-0 rounded-full border border-dashed border-zinc-300 dark:border-zinc-600 px-2 h-5 text-[10px] font-medium text-zinc-400 dark:text-zinc-500 hover:border-amber-500/60 hover:text-amber-600 dark:hover:text-amber-400"
                    title="未配置 GitHub 凭证（配置后可展示 PR/Issue 与私有/草案发布统计）"
                  >
                    去设置
                  </button>
                )}
              </div>
            ) : undefined
          }
        >
          <div className="flex h-full flex-col gap-3 min-w-0">
            {/* 指标卡：提交 / PR / 开放 Issue / 上次提交（等宽四列） */}
            <div className="grid grid-cols-4 gap-1.5 min-w-0">
              <MiniMetric
                label="提交"
                value={pendingCommits != null ? String(pendingCommits) : "—"}
                sub="发布以来"
                muted={pendingCommits == null}
                title={
                  pendingCommits != null
                    ? `自上次发布（${releaseDraft?.tag || "当前候选"}）以来收集的提交数`
                    : "暂无发布素材（生成文案后统计）"
                }
              />
              <MiniMetric
                label="PR"
                value={repoPulls != null ? String(repoPulls) : "—"}
                sub={repoSinceTag ? `自 ${repoSinceTag}` : repoPulls != null ? "当前 open" : undefined}
                muted={repoPulls == null}
                title={
                  repoPulls != null && repoSinceTag
                    ? `自 ${repoSinceTag} 发布后新建的 PR`
                    : repoPulls != null
                      ? "GitHub 当前 open PR 数（无发布历史边界）"
                      : "配置 GitHub 凭证后展示"
                }
              />
              <MiniMetric
                label="开放 Issue"
                value={repoIssues != null ? String(repoIssues.open) : "—"}
                sub={repoIssues ? `closed ${repoIssues.closed}` : undefined}
                muted={repoIssues == null || (repoIssues && repoIssues.open === 0 && repoIssues.closed === 0)}
                title={
                  repoIssues != null
                    ? `GitHub Issue：open ${repoIssues.open} · closed ${repoIssues.closed}`
                    : "配置 GitHub 凭证后展示"
                }
              />
              <MiniMetric
                label="上次提交"
                value={lastCommitIso ? commitAgeLabel(lastCommitIso) : "—"}
                sub={lastCommitSub ?? undefined}
                muted={lastCommitIso == null}
                title={
                  lastCommitIso
                    ? repoHeadDate
                      ? `HEAD 提交于 ${repoHeadDate}${repoHeadSha ? ` · ${repoHeadSha.slice(0, 7)}` : ""}（${formatHumanTime(lastCommitIso)}）`
                      : lastActivityDay
                        ? `最近活跃日 ${lastActivityDay}（${formatHumanTime(lastCommitIso)}）`
                        : formatHumanTime(lastCommitIso)
                    : "暂无提交记录（配置本地仓库后展示）"
                }
              />
            </div>

            {/* GitHub 活跃：近 4 个月热力图（旧 ProjectActivityCard 原样迁移），无数据 → 空态 */}
            <GitHubActivityBlock
              commits={activityData?.commits}
              releases={activityData?.releases}
            />

            {/* repo 分支/工作区（卡底一行小字，无分隔横线；sha 已在上次提交指标
                副注/tooltip，GitHub 凭证就绪/去设置已在标题行右侧，避免重复） */}
            <div className="mt-auto space-y-1 min-w-0">
              {project.repo ? (
                <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                  <span
                    className="min-w-0 font-mono text-[11px] text-zinc-700 dark:text-zinc-300 truncate"
                    title={
                      project.repo.headMessage ||
                      project.repo.remoteUrl ||
                      project.localPath
                    }
                  >
                    {project.repo.branch && project.repo.branch !== "HEAD"
                      ? project.repo.branch
                      : project.repo.remoteUrl || "—"}
                  </span>
                  {project.repo.dirty && <StatusChip label="工作区有改动" tone="amber" />}
                </div>
              ) : (
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                  未配置本地仓库路径
                </p>
              )}
              {repoMetricError && (
                <p
                  className="truncate text-[10px] text-red-500 dark:text-red-400"
                  title={repoMetricError}
                >
                  {repoMetricError}
                </p>
              )}
              {project.trafficError && (
                <p
                  className="truncate text-[11px] text-red-500 dark:text-red-400"
                  title={project.trafficError}
                >
                  流量采集异常：{project.trafficError}
                </p>
              )}
            </div>
          </div>
        </StageCard>

        {/* ② 发布：每个「文案」一条（更新时间倒序）+ 顶部一句话小结 */}
        <StageCard
          step="2"
          stepClass="bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400"
          title="发布"
          lead="文案与发布状态"
          right={
            <LinkComponent to={releaseCardTo} className={releaseDraft ? btnSmPrimary : btnSmSecondary}>
              去发布页
            </LinkComponent>
          }
        >
          <div className="space-y-2 min-w-0">
            {latestCopyNote && (
              <p
                className="text-[11px] font-medium text-amber-600 dark:text-amber-500"
                title="统计自最近发布/最新文案边界（与①同源）；提交数来自当前发布候选素材"
              >
                {latestCopyNote}
              </p>
            )}
            {draftRows.length > 0 ? (
              <ul className="min-w-0">
                {draftRows.slice(0, 5).map((row, index) => {
                  const meta = DRAFT_STATUS_META[row.status];
                  const rowTotal = Math.max(languageTotal, row.languageCount);
                  const linkTo = releaseDraftDeepLink(row.tag, releaseCardTo);
                  return (
                    <li
                      key={row.key}
                      className={cn(
                        index > 0 && "border-t border-zinc-100 dark:border-zinc-800",
                      )}
                    >
                      <LinkComponent
                        to={linkTo}
                        className="group flex items-center gap-2 py-1 min-w-0 rounded-md"
                        title={`去发布页查看 ${row.label}${row.tag ? `（${row.tag}）` : ""}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className={cn(
                                "truncate text-[12px] font-semibold",
                                row.status === "current"
                                  ? "text-amber-700 dark:text-amber-400"
                                  : "text-zinc-900 dark:text-zinc-100",
                              )}
                            >
                              {row.label}
                            </span>
                            {row.tag && row.tag !== row.label && (
                              <span className="shrink-0 font-mono text-[10px] text-zinc-400 dark:text-zinc-500 truncate">
                                {row.tag}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 flex-wrap min-w-0 text-[10px] text-zinc-400 dark:text-zinc-500">
                            <span>
                              {row.updatedAt
                                ? `更新于 ${formatHumanTime(row.updatedAt)}`
                                : "更新时间未知"}
                            </span>
                            {row.languageCount > 0 && rowTotal > 0 && (
                              <span
                                className={cn(
                                  row.languageCount >= rowTotal
                                    ? "text-zinc-500 dark:text-zinc-400"
                                    : "text-amber-600 dark:text-amber-500",
                                )}
                              >
                                {row.languageCount}/{rowTotal} 语言
                              </span>
                            )}
                          </div>
                        </div>
                        <StatusChip label={meta.label} tone={meta.tone} />
                        <span
                          aria-hidden="true"
                          className="shrink-0 text-[11px] text-zinc-300 dark:text-zinc-600 group-hover:text-amber-500 transition-colors"
                        >
                          →
                        </span>
                      </LinkComponent>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                暂无发布记录（有新提交或新 tag 后自动发现素材，可在发布页生成文案）
              </p>
            )}
            {draftRows.length > 5 && (
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
                …还有 {draftRows.length - 5} 条旧文案
              </p>
            )}
          </div>
        </StageCard>

        {/* ③ 上架：版本不一致提示 + 一行式紧凑小格（商店版本/目标审核/构建/评价/商店链接/更新于） */}
        <StageCard
          step="3"
          stepClass="bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          title="上架"
          lead="商店版本、审核、评价与构建"
          right={
            <div className="flex shrink-0 items-center gap-1.5 min-w-0">
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 h-5 text-[10px] font-medium text-zinc-600 dark:text-zinc-300"
                title={storeLinks[0] ? storeLinks[0].name : "iOS / macOS App Store"}
              >
                <AppleIcon className="w-3 h-3 text-current" />
                App Store
              </span>
              {ascConfigured ? (
                <span
                  className="inline-flex shrink-0 items-center rounded-full bg-emerald-50 dark:bg-emerald-500/10 px-2 h-5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400"
                  title={
                    project.ascSource
                      ? `App Store Connect 凭证已配置（${project.ascSource === "global" ? "全局" : "项目覆盖"}），用于版本/审核状态回读、评论洞察`
                      : "App Store Connect 凭证已配置，用于版本/审核状态回读、评论洞察"
                  }
                >
                  凭证就绪
                </span>
              ) : (
                <button
                  onClick={() => onOpenSettings(project.id)}
                  className="shrink-0 rounded-full border border-dashed border-zinc-300 dark:border-zinc-600 px-2 h-5 text-[10px] font-medium text-zinc-400 dark:text-zinc-500 hover:border-amber-500/60 hover:text-amber-600 dark:hover:text-amber-400"
                  title="未配置 App Store Connect 凭证（配置后可展示版本/构建/审核状态与评论洞察）"
                >
                  去设置
                </button>
              )}
            </div>
          }
        >
          <div className="flex h-full min-w-0 flex-col gap-2.5">
            {versionMismatch && (
              <div
                className={cn(
                  "flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug",
                  versionMismatch.downgrade
                    ? "border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400"
                    : "border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-500",
                )}
                title="商店当前上架版本与本地草稿目标版本不一致"
              >
                <span aria-hidden="true" className="shrink-0 leading-none">ⓘ</span>
                <span className="min-w-0">
                  商店已上架 v{versionMismatch.live}，草稿目标 v{versionMismatch.target}
                  {versionMismatch.downgrade ? "（目标低于当前版本，注意核对）" : "（尚未上架，待提审）"}
                </span>
              </div>
            )}

            <div className="flex min-w-0 flex-wrap items-stretch gap-1.5">
              <FactCell
                label="商店当前版本"
                title={liveStoreVersion ? `App Store 当前上架 v${liveStoreVersion}` : "尚未获取到商店版本（未配置或公开商店查询失败）"}
              >
                <span
                  className={cn(
                    "font-mono text-[12px]",
                    liveStoreVersion
                      ? "text-zinc-800 dark:text-zinc-200"
                      : "text-zinc-400 dark:text-zinc-500",
                  )}
                >
                  v{liveStoreVersion ?? "—"}
                </span>
              </FactCell>

              {targetVersion && effectiveVersionStatus && (
                <FactCell
                  label="目标 / 审核"
                  title={
                    `目标版本 v${targetVersion} · ${effectiveVersionStatus.label}` +
                    (targetAscVersion?.createdDate
                      ? ` · ASC 版本创建于 ${formatHumanTime(targetAscVersion.createdDate)}`
                      : "")
                  }
                >
                  <StatusChip label={effectiveVersionStatus.label} tone={effectiveVersionStatus.tone} />
                  <span className="font-mono text-[11px] text-zinc-600 dark:text-zinc-300">
                    v{targetVersion}
                  </span>
                </FactCell>
              )}

              {storeReviews !== undefined && (
                <FactCell
                  label="商店评价"
                  title={
                    storeReviews && storeReviews.total > 0
                      ? `App Store 客户评论：累计样本 ${storeReviews.total} 条 · 平均 ★${storeReviews.average ?? "—"} · 近 30 天 ${storeReviews.recent30} 条` +
                        (storeReviews.lastSyncedAt
                          ? ` · 同步于 ${formatHumanTime(storeReviews.lastSyncedAt)}`
                          : "")
                      : "尚未同步商店评论（去评论页同步后展示评分与评论数）"
                  }
                >
                  {storeReviews && storeReviews.total > 0 ? (
                    <>
                      <span className="text-[12px] font-semibold text-amber-600 dark:text-amber-400">
                        ★ {storeReviews.average ?? "—"}
                      </span>
                      <span className="text-[11px] text-zinc-600 dark:text-zinc-300">
                        {storeReviews.total} 条
                      </span>
                    </>
                  ) : (
                    <LinkComponent
                      to="/reviews"
                      className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline"
                      title="去评论页同步商店评论"
                    >
                      暂无评论 · 去评论页 ↗
                    </LinkComponent>
                  )}
                </FactCell>
              )}

              {ascConfigured && (
                <FactCell
                  label="最新构建"
                  title={
                    latestBuild
                      ? `最新构建 ${latestBuild.version || "?"} · ${latestBuild.processingState || "状态未知"}` +
                        (latestBuild.uploadedDate
                          ? ` · 上传于 ${formatHumanTime(latestBuild.uploadedDate)}`
                          : "")
                      : "ASC 尚未同步构建"
                  }
                >
                  {latestBuild ? (
                    <>
                      {latestBuild.version && (
                        <span className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
                          {latestBuild.version}
                        </span>
                      )}
                      {latestBuild.processingState && (
                        <StatusChip
                          label={latestBuild.processingState}
                          tone={buildTone(latestBuild.processingState)}
                        />
                      )}
                      <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                        {latestBuild.uploadedDate
                          ? formatHumanTime(latestBuild.uploadedDate)
                          : "状态待更新"}
                      </span>
                    </>
                  ) : (
                    <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                      ASC 未同步（构建/审核状态待刷新）
                    </span>
                  )}
                </FactCell>
              )}

              {storeLinks[0] && (
                <FactCell label="App 商店" title={storeLinks[0].name}>
                  <button
                    onClick={() => onOpenExternal(storeLinks[0].url)}
                    className="text-[11px] font-medium text-amber-600 dark:text-amber-400 hover:underline"
                    title={`${storeLinks[0].name}（打开商店页面）`}
                  >
                    查看商店 ↗
                  </button>
                </FactCell>
              )}

              {ascInfo?.fetchedAt && (
                <FactCell label="信息更新于" title="App Store Connect 数据（版本/构建）抓取时间">
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    {formatHumanTime(ascInfo.fetchedAt)}
                  </span>
                </FactCell>
              )}
            </div>

            {storeUnconfigured && !liveStoreVersion && !targetVersion && (
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                未配置商店/上架信息
              </p>
            )}
          </div>
        </StageCard>
      </div>

      {/* 第二行：④ 竞品与表现独占一整行（宽卡，卡内 md 两栏分区） */}
      <StageCard
        step="4"
        stepClass="bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400"
        title="竞品与表现"
        lead="关键词表现与竞品概况、TOP3 与占优商店、优势/劣势词"
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
        {hasCompetitorData ? (
          <div className="min-w-0 space-y-4">
            {/* 顶部：关键词表现 / 竞品概况 并排状态条（一眼总数） */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 min-w-0">
              {keywordPerformanceBlock}
              {competitorOverviewBlock}
            </div>

            {/* 中部：TOP3 竞品（列表式）| 我方占优商店（领先 n/m 列表） */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 border-t border-zinc-100 dark:border-zinc-800 pt-3.5 min-w-0">
              <div className="min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <p className={STAGE_LABEL}>TOP3 竞品</p>
                  {competitorEntries.length > 3 && (
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                      另有 {competitorEntries.length - 3} 个
                    </span>
                  )}
                </div>
                <ul className="mt-2 space-y-1 min-w-0">
                  {competitorEntries.slice(0, 3).map((entry, index) => (
                    <li key={`${entry.name}-${index}`} className="flex items-center gap-2 py-0.5 min-w-0">
                      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-violet-50 dark:bg-violet-500/10 text-[10px] font-semibold text-violet-600 dark:text-violet-400">
                        {index + 1}
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate text-[12px] font-medium text-zinc-800 dark:text-zinc-200"
                        title={entry.name}
                      >
                        {entry.name}
                      </span>
                      <span className="shrink-0 text-[10px] text-zinc-400 dark:text-zinc-500">
                        指数 {entry.index}
                      </span>
                      {entry.pressuredCount > 0 && (
                        <span
                          className={cn(CHIP_BASE, "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400")}
                          title="该竞品压制我方的关键词数"
                        >
                          压 {entry.pressuredCount} 词
                        </span>
                      )}
                    </li>
                  ))}
                  {competitorEntries.length === 0 && (
                    <li className="text-xs text-zinc-400 dark:text-zinc-500">暂无跟踪竞品</li>
                  )}
                </ul>
              </div>

              <div className="min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <p className={STAGE_LABEL}>我方占优商店</p>
                  {dominantStorefrontsTotal > dominantStorefronts.length && (
                    <span
                      className="shrink-0 text-[10px] text-zinc-400 dark:text-zinc-500"
                      title={`还有 ${dominantStorefrontsTotal - dominantStorefronts.length} 个占优商店：${(advantage?.dominantStorefronts ?? [])
                        .slice(3)
                        .map((s) => storefrontDisplayName(s.storefront))
                        .join("、")}`}
                    >
                      +还有 {dominantStorefrontsTotal - dominantStorefronts.length} 个
                    </span>
                  )}
                </div>
                {dominantStorefronts.length > 0 ? (
                  <ul className="mt-2 grid grid-cols-1 gap-1.5 min-w-0">
                    {dominantStorefronts.map((item) => (
                      <li
                        key={item.storefront}
                        className="flex items-center gap-2 rounded-lg border border-zinc-100 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-800/40 px-2.5 py-1.5 min-w-0"
                      >
                        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-zinc-800 dark:text-zinc-200">
                          {storefrontDisplayName(item.storefront)}
                        </span>
                        <span
                          className="shrink-0 font-mono text-[11px] font-semibold text-emerald-600 dark:text-emerald-400"
                          title={`领先 ${item.leading}/${item.compared} 个可比竞品（被压 ${item.trailing} 个）`}
                        >
                          领先 {item.leading}/{item.compared}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
                    暂无占优商店（该平台未见领先名次）
                  </p>
                )}
              </div>
            </div>

            {/* 下部：优势 / 劣势关键词 左右对比（悬停看领先/被压竞品数） */}
            {(advantageWords.length > 0 || disadvantageWords.length > 0) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 border-t border-zinc-100 dark:border-zinc-800 pt-3.5 min-w-0">
                {advantageWords.length > 0 && (
                  <div className="min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className={STAGE_LABEL}>优势关键词</p>
                      {advantageWordsTotal > advantageWords.length && (
                        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                          共 {advantageWordsTotal} 词
                        </span>
                      )}
                    </div>
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {advantageWords.map((word) => (
                        <li
                          key={`${word.language}-${word.keyword}`}
                          className={cn(CHIP_BASE, "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400")}
                          title={`${translationFor(word.language, word.keyword) ? `${translationFor(word.language, word.keyword)} · ` : ""}领先 ${word.wins}/${word.wins + word.losses} 个竞品 · 被压 ${word.losses} 个`}
                        >
                          {word.keyword}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {disadvantageWords.length > 0 && (
                  <div className="min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className={STAGE_LABEL}>劣势关键词</p>
                      {disadvantageWordsTotal > disadvantageWords.length && (
                        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                          共 {disadvantageWordsTotal} 词
                        </span>
                      )}
                    </div>
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {disadvantageWords.map((word) => (
                        <li
                          key={`${word.language}-${word.keyword}`}
                          className={cn(CHIP_BASE, "bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400")}
                          title={`${translationFor(word.language, word.keyword) ? `${translationFor(word.language, word.keyword)} · ` : ""}被压 ${word.losses}/${word.wins + word.losses} 个竞品 · 领先 ${word.wins} 个`}
                        >
                          {word.keyword}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 min-w-0">
            <div className="min-w-0">{keywordPerformanceBlock}</div>
            <div className="flex min-w-0 flex-col justify-center">
              <p className={STAGE_LABEL}>竞品</p>
              <p className="mt-1.5 text-xs text-zinc-400 dark:text-zinc-500">尚未查看竞品</p>
              {competitorHref ? (
                <LinkComponent
                  to={competitorHref}
                  className="mt-2 inline-block text-[11px] text-amber-600 dark:text-amber-400 hover:underline"
                >
                  去竞品页 →
                </LinkComponent>
              ) : (
                <span className="mt-2 block text-[11px] text-zinc-300 dark:text-zinc-600">
                  去竞品页
                </span>
              )}
            </div>
          </div>
        )}
      </StageCard>

      {/* 排名分布（全局，最新快照 × 全部商店） */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm mt-4 mb-4">
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
