import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { BriefSuggestion } from "@appilot-labs/appilot-core/ai/overview-brief";
import { useProject } from "../../stores/project";
import { OverviewContent } from "./OverviewContent";
import {
  aggregateCompetitorOverview,
  computeCompetitorAdvantage,
  submissionDraftRows,
} from "./overviewData";
import type {
  CompetitorAdvantage,
  CompetitorSummary,
  SubmissionDraftRow,
} from "./overviewData";

/**
 * 总览页（Electron 侧壳）：负责取数（IPC + zustand + 路由），渲染共享内容组件
 * `OverviewContent`（纯 props，Electron 与 DSH 客户端共用同一套 UI）。
 *
 * 取数接线（总览页）：
 * - release:list → releaseOverview（draft/submission）+ ②发布卡的文案状态上下文
 *   （当前候选 tag + 已发布 tag 集合，见 draftStatusCtx）+ releaseSince
 *   （PR 统计边界 = 最近一条真实发布）；
 * - 项目对象 project.storeSubmissionDrafts（projects:list 注入）→ ②发布卡
 *   drafts 行（submissionDraftRows 纯函数，状态由上面 ctx 判定）；
 * - overview:repoMetrics（新增能力①，需 GitHub 凭证）→ repoMetrics prop；
 * - competitors:overview → competitorSummary（④竞品概览）+ computeCompetitorAdvantage
 *   （能力②：占优商店/优势劣势词）→ competitorAdvantage prop。
 */
export function OverviewPage() {
  const { projects, currentProjectId, currentProductId, selectProduct, recordBriefAction } = useProject();
  const navigate = useNavigate();
  const project = projects.find((p) => p.id === currentProjectId);
  const product = project?.storeProducts?.find((item) => item.id === currentProductId) || project?.storeProducts?.[0] || null;
  const [releaseOverview, setReleaseOverview] = useState<{
    draft: { name: string | null; tag: string; publishedAt: string; commitCount: number } | null;
    submission: any | null;
  } | null>(null);
  // ② 发布卡（文案）状态上下文：当前候选 tag + 已发布 tag 集合（release:list 判定）。
  const [draftStatusCtx, setDraftStatusCtx] = useState<{
    currentTag: string | null;
    publishedTags: string[];
  }>({ currentTag: null, publishedTags: [] });
  // 能力① PR 统计边界（最近一次真实发布的 tag + ISO 时间；随 release 列表刷新）。
  const [releaseSince, setReleaseSince] = useState<{ iso: string | null; tag: string | null } | null>(null);
  const [ascInfo, setAscInfo] = useState<{ versions: any[]; builds: any[]; fetchedAt?: string } | null>(null);
  const [storeCurrentVersion, setStoreCurrentVersion] = useState<string | null>(null);
  const [competitorSummary, setCompetitorSummary] = useState<CompetitorSummary | null>(null);
  const [competitorAdvantage, setCompetitorAdvantage] = useState<CompetitorAdvantage | null>(null);
  const [repoMetrics, setRepoMetrics] = useState<{
    ok: boolean;
    pullsSince: number | null;
    issues: { open: number; closed: number } | null;
    sinceTag: string | null;
    sinceIso: string | null;
    error?: string;
  } | null>(null);
  // ①开发 的 GitHub 活跃数据（每日提交数，近 120 天，键 = 本地 YYYY-MM-DD）由
  // OverviewContent 的 activityData 消费；取数仍走 activity:commits（原
  // ProjectActivityCard 内部取数，现收编到阶段卡：≥4 周覆盖 → 格子图，近几天 → 柱状）。
  const [activityData, setActivityData] = useState<{
    commits: Record<string, number>;
    releases: { tag: string; publishedAt: string | null }[];
  } | null>(null);
  const [briefState, setBriefState] = useState<{
    status: "idle" | "loading" | "ready" | "error";
    suggestions: BriefSuggestion[];
    progress: { chars: number; phase: "reasoning" | "content" } | null;
    error: string;
  }>({ status: "idle", suggestions: [], progress: null, error: "" });

  // ② 发布卡：文案行（纯 props）＝ project.storeSubmissionDrafts × 状态上下文。
  // 直接派生自 project（store 重载即刷新），不额外 IPC。
  const drafts = useMemo<SubmissionDraftRow[]>(
    () =>
      submissionDraftRows((project as any)?.storeSubmissionDrafts, {
        currentTag: draftStatusCtx.currentTag,
        publishedTags: draftStatusCtx.publishedTags,
      }),
    [project, draftStatusCtx],
  );

  // release:list → releaseOverview / draftStatusCtx / releaseSince（一次取数三输出）。
  // 监听 data-changed(releases/projects)：新文案保存 / 发布推进后自动刷新。
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    const load = async () => {
      try {
        const result = await (window as any).appilot?.release?.list(project.id);
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
        // 状态判定上下文：已发布 = 真实发布（非 GitHub 草稿且有 publishedAt）。
        const publishedTags = (result?.releases || [])
          .filter((item: any) => item?.githubDraft !== true && item?.publishedAt)
          .map((item: any) => item?.tag || item?.name || null);
        setDraftStatusCtx({
          currentTag: latest?.tag || latest?.name || null,
          publishedTags,
        });
        setReleaseSince(releaseSinceFromResult(result));
      } catch {
        if (cancelled) return;
        setReleaseOverview(null);
        setDraftStatusCtx({ currentTag: null, publishedTags: [] });
        setReleaseSince(null);
      }
    };
    void load();
    const handler = (e: Event) => {
      const scope = (e as CustomEvent).detail;
      if (scope === "releases" || scope === "projects") void load();
    };
    window.addEventListener("appilot:data-changed", handler);
    return () => {
      cancelled = true;
      window.removeEventListener("appilot:data-changed", handler);
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

  // GitHub 活跃（每日提交数，键为本地 YYYY-MM-DD）：OverviewContent ①开发 卡消费。
  // 无 window.appilot（DSH 等宿主自行注入 activityData）→ 保持 null，组件侧隐藏活跃块。
  useEffect(() => {
    if (!project?.id) {
      setActivityData(null);
      return;
    }
    let cancelled = false;
    const pending: Promise<Record<string, number>> | undefined = (window as any).appilot?.activity?.commits(project.id);
    if (pending && typeof pending.then === "function") {
      pending
        .then((commits) => { if (!cancelled) setActivityData({ commits: commits || {}, releases: [] }); })
        .catch(() => { if (!cancelled) setActivityData(null); });
    } else {
      setActivityData(null);
    }
    return () => { cancelled = true; };
  }, [project?.id]);

  // 竞品概览 + 竞品优势（能力②）：项目 + 当前产品就绪时调 competitors:overview，
  // profiles 同时喂给 aggregateCompetitorOverview（④概览）与
  // computeCompetitorAdvantage（占优商店/优势劣势词，纯函数，见 overviewData）。
  // 失败/无数据 → null。范围切换时以 cancelled 丢弃过期响应；监听
  // appilot:data-changed（competitors/projects）自动刷新。
  useEffect(() => {
    if (!project?.id || !product?.id) {
      setCompetitorSummary(null);
      setCompetitorAdvantage(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const pending: Promise<any[]> | undefined = (window as any).appilot?.competitors?.overview(
          project.id!,
          product.id!,
        );
        if (!pending || typeof pending.then !== "function") {
          if (!cancelled) {
            setCompetitorSummary(null);
            setCompetitorAdvantage(null);
          }
          return;
        }
        const profiles = await pending;
        if (!cancelled) {
          setCompetitorSummary(aggregateCompetitorOverview(profiles || []));
          setCompetitorAdvantage(computeCompetitorAdvantage(profiles || []));
        }
      } catch {
        if (!cancelled) {
          setCompetitorSummary(null);
          setCompetitorAdvantage(null);
        }
      }
    };
    void load();
    const handler = (e: Event) => {
      const scope = (e as CustomEvent).detail;
      if (scope === "competitors" || scope === "projects") {
        void load();
      }
    };
    window.addEventListener("appilot:data-changed", handler);
    return () => {
      cancelled = true;
      window.removeEventListener("appilot:data-changed", handler);
    };
  }, [project?.id, product?.id]);

  // 能力① GitHub repo 指标（issues + 按时间窗 PR 数）：overview:repoMetrics。
  // 仅在 项目 + GitHub URL + GitHub 凭证 就绪时调用；失败/无凭证 → null（不阻塞总览）。
  // 统计边界 releaseSince 变化（新发布）时自动重取；监听 data-changed(releases) 刷新。
  useEffect(() => {
    const hasToken = Boolean(project?.hasGithubToken);
    const githubUrl = project?.repo?.githubUrl || null;
    if (!project?.id || !hasToken || !githubUrl) {
      setRepoMetrics(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const pending = (window as any).appilot?.overview?.repoMetrics?.(
          project.id,
          releaseSince && releaseSince.iso
            ? { sinceIso: releaseSince.iso, sinceTag: releaseSince.tag }
            : undefined,
        );
        if (!pending || typeof pending.then !== "function") {
          if (!cancelled) setRepoMetrics(null);
          return;
        }
        const result = await pending;
        if (!cancelled) setRepoMetrics(result ?? null);
      } catch {
        if (!cancelled) setRepoMetrics(null);
      }
    };
    void load();
    const handler = (e: Event) => {
      const scope = (e as CustomEvent).detail;
      if (scope === "releases" || scope === "projects") {
        void load();
      }
    };
    window.addEventListener("appilot:data-changed", handler);
    return () => {
      cancelled = true;
      window.removeEventListener("appilot:data-changed", handler);
    };
  }, [
    project?.id,
    project?.hasGithubToken,
    project?.repo?.githubUrl,
    releaseSince?.iso,
    releaseSince?.tag,
  ]);

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
            releaseOverview?.draft?.tag
              ? `/release?tag=${encodeURIComponent(releaseOverview.draft.tag)}`
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
    [project?.id, recordBriefAction, navigate, releaseOverview?.draft?.tag],
  );

  return (
    <OverviewContent
      project={project ?? null}
      product={product}
      releaseOverview={releaseOverview}
      ascInfo={ascInfo}
      storeCurrentVersion={storeCurrentVersion}
      activityData={activityData ?? undefined}
      drafts={drafts}
      repoMetrics={repoMetrics}
      competitorSummary={competitorSummary}
      competitorAdvantage={competitorAdvantage}
      competitorHref="/keywords"
      briefState={briefState}
      onSelectProduct={selectProduct}
      onOpenExternal={(url) => (window as any).appilot?.openExternal(url)}
      onRevealInFolder={(path) => (window as any).appilot?.revealInFolder?.(path)}
      onOpenSettings={(id) => navigate(`/projects/${id}/settings`)}
      onGenerateBrief={handleGenerateBrief}
      onBriefAction={handleBriefAction}
    />
  );
}

/** PR 统计边界：最近一条真实发布（GitHub 已发布或本地 git tag，排除 GitHub 草稿）。 */
function releaseSinceFromResult(result: any): { iso: string | null; tag: string | null } {
  const releases: any[] = Array.isArray(result?.releases) ? result.releases : [];
  const published = releases
    .filter((r: any) => r?.githubDraft !== true && r?.publishedAt)
    .sort((a: any, b: any) =>
      String(b.publishedAt).localeCompare(String(a.publishedAt)),
    );
  const top = published[0] || null;
  return top
    ? { iso: top.publishedAt, tag: top.tag || top.name || null }
    : { iso: null, tag: null };
}
