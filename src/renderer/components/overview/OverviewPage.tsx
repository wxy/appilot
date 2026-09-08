import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { BriefSuggestion } from "@appilot-labs/appilot-core/ai/overview-brief";
import { useProject } from "../../stores/project";
import { OverviewContent } from "./OverviewContent";
import { aggregateCompetitorOverview } from "./overviewData";
import type { CompetitorSummary } from "./overviewData";

/**
 * 总览页（Electron 侧壳）：负责取数（IPC + zustand + 路由），渲染共享内容组件
 * `OverviewContent`（纯 props，Electron 与 DSH 客户端共用同一套 UI）。
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
  const [ascInfo, setAscInfo] = useState<{ versions: any[]; builds: any[]; fetchedAt?: string } | null>(null);
  const [storeCurrentVersion, setStoreCurrentVersion] = useState<string | null>(null);
  const [competitorSummary, setCompetitorSummary] = useState<CompetitorSummary | null>(null);
  // ①开发 的 GitHub 活跃数据（近 7 天提交）由 OverviewContent 的 activityData 消费；
  // 取数仍走 activity:commits（原 ProjectActivityCard 内部取数，现收编到阶段卡）。
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

  // 竞品概览（OverviewContent「竞品概览」卡）：项目 + 当前产品就绪时调
  // competitors:overview 并聚合成 CompetitorSummary（纯函数，见 overviewData）；
  // 失败/无数据 → null。范围切换时以 cancelled 丢弃过期响应；监听
  // appilot:data-changed（competitors/projects）自动刷新。
  useEffect(() => {
    if (!project?.id || !product?.id) {
      setCompetitorSummary(null);
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
          if (!cancelled) setCompetitorSummary(null);
          return;
        }
        const profiles = await pending;
        if (!cancelled) setCompetitorSummary(aggregateCompetitorOverview(profiles || []));
      } catch {
        if (!cancelled) setCompetitorSummary(null);
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
      competitorSummary={competitorSummary}
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
