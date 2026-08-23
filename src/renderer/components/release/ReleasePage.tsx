import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useProject } from "../../stores/project";
import { cn } from "../../lib/utils";
import {
  formatHumanTime,
  formatKilo,
  languageLabel,
  platformLabel,
  UI_SOURCE_LANGUAGE,
} from "../../lib/format";
import { localizationList } from "../../lib/release-localization";
import { STORE_STATUS_META } from "../../lib/store-status";
import {
  CHANGE_TYPE_META,
  summarizeChanges,
  type ChangeSummaryItem,
} from "../../lib/release-summary";
import { AIProgressButton } from "../ui/AIProgressButton";
import { CredentialBadge } from "../ui/CredentialBadge";
import { EmptyState } from "../ui/EmptyState";
import { FieldBlock, FieldHeader } from "../ui/Fields";
import { GithubIcon } from "../ui/Icons";
import { StatusChip } from "../ui/StatusChip";
import {
  btnPrimary,
  btnSmSecondary,
  inputClass,
  inputLineClass,
} from "../ui/styles";
import { HistoryPanel } from "./HistoryPanel";
import { HistoryViewer } from "./HistoryViewer";
import { ReferenceSection } from "./ReferenceSection";
import { draftVersionLabel } from "./releaseFormat";

export function ReleasePage() {
  const { projects, currentProjectId, currentProductId } = useProject();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTag = searchParams.get("tag") || "";
  const project = projects.find((item) => item.id === currentProjectId);
  const products = project?.storeProducts || [];
  const [productId, setProductId] = useState(currentProductId || products[0]?.id || "");
  const [releases, setReleases] = useState<any[]>([]);
  const [selectedTag, setSelectedTag] = useState("");
  const [active, setActive] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [releasesLoaded, setReleasesLoaded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<{
    chars: number;
    phase: "reasoning" | "content";
  } | null>(null);
  const [error, setError] = useState("");
  const [activeLanguage, setActiveLanguage] = useState("");
  const [sourceLanguage, setSourceLanguage] = useState("");
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [releaseContext, setReleaseContext] = useState<any>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [historyDraft, setHistoryDraft] = useState<any>(null);
  const [translatingLanguages, setTranslatingLanguages] = useState<Set<string>>(new Set());
  const translatingRef = useRef<Set<string>>(new Set());
  const [summaryChecked, setSummaryChecked] = useState<Set<string>>(new Set());
  const [pendingVersion, setPendingVersion] = useState("");

  useEffect(() => {
    const off = (window as any).appilot?.release?.onGenerateProgress?.((progress: any) => {
      if (progress?.kind === "chars" && typeof progress.chars === "number") {
        setGenerationProgress({
          chars: progress.chars,
          phase: progress.phase === "content" ? "content" : "reasoning",
        });
      }
    });
    return () => off?.();
  }, []);

  const loadReleases = async (force = false) => {
    if (!project?.id) return;
    setChecking(true);
    setError("");
    try {
      const next = await (window as any).appilot.release.list(project.id, force);
      setReleases(next.releases || []);
      setActive((prev: any) => {
        if (prev?.draft?.releaseTag && next.releases?.some((item: any) => item.tag === prev.draft.releaseTag)) {
          return prev;
        }
        return null;
      });
      const draft = next.releases?.find((item: any) => item.draft) || next.releases?.[0];
      setSelectedTag((current) => {
        if (urlTag && next.releases?.some((item: any) => item.tag === urlTag)) {
          return urlTag;
        }
        if (current && next.releases?.some((item: any) => item.tag === current)) {
          return current;
        }
        return draft?.tag || "";
      });
    } catch (e: any) {
      setError(e.message || "发布列表加载失败。");
    } finally {
      setChecking(false);
      setReleasesLoaded(true);
    }
  };

  useEffect(() => {
    void loadReleases();
  }, [project?.id, searchParams]);

  // Keep the selected product valid when the project or its products change
  // (e.g. switching project, or products arriving after the initial load).
  useEffect(() => {
    setProductId((current) => {
      if (products.some((item) => item.id === current)) return current;
      if (currentProductId && products.some((item) => item.id === currentProductId)) {
        return currentProductId;
      }
      return products[0]?.id || "";
    });
  }, [products, currentProductId]);

  // Keep the URL's ?tag= in sync with the release selected in the workbench,
  // so navigating away and back preserves the current draft.
  useEffect(() => {
    if (!project?.id || !selectedTag) return;
    if (urlTag === selectedTag) return;
    const next = new URLSearchParams(searchParams);
    next.set("tag", selectedTag);
    setSearchParams(next, { replace: true });
  }, [project?.id, selectedTag, urlTag, searchParams]);

  useEffect(() => {
    setSourceLanguage(UI_SOURCE_LANGUAGE);
    setTranslatingLanguages(new Set());
    setActiveLanguage("");
    setStep(1);
  }, [productId, project?.id]);

  useEffect(() => {
    if (!project?.id || !productId || !selectedTag) return;
    if (!products.some((item) => item.id === productId)) return;
    let cancelled = false;
    setContextLoading(true);
    setHistoryDraft(null);
    (window as any).appilot?.release?.context(project.id, productId, selectedTag)
      .then((context: any) => {
        if (!cancelled) {
          setReleaseContext(context);
          setContextLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReleaseContext(null);
          setContextLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [project?.id, productId, selectedTag]);

  const draft = active?.draft || null;
  const release = active?.release || null;
  const localizations = draft ? localizationList(draft) : [];
  const activeLocalization =
    localizations.find((item: any) => item.language === activeLanguage) || localizations[0] || null;
  const primaryLanguage = localizations[0]?.language || "";
  const masterConfirmed = Boolean(draft?.masterConfirmedAt);
  const batchConfirmed = Boolean(draft?.batchConfirmedAt);
  const selectedRelease = releases.find((item) => item.tag === selectedTag) || null;
  const selectedProduct = products.find((item) => item.id === productId) || null;
  const availableLanguages = (selectedProduct?.supportedLanguages || [])
    .map((item: any) => String(item?.code || "").trim())
    .filter(Boolean);
  const orderedLanguages = availableLanguages.includes(UI_SOURCE_LANGUAGE)
    ? [
        UI_SOURCE_LANGUAGE,
        ...availableLanguages.filter((language) => language !== UI_SOURCE_LANGUAGE),
      ]
    : availableLanguages;
  const remainingTranslationCount = orderedLanguages.filter(
    (language) =>
      language !== primaryLanguage &&
      !localizations.some((item: any) => item.language === language),
  ).length;
  const selectedExistingDraft =
    active?.draft?.productId === productId && active?.draft?.releaseTag === selectedTag
      ? active.draft
      : selectedRelease?.submissionDrafts?.find(
          (item: any) => item?.productId === productId,
        ) || null;
  const feedbackReadOnly = Boolean(release && !release.draft);
  const isReadOnly =
    feedbackReadOnly ||
    batchConfirmed ||
    (masterConfirmed && activeLocalization?.language === primaryLanguage);
  const busy = generating || loadingDraft;
  const summaryMaterial = selectedRelease?.material || null;
  const summaryItems: ChangeSummaryItem[] = summaryMaterial
    ? summarizeChanges(summaryMaterial)
    : [];
  const summaryPrCount = summaryMaterial?.pullRequests?.length ?? 0;
  const summaryCommitCount = summaryMaterial?.commits?.length ?? 0;
  const sinceMs = summaryMaterial?.sinceDate
    ? Date.now() - new Date(summaryMaterial.sinceDate).getTime()
    : null;
  const durationLabel =
    sinceMs != null && sinceMs >= 0
      ? sinceMs >= 86400000
        ? `${Math.round(sinceMs / 86400000)} 天`
        : `${Math.max(1, Math.round(sinceMs / 3600000))} 小时`
      : "";
  const checkedCount = summaryItems.filter((item) => summaryChecked.has(item.id)).length;
  const previousDraft =
    (releaseContext?.drafts || []).find((item: any) => item.releaseTag !== selectedTag) || null;
  const latestCodeDate = summaryMaterial?.commits?.[0]?.date || "";
  const fixedMaterialRows = (() => {
    const rows: {
      label: string;
      meta: string;
      badge?: "github";
      badgeTitle?: string;
    }[] = [];
    rows.push({
      label: "README 全文",
      meta: releaseContext?.readme ? `${releaseContext.readme.length.toLocaleString()} 字符` : "无",
    });
    rows.push({
      label: "产品档案",
      meta: `${selectedProduct?.trackName || project?.name || ""} · ${platformLabel(selectedProduct?.platform || "unknown")} · ${selectedProduct?.supportedLanguages?.length ?? 0} 语言`,
    });
    const historyDrafts = releaseContext?.drafts || [];
    rows.push({
      label: "文案列表（含历次发布公告）",
      meta:
        historyDrafts.length > 0
          ? `最近 ${historyDrafts.length} 份${historyDrafts[0]?.appVersion ? `（最新 v${String(historyDrafts[0].appVersion).replace(/^v/i, "")}）` : ""}`
          : "无",
    });
    const activeKeywordCount = (selectedProduct?.trackedKeywords || []).filter(
      (keyword: any) => keyword.status !== "paused",
    ).length;
    rows.push({
      label: "跟踪关键词与排名",
      meta: activeKeywordCount > 0 ? `${activeKeywordCount} 个关键词` : "无",
    });
    const githubRelease = summaryMaterial?.githubRelease;
    if (githubRelease) {
      rows.push({
        label: "GitHub 发布公告",
        meta: `${githubRelease.name || "发布正文"}${githubRelease.publishedAt ? ` · ${formatHumanTime(githubRelease.publishedAt)}` : ""}`,
        badge: "github",
        badgeTitle: githubRelease.viaToken
          ? "发布公告来自 GitHub（通过 Token 获取，支持私有仓库与草案）"
          : "发布公告来自 GitHub（公开仓库）",
      });
    }
    if (draft?.reviewFeedback) {
      rows.push({
        label: "驳回意见",
        meta: String(draft.reviewFeedback).split("\n")[0].slice(0, 40),
      });
    }
    return rows;
  })();

  useEffect(() => {
    const items = selectedRelease?.material ? summarizeChanges(selectedRelease.material) : [];
    const stored = draft?.summaryChecklist;
    setSummaryChecked(
      new Set(stored && stored.length > 0 ? stored : items.map((item) => item.id)),
    );
  }, [draft?.id, selectedRelease?.tag]);

  const persistSummaryChecklist = async (ids: string[]) => {
    const current = active?.draft;
    if (!current || !project?.id) return;
    const nextDraft = { ...current, summaryChecklist: ids };
    setActive((prev: any) => ({ ...prev, draft: nextDraft }));
    try {
      const saved = await (window as any).appilot.release.saveDraft(project.id, nextDraft);
      setActive((prev: any) => ({ ...prev, draft: saved }));
    } catch {
      // Keep the local state; persistence retries on the next toggle.
    }
  };

  const persistCurrentDraft = async () => {
    const current = active?.draft;
    if (!current || !project?.id) return;
    try {
      const saved = await (window as any).appilot.release.saveDraft(project.id, current);
      setActive((prev: any) => ({ ...prev, draft: saved }));
    } catch {
      // Keep the local edit; persistence retries on the next blur.
    }
  };

  const toggleSummaryItem = async (id: string) => {
    const next = new Set(summaryChecked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSummaryChecked(next);
    await persistSummaryChecklist([...next]);
  };

  const setAllSummaryChecked = async (checked: boolean) => {
    const next = new Set<string>();
    if (checked) summaryItems.forEach((item) => next.add(item.id));
    setSummaryChecked(next);
    await persistSummaryChecklist([...next]);
  };

  useEffect(() => {
    if (!activeLanguage && localizations[0]?.language) {
      setActiveLanguage(localizations[0].language);
    }
  }, [activeLanguage, localizations]);

  const updateLocalizationField = (
    field: "name" | "subtitle" | "promotionalText" | "description" | "whatsNew" | "keywords",
    value: string,
  ) => {
    setActive((prev: any) => {
      if (!prev?.draft) return prev;
      const nextLocalizations = (prev.draft.localizations || []).map((item: any) =>
        item.language === activeLocalization?.language
          ? { ...item, [field]: value }
          : item,
      );
      return {
        ...prev,
        draft: {
          ...prev.draft,
          localizations: nextLocalizations,
        },
      };
    });
  };

  const updateDraftField = (key: string, value: string) => {
    setActive((prev: any) => prev?.draft ? { ...prev, draft: { ...prev.draft, [key]: value } } : prev);
  };

  const handleLoad = async (force: boolean) => {
    if (!project || !productId || !selectedTag) return;
    if (force) {
      setGenerating(true);
      setGenerationProgress(null);
    } else {
      setLoadingDraft(true);
    }
    setError("");
    try {
      if (force && active?.draft) {
        const saved = await (window as any).appilot.release.saveDraft(project.id, active.draft);
        setActive((prev: any) => ({ ...prev, draft: saved }));
      }
      const next = await (window as any).appilot.release.get(
        project.id,
        productId,
        selectedTag,
        force,
        force ? sourceLanguage : undefined,
        force
          ? summaryItems.flatMap((item) =>
              summaryChecked.has(item.id) ? item.commits.map((commit) => commit.sha) : [],
            )
          : undefined,
        (draft?.appVersion || pendingVersion) || undefined,
        summaryItems
          .filter((item) => summaryChecked.has(item.id))
          .map((item) => item.title),
      );
      setActive(next);
      setStep(2);
    } catch (e: any) {
      setError(e.message || "发布工作单加载失败。");
    } finally {
      setGenerating(false);
      setLoadingDraft(false);
    }
  };

  const handleProductChange = async (value: string) => {
    setProductId(value);
    setActive(null);
    setActiveLanguage("");
    setReleaseContext(null);
    setHistoryDraft(null);
    const existing = selectedRelease?.submissionDrafts?.find(
      (item: any) => item?.productId === value,
    );
    if (!existing || !project || !selectedTag) return;

    setLoadingDraft(true);
    try {
      const next = await (window as any).appilot.release.get(project.id, value, selectedTag, false);
      setActive(next);
      setStep(2);
    } catch (e: any) {
      setError(e.message || "已有文案加载失败。");
    } finally {
      setLoadingDraft(false);
    }
  };

  const persistConfirm = async (patch: Record<string, string>) => {
    if (!project?.id || !draft) return;
    try {
      const saved = await (window as any).appilot.release.saveDraft(project.id, { ...draft, ...patch });
      setActive((prev: any) => ({ ...prev, draft: saved }));
    } catch (e: any) {
      setError(e.message || "保存失败。");
    }
  };

  const handleConfirmMaster = () => {
    if (!draft?.appVersion?.trim()) {
      setError("请先填写目标版本后再确定文案。");
      return;
    }
    if (!draft?.masterConfirmedAt) {
      void persistConfirm({ masterConfirmedAt: new Date().toISOString() });
    }
  };

  const handleConfirmBatch = () => {
    if (!draft?.appVersion?.trim()) {
      setError("请先填写目标版本后再确定文案。");
      return;
    }
    const now = new Date().toISOString();
    void persistConfirm({
      masterConfirmedAt: draft?.masterConfirmedAt || now,
      batchConfirmedAt: now,
    });
  };

  const handleTranslateOne = async (language: string) => {
    if (!project || !draft || !selectedTag || translatingRef.current.has(language)) return;
    if (
      !masterConfirmed ||
      batchConfirmed ||
      feedbackReadOnly ||
      localizations.some((item: any) => item.language === language)
    ) {
      return;
    }

    translatingRef.current.add(language);
    setTranslatingLanguages((prev) => new Set(prev).add(language));
    setError("");
    try {
      const currentDraft = active?.draft;
      if (currentDraft) {
        const saved = await (window as any).appilot.release.saveDraft(project.id, currentDraft);
        setActive((prev: any) => ({ ...prev, draft: saved }));
      }
      const next = await (window as any).appilot.release.translate(
        project.id,
        currentDraft?.productId || draft.productId,
        currentDraft?.releaseTag || draft.releaseTag,
        [language],
        sourceLanguage || currentDraft?.localizations?.[0]?.language || draft.localizations?.[0]?.language,
      );
      setActive((prev: any) => ({ ...prev, draft: next }));
      setActiveLanguage(language);
    } catch (e: any) {
      setError(e.message || `${languageLabel(language)} 翻译失败。`);
    } finally {
      translatingRef.current.delete(language);
      setTranslatingLanguages((prev) => {
        const next = new Set(prev);
        next.delete(language);
        return next;
      });
    }
  };

  useEffect(() => {
    if (!draft && selectedExistingDraft && selectedRelease?.draft && project && selectedTag) {
      void handleLoad(false);
    }
  }, [draft?.id, selectedExistingDraft?.id, project?.id, selectedTag]);

  if (!project) {
    return <EmptyState title="还没有项目" desc="添加一个项目后，这里会展示发布工作台。" />;
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">发布工作台</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
            自上次生成以来的提交与 PR 素材，由你确认后生成 App Store 提交文案。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <CredentialBadge
              kind="github"
              enabled={Boolean(project.hasGithubToken)}
              projectId={project.id}
            />
            <CredentialBadge
              kind="asc"
              enabled={Boolean(project.hasAscKey)}
              projectId={project.id}
            />
          </div>
          {products.length > 0 && (
            <div className="inline-flex rounded-xl bg-zinc-100 dark:bg-zinc-800/80 p-1 gap-1">
              {products.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => handleProductChange(product.id)}
                  className={cn(
                    "px-3.5 py-1.5 text-sm rounded-lg transition-colors",
                    product.id === productId
                      ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm font-medium"
                      : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300",
                  )}
                >
                  {platformLabel(product.platform)}
                </button>
              ))}
            </div>
          )}
          <button onClick={() => void loadReleases(true)} disabled={checking} className={btnPrimary}>
            {checking ? "检查中..." : "检查发布"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/50 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {releases.length === 0 ? (
        !releasesLoaded || checking ? (
          <div className="py-16 text-center text-sm text-zinc-400 dark:text-zinc-500">
            正在检查发布状态…
          </div>
        ) : (
          <EmptyState
            title="尚未检测到新的发布"
            desc="有新提交或创建新 tag（GitHub 发布会自动打 tag）后，这里会自动生成发布文案素材。"
          />
        )
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] items-start">
          <aside className="min-w-0">
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">参考</h3>
              </div>
              {selectedRelease && (
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  <ReferenceSection
                    title="变更摘要"
                    meta={
                      summaryItems.length > 0
                        ? `${summaryPrCount} PR · ${summaryCommitCount} 提交${durationLabel ? ` · ${durationLabel}` : ""}`
                        : "无变更"
                    }
                    checked={step > 1}
                    defaultOpen
                    action={
                      summaryItems.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => void setAllSummaryChecked(checkedCount < summaryItems.length)}
                          className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline"
                          title={
                            checkedCount === summaryItems.length
                              ? "取消全部选择"
                              : checkedCount === 0
                                ? "全部选择"
                                : "全部确认"
                          }
                        >
                          {checkedCount === summaryItems.length
                            ? "已全选"
                            : checkedCount === 0
                              ? "未选择"
                              : "全部确认"}
                        </button>
                      ) : undefined
                    }
                  >
                    {(previousDraft || latestCodeDate) && (
                      <div className="mb-2 space-y-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">
                        {previousDraft && (
                          <p>
                            上一次文案：{draftVersionLabel(previousDraft)} ·{" "}
                            {formatHumanTime(previousDraft.updatedAt)} 生成
                          </p>
                        )}
                        {latestCodeDate && <p>最新代码更新：{formatHumanTime(latestCodeDate)}</p>}
                      </div>
                    )}
                    {summaryItems.length === 0 ? (
                      <p className="text-sm text-zinc-400 dark:text-zinc-500">本次无变更</p>
                    ) : (
                      <>
                        <div className="space-y-1">
                          {summaryItems.map((item) => {
                            const included = summaryChecked.has(item.id);
                            const tone = CHANGE_TYPE_META[item.type].tone;
                            const latestDate = item.commits[item.commits.length - 1]?.date || "";
                            const subLine =
                              item.commits.length > 1
                                ? `${item.refs.join(" · ")} · ${item.commits.length} 次提交${latestDate ? ` · 最新 ${formatHumanTime(latestDate)}` : ""}`
                                : `${item.refs.join(" · ")}${latestDate ? ` · ${formatHumanTime(latestDate)}` : ""}`;
                            return (
                              <div
                                key={item.id}
                                className={cn(
                                  "w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg",
                                  !included && "opacity-55",
                                )}
                              >
                                <span
                                  role="checkbox"
                                  aria-checked={included}
                                  tabIndex={0}
                                  onClick={() => void toggleSummaryItem(item.id)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      void toggleSummaryItem(item.id);
                                    }
                                  }}
                                  title={included ? "从 AI 素材中排除" : "作为 AI 素材提供"}
                                  className={cn(
                                    "mt-0.5 w-4 h-4 shrink-0 rounded border flex items-center justify-center text-[10px] transition-colors cursor-pointer",
                                    included
                                      ? "bg-amber-500 border-amber-500 text-white"
                                      : "border-zinc-300 dark:border-zinc-600",
                                  )}
                                >
                                  {included ? "✓" : ""}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block text-xs text-zinc-800 dark:text-zinc-200 truncate">
                                    {item.title}
                                  </span>
                                  <span
                                    className="block text-[10px] text-zinc-400 dark:text-zinc-500 truncate"
                                  >
                                    {subLine}
                                  </span>
                                </span>
                                {item.github && (
                                  item.prUrl ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        (window as any).appilot?.openExternal?.(item.prUrl)
                                      }
                                      className="shrink-0 inline-flex items-center text-zinc-400 dark:text-zinc-500 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                                      title={`打开 GitHub PR #${item.prNumber || ""}`}
                                    >
                                      <GithubIcon className="w-3 h-3 text-current" />
                                    </button>
                                  ) : (
                                    <span
                                      className="shrink-0 inline-flex items-center text-zinc-400 dark:text-zinc-500"
                                      title={`GitHub PR #${item.prNumber || ""}`}
                                    >
                                      <GithubIcon className="w-3 h-3 text-current" />
                                    </span>
                                  )
                                )}
                                <span
                                  className={cn(
                                    "shrink-0 inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium",
                                    tone === "amber" && "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400",
                                    tone === "emerald" && "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                                    tone === "sky" && "bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-400",
                                    tone === "muted" && "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400",
                                  )}
                                >
                                  {CHANGE_TYPE_META[item.type].label}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
                          以上 {checkedCount}/{summaryItems.length} 项将作为素材提供给 AI；未勾选项不会进入文案生成。
                        </p>
                      </>
                    )}
                  </ReferenceSection>

                  {step <= 2 &&
                    (contextLoading ? (
                      <div className="px-5 py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">
                        正在载入发布参考…
                      </div>
                    ) : releaseContext ? (
                      <>
                        <ReferenceSection title="固定素材" meta="始终发送给 AI" defaultOpen>
                          <ul className="space-y-1.5">
                            {fixedMaterialRows.map((row) => (
                              <li
                                key={row.label}
                                className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-zinc-50/60 dark:bg-zinc-800/30"
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="block text-xs text-zinc-700 dark:text-zinc-300 truncate">
                                    {row.label}
                                  </span>
                                  <span className="block text-[10px] text-zinc-400 dark:text-zinc-500 truncate">
                                    {row.meta}
                                  </span>
                                </span>
                                {row.badge === "github" && (
                                  <span
                                    className="shrink-0 inline-flex items-center text-zinc-400 dark:text-zinc-500"
                                    title={row.badgeTitle || "发布公告来自 GitHub"}
                                  >
                                    <GithubIcon className="w-3 h-3 text-current" />
                                  </span>
                                )}
                                <span className="shrink-0 inline-flex px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[10px] text-zinc-500 dark:text-zinc-400">
                                  始终发送
                                </span>
                              </li>
                            ))}
                          </ul>
                          <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
                            这些素材无需逐项查看；如需调整素材范围，可在上方变更摘要中取消对应条目。
                          </p>
                        </ReferenceSection>
                        <HistoryPanel
                          drafts={releaseContext.drafts || []}
                          selectedDraft={historyDraft}
                          onSelect={(draft: any) => setHistoryDraft(draft)}
                          currentTag={selectedTag}
                        />
                      </>
                    ) : null)}
                </div>
              )}
            </div>
          </aside>

          <div className="min-w-0 space-y-6">
            {selectedRelease && (
              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm px-5 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[11px] text-zinc-400 dark:text-zinc-500 shrink-0">文档</span>
                  <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                    {historyDraft
                      ? `文案列表 · ${draftVersionLabel(historyDraft)}`
                      : `当前文案 · ${draft?.appVersion || "版本待定"}`}
                  </span>
                  {!historyDraft && (
                    <span className="flex items-center gap-1.5 shrink-0 flex-wrap">
                      {masterConfirmed && !batchConfirmed && (
                        <StatusChip label="母本已确定" tone="amber" />
                      )}
                      {batchConfirmed && <StatusChip label="整批已确定" tone="emerald" />}
                      {draft?.storeStatus && STORE_STATUS_META[draft.storeStatus] && (
                        <StatusChip
                          label={STORE_STATUS_META[draft.storeStatus].label}
                          tone={STORE_STATUS_META[draft.storeStatus].tone}
                        />
                      )}
                      {draft && localizations.length > 0 && (
                        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                          {localizations.length}/{availableLanguages.length} 语言
                        </span>
                      )}
                    </span>
                  )}
                </div>
                {historyDraft && (
                  <button type="button" onClick={() => setHistoryDraft(null)} className={btnSmSecondary}>
                    ← 返回当前文案
                  </button>
                )}
              </div>
            )}
            {historyDraft ? (
              <HistoryViewer draft={historyDraft} />
            ) : (
              <>
            {selectedRelease && step === 1 && (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold tracking-wider text-zinc-400 dark:text-zinc-500 shrink-0">
                    目标版本
                  </span>
                  <input
                    value={draft?.appVersion ?? pendingVersion}
                    onChange={(e) => {
                      if (draft) updateDraftField("appVersion", e.target.value);
                      else setPendingVersion(e.target.value);
                    }}
                    onBlur={() => void persistCurrentDraft()}
                    placeholder="如 1.2.6"
                    className={inputLineClass + " max-w-32"}
                  />
                  <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                    {draft ? "文案列表将按此版本标识" : "生成文案时将写入此版本"}
                  </span>
                </div>
                <div>
                  <p className="text-xs font-semibold tracking-wider text-zinc-400 dark:text-zinc-500 mb-2">语言</p>
                  <div className="flex flex-wrap gap-2">
                    {orderedLanguages.map((language, index) => (
                      <span
                        key={language}
                        className={cn(
                          "px-3 py-1.5 text-sm rounded-lg border",
                          index === 0
                            ? "border-amber-500/50 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium"
                            : "border-zinc-200 dark:border-zinc-700 text-zinc-400 dark:text-zinc-500",
                        )}
                      >
                        {languageLabel(language)}{index === 0 ? " ✓" : ""}
                      </span>
                    ))}
                  </div>
                </div>

                {selectedRelease.draft && !draft && (
                  summaryItems.length > 0 ? (
                    <AIProgressButton
                      onClick={() => handleLoad(true)}
                      disabled={busy && !generating}
                      loading={generating}
                      progress={generationProgress}
                      idleLabel="下一步：生成文案"
                    />
                  ) : (
                    <p className="text-sm text-zinc-400 dark:text-zinc-500">
                      本次无变更，无需生成新文案。
                    </p>
                  )
                )}

                {!selectedRelease.draft && (
                  <div>
                    {selectedExistingDraft ? (
                      <button onClick={() => handleLoad(false)} disabled={busy} className="px-4 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60">
                        {loadingDraft ? "加载中..." : "查看文案列表"}
                      </button>
                    ) : (
                      <span className="text-sm text-zinc-400 dark:text-zinc-500">该正式发布没有文案</span>
                    )}
                  </div>
                )}
              </>
            )}

            {!draft ? (
              selectedRelease && step > 1 ? (
                <EmptyState
                  title={selectedRelease.draft ? "等待生成提交文案" : "该正式发布没有文案"}
                  desc={selectedRelease.draft ? "确认后由 AI 生成名称、副标题、Promotional Text、描述、What's New 和关键词。" : "正式发布只作为完成信号，不再生成新的商店文案。"}
                />
              ) : null
            ) : (
              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between gap-4">
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">商店提交工作单</h3>
                </div>

                <div className="p-6 space-y-6">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold tracking-wider text-zinc-400 dark:text-zinc-500 shrink-0">
                      目标版本
                    </span>
                    <input
                      value={draft.appVersion || ""}
                      onChange={(e) => updateDraftField("appVersion", e.target.value)}
                      onBlur={() => void persistCurrentDraft()}
                      placeholder="如 1.2.6"
                      className={inputLineClass + " max-w-32"}
                    />
                    <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                      确定文案前需填写
                    </span>
                  </div>
                  {activeLocalization && (
                    <>
                      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-4">
                        <p className="text-[11px] font-semibold tracking-wider text-zinc-400 dark:text-zinc-500">
                          应用信息
                        </p>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <FieldHeader label="软件名称" text={activeLocalization.name || ""} />
                            <input
                              value={activeLocalization.name || ""}
                              onChange={(e) => updateLocalizationField("name", e.target.value)}
                              disabled={isReadOnly}
                              className={inputLineClass}
                            />
                            <p className="text-[11px] text-amber-600/80 dark:text-amber-500/70 px-1">
                              建议：名称后加冒号和描述性短句（如 GloWalk: Path of Light）
                            </p>
                            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 px-1">
                              {(activeLocalization.name || "").length}/30 字符
                            </p>
                          </div>
                          <div className="space-y-1.5">
                            <FieldHeader label="软件副标题" text={activeLocalization.subtitle || ""} />
                            <input
                              value={activeLocalization.subtitle || ""}
                              onChange={(e) => updateLocalizationField("subtitle", e.target.value)}
                              disabled={isReadOnly}
                              className={inputLineClass}
                            />
                            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 px-1">
                              {(activeLocalization.subtitle || "").length}/30 字符
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-4">
                        <p className="text-[11px] font-semibold tracking-wider text-zinc-400 dark:text-zinc-500">
                          软件版本信息
                        </p>
                        <div className="space-y-1.5">
                          <FieldHeader label="推广文本" text={activeLocalization.promotionalText} />
                          <input
                            value={activeLocalization.promotionalText}
                            onChange={(e) => updateLocalizationField("promotionalText", e.target.value)}
                            disabled={isReadOnly}
                            className={inputLineClass}
                          />
                          <p className="text-[11px] text-zinc-400 dark:text-zinc-500 px-1">
                            {activeLocalization.promotionalText.length}/170 字符
                          </p>
                        </div>

                        <div className="space-y-1.5">
                          <FieldHeader label="软件描述" text={activeLocalization.description} />
                          <textarea
                            value={activeLocalization.description}
                            onChange={(e) => updateLocalizationField("description", e.target.value)}
                            disabled={isReadOnly}
                            className={inputClass + " min-h-40 resize-y"}
                          />
                          <p className="text-[11px] text-zinc-400 dark:text-zinc-500 px-1">
                            {activeLocalization.description.length}/4000 字符
                          </p>
                        </div>

                        <div className="space-y-1.5">
                          <FieldHeader label="新增内容" text={activeLocalization.whatsNew} />
                          <textarea
                            value={activeLocalization.whatsNew}
                            onChange={(e) => updateLocalizationField("whatsNew", e.target.value)}
                            disabled={isReadOnly}
                            className={inputClass + " min-h-28 resize-y"}
                          />
                          <p className="text-[11px] text-zinc-400 dark:text-zinc-500 px-1">
                            {activeLocalization.whatsNew.length}/4000 字符
                          </p>
                        </div>

                        <div className="space-y-1.5">
                          <FieldHeader label="关键词（提交字段）" text={activeLocalization.keywords} />
                          <input
                            value={activeLocalization.keywords}
                            onChange={(e) => updateLocalizationField("keywords", e.target.value)}
                            disabled={isReadOnly}
                            className={inputLineClass}
                          />
                          <p className="text-[11px] text-zinc-400 dark:text-zinc-500 px-1">
                            {activeLocalization.keywords.length}/100 字符
                          </p>
                        </div>
                      </div>
                    </>
                  )}

                  <div className="border-t border-zinc-100 dark:border-zinc-800 pt-5 space-y-4">
                    <div className="flex flex-wrap gap-2">
                      {orderedLanguages.map((language) => {
                        const generated = localizations.some((item: any) => item.language === language);
                        const translating = translatingLanguages.has(language);
                        const active = activeLocalization?.language === language;
                        const clickable =
                          masterConfirmed &&
                          !batchConfirmed &&
                          !feedbackReadOnly &&
                          !generated &&
                          !translating;
                        const chipTitle = generated
                          ? `${languageLabel(language)}文案`
                          : clickable
                            ? `翻译为${languageLabel(language)}文案`
                            : feedbackReadOnly
                              ? "正式发布后只读，不可翻译"
                              : batchConfirmed
                                ? "整批文案已确定，只读"
                                : "先确定母本语言，再翻译其他语言";
                        return (
                          <button
                            key={language}
                            title={chipTitle}
                            onClick={() => {
                              if (generated) {
                                setActiveLanguage(language);
                              } else if (clickable) {
                                void handleTranslateOne(language);
                              }
                            }}
                            disabled={generating || (!generated && !clickable)}
                            className={cn(
                              "px-3 py-1.5 text-sm rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                              active
                                ? "border-amber-500 ring-2 ring-amber-500/20 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium"
                                : generated
                                  ? "border-emerald-500/50 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                  : "border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600",
                            )}
                          >
                            {languageLabel(language)}
                            {translating ? (
                              <span className="inline-flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full border-2 border-current border-t-transparent animate-spin" />
                                {formatKilo(generationProgress?.chars || 0)}
                              </span>
                            ) : generated ? (
                              " ✓"
                            ) : (
                              ""
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {!feedbackReadOnly && !batchConfirmed && (
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <span className="text-xs text-zinc-400 dark:text-zinc-500">
                          {!masterConfirmed
                            ? "确定母本语言后，可逐一翻译其他语言"
                            : remainingTranslationCount > 0
                              ? `还有 ${remainingTranslationCount} 个语言未翻译（可选）`
                              : "全部语言已翻译"}
                        </span>
                        <button
                          onClick={masterConfirmed ? handleConfirmBatch : handleConfirmMaster}
                          className={btnPrimary}
                        >
                          {masterConfirmed ? "确定整个文案" : "确定母本语言"}
                        </button>
                      </div>
                    )}

                    {batchConfirmed && !feedbackReadOnly && (
                      <div className="flex justify-end">
                        <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                          文案已确定
                        </span>
                      </div>
                    )}
                  </div>

                  <FieldBlock label="驳回意见 / 我的修改意见（重新生成时作为上下文）">
                    <textarea
                      value={draft.reviewFeedback || ""}
                      onChange={(e) => updateDraftField("reviewFeedback", e.target.value)}
                      disabled={feedbackReadOnly}
                      className={inputClass + " min-h-20 resize-y"}
                    />
                    {!feedbackReadOnly && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <AIProgressButton
                          onClick={() => handleLoad(true)}
                          disabled={busy && !generating}
                          loading={generating}
                          progress={generationProgress}
                          idleLabel="重新生成"
                        />
                      </div>
                    )}
                  </FieldBlock>
                </div>
              </div>
            )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Keywords (tracking vs submission, one AI request per language) ── */
