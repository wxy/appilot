import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { BriefSuggestion } from "@appilot-labs/appilot-core/ai/overview-brief";
import { useProject } from "../../stores/project";
import { OverviewContent } from "./OverviewContent";

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
