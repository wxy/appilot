import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useProject } from "../../stores/project";
import { cn } from "../../lib/utils";
import { buildStatusForVersion } from "../../../engine/build-status";
import { inferAppVersion } from "../../../engine/store-submission";
import { ascStoreLiveVersion, deriveVersionStatus } from "../../../engine/version-status";
import {
  formatHumanTime,
  languageLabel,
  platformLabel,
  UI_SOURCE_LANGUAGE,
} from "../../lib/format";
import { localizationList } from "../../lib/release-localization";
import {
  CHANGE_TYPE_META,
  summarizeChanges,
  type ChangeSummaryItem,
} from "../../lib/release-summary";
import { AIProgressButton } from "../ui/AIProgressButton";
import { CredentialBadge } from "../ui/CredentialBadge";
import { EmptyState } from "../ui/EmptyState";
import { FieldBlock, FieldHeader } from "../ui/Fields";
import { AppleIcon, GithubIcon } from "../ui/Icons";
import { StatusChip } from "../ui/StatusChip";
import { ReleaseReadinessPanel } from "./ReleaseReadinessPanel";
import { PreReleaseChecklistPanel } from "./PreReleaseChecklistPanel";
import {
  btnPrimary,
  inputClass,
  inputLineClass,
} from "../ui/styles";
import { HistoryPanel } from "./HistoryPanel";
import { HistoryViewer } from "./HistoryViewer";
import { ReferenceSection } from "./ReferenceSection";
import { draftVersionLabel } from "./releaseFormat";
import { ValueFlash } from "../ui/ValueFlash";
import { KeywordRuby } from "../ui/KeywordRuby";

const ALIGNMENT_FIELD_LABEL: Record<string, string> = {
  name: "名称",
  subtitle: "副标题",
  promotionalText: "推广文本",
  description: "描述",
  whatsNew: "新增内容",
  keywords: "关键词",
};

export function ReleasePage() {
  const { projects, currentProjectId, currentProductId, selectProduct } = useProject();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTag = searchParams.get("tag") || "";
  const project = projects.find((item) => item.id === currentProjectId);
  const products = project?.storeProducts || [];
  const [productId, setProductId] = useState(currentProductId || products[0]?.id || "");
  const [releases, setReleases] = useState<any[]>([]);
  const [githubCapabilities, setGithubCapabilities] = useState<{
    repoPush: boolean | null;
    tokenKind?: "fine-grained" | "classic" | "none" | "unknown";
    contents?: "read" | "write" | null;
  } | null>(null);
  const [selectedTag, setSelectedTag] = useState("");
  const [viewMode, setViewMode] = useState<"working" | "current" | "history">("working");
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
  const [translateOpId, setTranslateOpId] = useState("");
  const [generateOpId, setGenerateOpId] = useState("");
  const [failedTranslation, setFailedTranslation] = useState("");
  const [generateFailed, setGenerateFailed] = useState(false);
  const [summaryChecked, setSummaryChecked] = useState<Set<string>>(new Set());
  const [pendingVersion, setPendingVersion] = useState("");
  const [ascInfo, setAscInfo] = useState<{ versions: any[]; builds: any[]; fetchedAt?: string } | null>(null);
  const [ascRefreshing, setAscRefreshing] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [alignment, setAlignment] = useState<{
    mode: "asc" | "public";
    versionMatched: boolean;
    diffs: { language: string; field: string; local: string; store: string }[];
    applied?: boolean;
  } | null>(null);
  const [aligning, setAligning] = useState(false);
  const [applyingAlignment, setApplyingAlignment] = useState(false);
  const [generatingChecklist, setGeneratingChecklist] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);
  const [storeCurrentVersion, setStoreCurrentVersion] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const off = (window as any).appilot?.release?.onGenerateProgress?.((progress: any) => {
      if (progress?.kind === "retry") {
        // 自动修复/强制重写开始：运行按钮变黄提示用户。
        setRetrying(true);
      } else if (progress?.kind === "chars" && typeof progress.chars === "number") {
        setGenerationProgress({
          chars: progress.chars,
          phase: progress.phase === "content" ? "content" : "reasoning",
        });
      }
    });
    return () => off?.();
  }, []);

  useEffect(() => {
    if (!productId) return;
    let cancelled = false;
    (window as any).appilot?.asc?.status(productId)
      .then((info: any) => { if (!cancelled) setAscInfo(info); })
      .catch(() => { if (!cancelled) setAscInfo(null); });
    return () => { cancelled = true; };
  }, [productId]);

  // Public store lookup: the no-ASC fallback for version status. It can only
  // confirm the *current* live version; everything else stays "未确认".
  const loadStoreCurrentVersion = async () => {
    if (!productId) return;
    try {
      const info = await (window as any).appilot?.store?.currentVersion(productId);
      setStoreCurrentVersion(info?.version || null);
    } catch {
      setStoreCurrentVersion(null);
    }
  };
  useEffect(() => {
    void loadStoreCurrentVersion();
  }, [productId]);

  const handleAscRefresh = async () => {
    if (!productId || ascRefreshing) return;
    setAscRefreshing(true);
    try {
      await (window as any).appilot?.asc?.sync(productId);
      const info = await (window as any).appilot?.asc?.status(productId);
      setAscInfo(info || null);
      void loadStoreCurrentVersion();
    } finally {
      setAscRefreshing(false);
    }
  };

  const loadReleases = async (force = false, clearFirst = true, resetView = false) => {
    if (!project?.id) return;
    // 只有切换项目/平台或首次加载时才清空旧数据走载入态；
    // 后台发布同步触发的刷新不清空，原地更新，避免整页闪成“正在检查发布状态”。
    if (clearFirst) {
      setReleases([]);
      setChecking(true);
    }
    setError("");
    try {
      const next = await (window as any).appilot.release.list(project.id, force);
      setReleases(next.releases || []);
      setGithubCapabilities(next.githubCapabilities || null);
      // 视图模式跟随工作目标：有尚未定稿的发布 → 工作视图；否则当前文案视图。
      // 仅在切项目/平台或首次载入时重置，后台刷新保留当前视图。
      if (resetView) {
        const hasConfirmedFor = (r: any) =>
          (r?.submissionDrafts || []).some(
            (d: any) => d?.productId === productId && d?.batchConfirmedAt,
          );
        // 工作目标 = 前沿发布（列表第一项）。最新发布已定稿且没有更新的
        // 发布时，不存在工作目标；绝不回退到旧的未覆盖发布。
        const workTarget =
          (next.releases || [])[0] && !hasConfirmedFor((next.releases || [])[0])
            ? (next.releases || [])[0]
            : null;
        const urlView = searchParams.get("view");
        setViewMode(
          urlView === "working" || urlView === "current"
            ? urlView
            : workTarget
              ? "working"
              : "current",
        );
      }
      setActive((prev: any) => {
        if (
          !force &&
          prev?.draft?.releaseTag &&
          next.releases?.some((item: any) => item.tag === prev.draft.releaseTag)
        ) {
          return prev;
        }
        return null;
      });
      const candidates: any[] = next.releases || [];
      const latest = candidates[0] || null;
      // 当前文案 = 最新一批已确定的文案；没有新工作时默认回到它。
      const confirmed = candidates
        .flatMap((r: any) =>
          (r.submissionDrafts || []).filter(
            (d: any) => d?.productId === productId && d?.batchConfirmedAt,
          ),
        )
        .sort(
          (a: any, b: any) =>
            new Date(b.batchConfirmedAt).getTime() -
            new Date(a.batchConfirmedAt).getTime(),
        )[0] || null;
      const currentCopyTag = confirmed
        ? releaseTagForVersion(confirmed.appVersion, candidates) ||
          confirmed.releaseTag ||
          null
        : null;
      // 有新提交/PR 或发布草案 → 指向最新文案草案；否则回到当前文案。
      const hasNewWork = Boolean(
        latest &&
        (latest.githubDraft === true ||
          (latest.material?.commits || []).some(
            (c: any) =>
              !/^Merge\s+(pull\s+request|branch)/i.test(String(c?.subject || "")),
          )),
      );
      const defaultTag = hasNewWork
        ? latest?.tag
        : currentCopyTag || latest?.tag || "";
      // 显式点击“检查 GitHub 发布”时跳到最新发布（含新草案）；后台刷新或
      // 首次加载仍保留当前选择，避免打断正在编辑的文案。
      const nextTag = (() => {
        // 首次进入/切换产品：以视图目标为准（URL 可能残留历史浏览的 tag）。
        if (resetView) return defaultTag;
        if (
          !force &&
          urlTag &&
          next.releases?.some((item: any) => item.tag === urlTag)
        ) {
          return urlTag;
        }
        if (
          !force &&
          selectedTag &&
          next.releases?.some((item: any) => item.tag === selectedTag)
        ) {
          return selectedTag;
        }
        return defaultTag;
      })();
      if (force && nextTag && nextTag !== selectedTag) {
        setActive(null);
      }
      setSelectedTag(nextTag);
    } catch (e: any) {
      setError(e.message || "发布列表加载失败。");
    } finally {
      setChecking(false);
      setReleasesLoaded(true);
    }
  };

  // 首次进入或切换项目/平台时重置视图模式；URL/后台刷新只更新数据。
  const lastProductKey = useRef("");
  useEffect(() => {
    const key = `${project?.id}:${productId}`;
    const resetView = lastProductKey.current !== key;
    lastProductKey.current = key;
    void loadReleases(false, true, resetView);
    // 视图/发布切换只改变 selectedTag，由 release:context 增量加载对应发布
    // 的素材与草案；不整页重载 release.list，避免出现「检查发布状态」与
    // 长等待。首次进入或切项目/平台时才调用上面的 loadReleases。
  }, [project?.id, productId]);

  // 主进程数据变更推送：发布/App Store 状态更新时自动刷新工作台。
  // 用 ref 持有最新的 loadReleases，避免监听器闭包陈旧：切换视图时先保存
  // 草案会触发数据变更，若旧闭包被调用，会用旧的 selectedTag 把选中发布
  // 拉回默认值，造成「第一次点击被弹回」。
  const loadReleasesRef = useRef(loadReleases);
  loadReleasesRef.current = loadReleases;
  useEffect(() => {
    const handler = (e: Event) => {
      const scope = (e as CustomEvent).detail;
      if (scope === "releases") {
        void loadReleasesRef.current(false, false);
      } else if (scope === "asc" && productId) {
        (window as any).appilot?.asc?.status(productId)
          .then(setAscInfo)
          .catch(() => undefined);
      }
    };
    window.addEventListener("appilot:data-changed", handler);
    return () => window.removeEventListener("appilot:data-changed", handler);
  }, [productId]);

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
  // so navigating away and back preserves the current draft. 历史视图是瞬态，
  // 不写 tag，避免刷新/返回时恢复到历史发布的旧 tag。
  useEffect(() => {
    if (!project?.id || !selectedTag) return;
    const next = new URLSearchParams(searchParams);
    if (viewMode !== "history" && urlTag !== selectedTag) {
      next.set("tag", selectedTag);
    }
    if (viewMode !== "history" && next.get("view") !== viewMode) {
      next.set("view", viewMode);
    }
    setSearchParams(next, { replace: true });
  }, [project?.id, selectedTag, viewMode, urlTag, searchParams]);

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
    // 注意：这里不能清空 historyDraft。点击历史文案会同时改变 selectedTag
    // （让流程图跟随），若在此重置，第一次点击打开的历史查看器会立刻被
    // 清掉，必须点第二次。历史状态由视图切换处理器负责清理。
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
  const selectedRelease = releases.find((item) => item.tag === selectedTag) || null;
  // 流程状态跟随当前选中的发布（视图所属），active.release 仅作兜底。
  const release = selectedRelease || active?.release || null;
  const released = Boolean(release && release.githubDraft === false);
  const ascConfigured = Boolean(project?.hasAscKey);
  // 当前视图实际展示的文案：工作/当前视图用 active 中的草案，历史视图用选中的历史文案。
  const viewDraft = draft || historyDraft || null;
  // 目标版本默认从发布公告推断（tag 语义版本优先，名称兜底）。没有草稿时也
  // 用它查询商店状态——否则"无文案 + 已上架"时无法判断可重建。
  const inferredVersion = selectedRelease ? inferAppVersion(selectedRelease) : "";
  const versionQuery = String(
    viewDraft?.appVersion || inferredVersion || pendingVersion || "",
  ).trim();
  const ascVersion = viewDraft?.appVersion
    ? (ascInfo?.versions || []).find((v: any) => v.versionString === viewDraft.appVersion) || null
    : null;
  const versionStatus = deriveVersionStatus({
    appVersion: versionQuery,
    ascVersions: ascInfo?.versions ?? null,
    storeCurrentVersion,
  });
  const storeLiveVersion = ascStoreLiveVersion(ascInfo?.versions);
  // ASC configured but not synced yet → "待同步", never "未配置".
  const ascPending = ascConfigured && !ascInfo && versionQuery;
  const effectiveVersionStatus = ascPending
    ? { key: "asc-pending" as const, label: "待同步", tone: "muted" as const, source: "asc" as const }
    : versionQuery
      ? versionStatus
      : null;
  // 只有“已上架且已按商店冻结”的文案才是完全只读（D2）。整批确定但尚未
  // 上架时，仍允许填写驳回意见并重新生成；没有草稿（或未确认的新草稿）时
  // 允许从头新建，即使版本已上架——发布状态只是信息，不阻断新建。
  const versionLocked =
    Boolean(draft?.ascSyncedAt) && effectiveVersionStatus?.key === "ready-for-sale";
  const feedbackReadOnly = versionLocked;
  const githubStatus = release?.githubDraft === true
    ? { label: "发布草案", tone: "blue" as const, source: "GitHub" as const }
    : release?.githubDraft === false
      ? { label: "已发布", tone: "emerald" as const, source: "GitHub" as const }
      : release
        ? { label: "本地标签", tone: "muted" as const, source: "本地" as const }
        : null;
  const buildInfo = ascVersion ? buildStatusForVersion(ascVersion, ascInfo?.builds || []) : null;
  const buildTone: "muted" | "emerald" | "amber" | "red" = buildInfo?.state === "available"
    ? "emerald"
    : buildInfo?.state === "processing" || buildInfo?.state === "inBetaReview"
      ? "amber"
      : buildInfo?.state === "rejected"
        ? "red"
        : "muted";
  const localizations = draft ? localizationList(draft) : [];
  const activeLocalization =
    localizations.find((item: any) => item.language === activeLanguage) || null;
  const primaryLanguage = localizations[0]?.language || "";
  const masterConfirmed = Boolean(viewDraft?.masterConfirmedAt);
  const batchConfirmed = Boolean(viewDraft?.batchConfirmedAt);
  const draftVersionHint = draft?.appVersion || pendingVersion || inferredVersion;
  const latestRelease = releases[0] || null;
  // 有新提交/PR 或发布草案 → 视为有新的发布前工作（检查单入口与最新文案草案入口出现）。
  const hasNewWork = Boolean(
    latestRelease &&
    (latestRelease.githubDraft === true ||
      (latestRelease.material?.commits || []).some(
        (c: any) =>
          !/^Merge\s+(pull\s+request|branch)/i.test(String(c?.subject || "")),
      )),
  );
  const selectedProduct = products.find((item) => item.id === productId) || null;
  const availableLanguages = (selectedProduct?.supportedLanguages || [])
    .map((item: any) => String(item?.code || "").trim())
    .filter(Boolean);
  // 当前文案 = batchConfirmedAt 最新的一份已整批确定文案，与 updatedAt
  // （会被翻译/保存等操作改写）无关。
  const currentCopy =
    (releaseContext?.drafts || [])
      .filter((item: any) => Boolean(item.batchConfirmedAt))
      .sort(
        (a: any, b: any) =>
          new Date(b.batchConfirmedAt).getTime() -
          new Date(a.batchConfirmedAt).getTime(),
      )[0] || null;
  // 工作目标 = 前沿发布（列表第一项：草案优先、再按时间）。最新发布已定稿
  // 且没有更新的发布时不存在工作目标，绝不回退到旧的未覆盖发布。
  const hasConfirmedCopyFor = (r: any) =>
    (r?.submissionDrafts || []).some(
      (d: any) => d?.productId === productId && d?.batchConfirmedAt,
    );
  const workTargetRelease =
    releases[0] && !hasConfirmedCopyFor(releases[0]) ? releases[0] : null;
  // 工作目标上的文案草案（未确定）：按最近更新取一份。
  const workingDraft =
    (workTargetRelease?.submissionDrafts || [])
      .filter((item: any) => item?.productId === productId)
      .sort(
        (a: any, b: any) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )[0] || null;
  const hasWork = Boolean(workTargetRelease);
  // 被超越的未完成草案：不在工作目标上、且尚未整批确定的残留。
  const supersededUnconfirmedDrafts = (releaseContext?.drafts || []).filter(
    (item: any) =>
      item?.productId === productId &&
      !item?.batchConfirmedAt &&
      item?.releaseTag !== workTargetRelease?.tag,
  );
  // 与商店完全对齐：从商店重建/冻结的文案 ascSyncedAt 存在。手动发布后的
  // 对齐校验后续补上。
  const storeAligned = Boolean(currentCopy?.ascSyncedAt || draft?.ascSyncedAt);
  const orderedLanguages = availableLanguages.includes(UI_SOURCE_LANGUAGE)
    ? [
        UI_SOURCE_LANGUAGE,
        ...availableLanguages.filter((language) => language !== UI_SOURCE_LANGUAGE),
      ]
    : availableLanguages;
  // 选项卡按汉语拼音音序排列（zh-CN localeCompare 对中文按拼音排序）。
  const tabLanguages = [...orderedLanguages].sort((a, b) =>
    languageLabel(a).localeCompare(languageLabel(b), "zh-CN"),
  );
  // 流程状态栏：GitHub 发布 → 本地文案草案 → 商店版本，每个节点标注自身状态。
  const githubNode = githubStatus ? (
    <>
      <StatusChip label={githubStatus.label} tone={githubStatus.tone} />
      {selectedRelease?.tag && (
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate">
          {selectedRelease.tag}
        </span>
      )}
    </>
  ) : null;
  const githubWarning =
    githubCapabilities?.repoPush === false
      ? githubCapabilities.tokenKind === "fine-grained"
        ? "GitHub Token（fine-grained）的 Contents 只有读取权限，发布草案不可见。请在 GitHub 设置中将 Contents 权限改为 Read and write，或改用带 repo 权限的 classic token"
        : githubCapabilities.tokenKind === "classic"
          ? "GitHub Token（classic）缺少 repo / public_repo 权限，发布草案不可见。请改用带 repo 权限的 classic token"
          : "GitHub Token 没有仓库写权限，发布草案不可见（需 Contents 读+写或 repo 权限）"
      : null;
  const copyNode = loadingDraft && !viewDraft ? (
    <span className="text-[11px] text-zinc-400 dark:text-zinc-500">载入中…</span>
  ) : viewDraft &&
    (masterConfirmed ||
      batchConfirmed ||
      viewDraft?.appVersion ||
      (viewDraft && (viewDraft.localizations || []).length > 0)) ? (
      <>
        {masterConfirmed && !batchConfirmed && (
          <StatusChip label="母本已确定" tone="amber" />
        )}
        {batchConfirmed && <StatusChip label="整批已确定" tone="emerald" />}
        {viewDraft?.appVersion && (
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
            v{viewDraft.appVersion}
          </span>
        )}
        {viewDraft && (viewDraft.localizations || []).length > 0 && (
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
            {(viewDraft.localizations || []).length}/{availableLanguages.length} 语言
          </span>
        )}
      </>
    ) : null;
  const storeNode = effectiveVersionStatus || buildInfo || (viewDraft?.appVersion && storeLiveVersion) ? (
    <>
      {effectiveVersionStatus && (
        <ValueFlash value={effectiveVersionStatus.key} mode="text">
          <StatusChip label={effectiveVersionStatus.label} tone={effectiveVersionStatus.tone} />
        </ValueFlash>
      )}
      {buildInfo && (
        <StatusChip label={`构建：${buildInfo.label}`} tone={buildTone} />
      )}
      {draft?.appVersion && storeLiveVersion && (
        storeLiveVersion === draft.appVersion ? (
          <span className="text-[10px] text-emerald-600 dark:text-emerald-500">
            商店版本一致
          </span>
        ) : (
          <span className="text-[10px] text-amber-600 dark:text-amber-500">
            商店 v{storeLiveVersion} ≠ 目标 v{draft.appVersion}
          </span>
        )
      )}
    </>
  ) : null;
  const storeActions = (
    <>
      {draft && (
        <button
          type="button"
          onClick={() => void handleAlignmentCheck()}
          disabled={aligning}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-sky-300 dark:border-sky-700 text-[11px] font-medium text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-500/10 transition-colors disabled:opacity-50"
          title="把本地文案与商店实际文案逐语言比对（有 ASC 凭证时完整字段；否则公开商店的描述/新增内容）"
        >
          <AppleIcon className="w-3 h-3" />
          {aligning ? "校验中…" : "校验与商店对齐"}
        </button>
      )}
      {effectiveVersionStatus?.key === "ready-for-sale" && !storeAligned && (
        <button
          type="button"
          onClick={() => void handleRebuildFromStore()}
          disabled={rebuilding}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-sky-300 dark:border-sky-700 text-[11px] font-medium text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-500/10 transition-colors disabled:opacity-50"
          title="从 App Store 回读完整文案，重建本地丢失的文案"
        >
          <AppleIcon className="w-3 h-3" />
          {rebuilding ? "重建中…" : "根据此版本重建文案"}
        </button>
      )}
    </>
  );
  const alerts =
    effectiveVersionStatus?.key === "not-in-asc" ||
    (effectiveVersionStatus?.key === "unknown" && effectiveVersionStatus.source === "none") ||
    effectiveVersionStatus?.key === "ready-for-sale" ? (
    <>
      {effectiveVersionStatus?.key === "not-in-asc" && (
        <span className="text-[11px] text-amber-600 dark:text-amber-500">
          App Store 中未找到版本 {draft?.appVersion}，提交前请确认已在 App Store Connect 创建该版本。
        </span>
      )}
      {effectiveVersionStatus?.key === "unknown" && effectiveVersionStatus.source === "none" && (
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
          配置 App Store 凭证后可自动校验版本是否提交/审核/上架。
        </span>
      )}
      {effectiveVersionStatus?.key === "ready-for-sale" && (
        <>
          {release?.githubDraft === true && (
            <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-500">
              商店已上架，可前往 GitHub 发布正式公告
              {release?.url && (
                <button
                  type="button"
                  onClick={() => (window as any).appilot?.openExternal?.(release.url)}
                  className="underline hover:opacity-70"
                >
                  打开
                </button>
              )}
            </span>
          )}
          {draft?.ascSyncedAt && (
            <span className="text-[11px] text-emerald-600 dark:text-emerald-500">
              已按商店实际文案冻结 · {formatHumanTime(draft.ascSyncedAt)}
            </span>
          )}
          {draft?.storeSyncedAt && !draft?.ascSyncedAt && (
            <span className="text-[11px] text-emerald-600 dark:text-emerald-500">
              已按商店公开信息部分冻结（描述/新增内容）· {formatHumanTime(draft.storeSyncedAt)}
            </span>
          )}
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
            README 或需同步更新
          </span>
        </>
      )}
    </>
  ) : null;
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
  const isReadOnly =
    versionLocked ||
    batchConfirmed ||
    (masterConfirmed && activeLocalization?.language === primaryLanguage);
  const busy = generating || loadingDraft;
  // 侧边栏「文案草案」区块的素材始终属于工作目标（最新未定稿发布）；
  // 工作视图下 selectedRelease 即工作目标，其它视图下也以工作目标为准。
  const summaryMaterial = workTargetRelease?.material || selectedRelease?.material || null;
  const summaryItems: ChangeSummaryItem[] = summaryMaterial
    ? summarizeChanges(summaryMaterial)
    : [];
  // 代码更新按时间顺序排列（各组以其最早提交时间排序）。
  const sortedSummaryItems = [...summaryItems].sort(
    (a, b) =>
      Date.parse(a.date || a.commits[0]?.date || "0") -
      Date.parse(b.date || b.commits[0]?.date || "0"),
  );
  const summaryPrCount = summaryItems.filter((item) => item.github).length;
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
  // 变更摘要勾选仅在工作视图中可交互；其它视图只读展示工作目标的素材。
  const summaryEditable = viewMode === "working";
  const previousDraft =
    (releaseContext?.drafts || []).find((item: any) => item.releaseTag !== selectedTag) || null;
  const saveCurrentDraftIfAny = () => {
    if (active?.draft && project?.id) void persistCurrentDraft();
  };

  // 发布选择：优先找与文案版本号一致的发布。文案的 releaseTag 可能是旧版本
  // 生成时的遗留（例如 appVersion 1.1.1 但 releaseTag v1.1.0），直接用它会让
  // 流程图显示错误的发布。
  const releaseTagForVersion = (appVersion: any, list: any[] = releases) => {
    const version = String(appVersion || "").replace(/^v/i, "").trim();
    if (!version) return "";
    const match = list.find((r: any) => {
      const t = String(r?.tag || "").replace(/^v/i, "").trim();
      return Boolean(t) && t === version;
    });
    return match?.tag || "";
  };

  // 打开工作中的文案（或进入新建）：左侧「最新文案草案」主入口。
  const switchToWorking = () => {
    saveCurrentDraftIfAny();
    setShowChecklist(false);
    setViewMode("working");
    setHistoryDraft(null);
    if (workTargetRelease) {
      // 已有草案时立即进入载入态，避免切换瞬间闪现「尚未生成文案」。
      if (workingDraft) setLoadingDraft(true);
      setActive(null);
      setStep(workingDraft ? 2 : 1);
      if (workTargetRelease.tag !== selectedTag) {
        setSelectedTag(workTargetRelease.tag);
      }
    }
  };

  // 打开最新文案（当前正式文案，只读）。
  const switchToCurrent = () => {
    saveCurrentDraftIfAny();
    setShowChecklist(false);
    setViewMode("current");
    setHistoryDraft(null);
    if (currentCopy) {
      setLoadingDraft(true);
      setActive(null);
      setStep(2);
      const targetTag = releaseTagForVersion(currentCopy.appVersion) || currentCopy.releaseTag;
      if (targetTag !== selectedTag) {
        setSelectedTag(targetTag);
      }
    }
  };

  // 查看历史文案（只读）。
  const handleSelectHistory = (item: any) => {
    if (!item) return;
    saveCurrentDraftIfAny();
    setShowChecklist(false);
    setViewMode("history");
    setHistoryDraft(item);
    setActive(null);
    const targetTag = releaseTagForVersion(item?.appVersion) || item?.releaseTag || "";
    if (targetTag && targetTag !== selectedTag) {
      setSelectedTag(targetTag);
    }
  };

  // 从历史查看返回工作台：回到工作目标或当前文案。
  const handleBackFromHistory = () => {
    setHistoryDraft(null);
    if (hasWork) switchToWorking();
    else switchToCurrent();
  };

  // 新建文案草案：若存在被超越的未完成草案，先确认是否顶替删除。
  const handleCreateNew = async () => {
    if (!project?.id) return;
    if (supersededUnconfirmedDrafts.length > 0) {
      if (!window.confirm("已有之前的工作中的文案，是否替代？不替代将保持原样。")) return;
      try {
        for (const draftItem of supersededUnconfirmedDrafts) {
          await (window as any).appilot.release.deleteDraft(project.id, draftItem.id);
        }
        await loadReleases(false, false);
      } catch (e: any) {
        setError(e.message || "删除旧文案失败。");
        return;
      }
    }
    switchToWorking();
  };

  // 左侧主入口按钮：点击哪个就显示哪份文案；选中的按钮实心橙色，
  // 其余为空心橙色描边，两者尺寸与层级保持一致。
  const entryBtnActive = (active: boolean) =>
    cn(
      "w-full text-left rounded-xl px-5 py-4 shadow-sm transition-colors",
      active
        ? "bg-amber-500 text-white"
        : "border border-amber-500/70 bg-transparent text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10",
    );
  const entryTextActive = (active: boolean) =>
    cn(
      "text-sm font-semibold",
      active
        ? "text-white"
        : "text-amber-600 dark:text-amber-400",
    );
  const entrySubActive = (active: boolean) =>
    cn(
      "block text-[11px] mt-0.5 truncate",
      active
        ? "text-white/80"
        : "text-amber-600/70 dark:text-amber-400/70",
    );
  // 字段长度计数：接近上限变黄、到上限变红。
  const charCounterClass = (len: number, max: number) =>
    cn(
      "text-[11px] px-1",
      len >= max
        ? "text-red-500"
        : len >= max * 0.9
          ? "text-amber-600/90 dark:text-amber-500/90"
          : "text-zinc-400 dark:text-zinc-500",
    );

  const handleDeleteDraft = async (target: any) => {
    if (!project?.id || !target?.id) return;
    const label = target.appVersion
      ? `v${String(target.appVersion).replace(/^v/i, "")}`
      : target.releaseTag || "该文案";
    if (!window.confirm(`删除文案 ${label}？该操作不可恢复。`)) return;
    try {
      const ok = await (window as any).appilot.release.deleteDraft(project.id, target.id);
      if (!ok) return;
      if (historyDraft?.id === target.id) setHistoryDraft(null);
      if (active?.draft?.id === target.id) setActive(null);
      await loadReleases(false);
    } catch (e: any) {
      setError(e.message || "删除文案失败。");
    }
  };

  const handleRebuildFromStore = async () => {
    if (!project?.id || !productId || !selectedTag || rebuilding) return;
    if (!window.confirm("将用商店实际文案替换本地该版本文案（按版本覆盖），是否继续？")) return;
    setRebuilding(true);
    setError("");
    try {
      const rebuilt = await (window as any).appilot.release.rebuildFromStore(
        project.id,
        productId,
        selectedTag,
      );
      if (!rebuilt?.id) throw new Error("重建失败");
      setActive(null);
      setHistoryDraft(null);
      await loadReleases(false);
    } catch (e: any) {
      setError(e.message || "从商店重建文案失败。");
    } finally {
      setRebuilding(false);
    }
  };

  const handleAlignmentCheck = async () => {
    if (!project?.id || !productId || !selectedTag || !draft || aligning) return;
    setAligning(true);
    setError("");
    try {
      const result = await (window as any).appilot.alignment.check(
        project.id,
        productId,
        draft.releaseTag,
      );
      setAlignment(result || null);
    } catch (e: any) {
      setError(e.message || "对齐校验失败。");
    } finally {
      setAligning(false);
    }
  };

  const handleAlignmentApply = async () => {
    if (!project?.id || !productId || !draft || applyingAlignment) return;
    setApplyingAlignment(true);
    setError("");
    try {
      const result = await (window as any).appilot.alignment.apply(
        project.id,
        productId,
        draft.releaseTag,
      );
      setAlignment(result || null);
      if (result?.applied) {
        setActive(null);
        setHistoryDraft(null);
        await loadReleases(false);
      }
    } catch (e: any) {
      setError(e.message || "应用商店文案失败。");
    } finally {
      setApplyingAlignment(false);
    }
  };

  const checklist = (project as any).preReleaseChecklist || null;

  const handleGenerateChecklist = async () => {
    if (!productId || generatingChecklist) return;
    setGeneratingChecklist(true);
    setError("");
    try {
      await (window as any).appilot.projects.generatePreReleaseChecklist(productId);
      await useProject.getState().load();
      setShowChecklist(true);
    } catch (e: any) {
      setError(e.message || "生成发布前检查单失败。");
    } finally {
      setGeneratingChecklist(false);
    }
  };

  const latestCodeDate = summaryMaterial?.commits?.[0]?.date || "";
  const fixedMaterialRows = (() => {
    const rows: {
      label: string;
      meta: ReactNode;
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
      label: "历次发布公告与文案",
      meta:
        historyDrafts.length > 0
          ? `最近 ${historyDrafts.length} 份${historyDrafts[0]?.appVersion ? `（最新 v${String(historyDrafts[0].appVersion).replace(/^v/i, "")}）` : ""}`
          : "无",
    });
    const activeKeywordCount = ((project as any)?.trackedKeywords || []).filter(
      (keyword: any) => keyword.status !== "paused",
    ).length;
    rows.push({
      label: "跟踪关键词与排名",
      meta: activeKeywordCount > 0 ? `${activeKeywordCount} 个关键词` : "无",
    });
    const copyGaps = releaseContext?.copyGapKeywords || [];
    if (copyGaps.length > 0) {
      rows.push({
        label: "文案缺口关键词",
        meta: (
          <>
            {copyGaps.length} 个：
            {copyGaps.slice(0, 8).map((item: any, index: number) => (
              <span key={`${item.language}:${item.keyword}`}>
                {index > 0 && "、"}
                <KeywordRuby
                  keyword={item.keyword}
                  translation={item.translation}
                  annotate={
                    item.language !== "zh-Hans" && item.language !== "zh-Hant"
                  }
                />
              </span>
            ))}
            {copyGaps.length > 8 ? "…" : ""}
          </>
        ),
      });
    }
    // 固定素材里的发布公告优先用“最新发布”的公告，而不是当前选中版本
    // 的（当前文案可能对应较早的 tag，但 AI 需要参考最新公告内容）。
    const githubRelease =
      latestRelease?.material?.githubRelease || summaryMaterial?.githubRelease;
    if (githubRelease) {
      rows.push({
        label: "GitHub 发布公告",
        meta: `${githubRelease.name || "发布正文"}${githubRelease.publishedAt ? ` · ${formatHumanTime(githubRelease.publishedAt)}` : ""}`,
        badge: "github",
        badgeTitle: githubRelease.viaToken
          ? "发布公告来自 GitHub（通过 Token 获取，支持私有仓库与发布草案）"
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
    const items = summaryMaterial ? summarizeChanges(summaryMaterial) : [];
    // 勾选清单存在工作目标的草案上；工作视图打开时 draft === workingDraft。
    const stored = workingDraft?.summaryChecklist;
    setSummaryChecked(
      new Set(stored && stored.length > 0 ? stored : items.map((item) => item.id)),
    );
  }, [workingDraft?.id, workTargetRelease?.tag, summaryMaterial]);

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
    const operationId = crypto.randomUUID();
    if (force) {
      setGenerateOpId(operationId);
      setGenerating(true);
      setGenerationProgress(null);
      setGenerateFailed(false);
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
        draftVersionHint || undefined,
        summaryItems
          .filter((item) => summaryChecked.has(item.id))
          .map((item) => item.title),
        operationId,
      );
      setActive(next);
      setStep(2);
    } catch (e: any) {
      if (String(e?.message || "").includes("已取消")) {
        // 用户主动停止：不算错误，静默清理。
      } else {
        setError(e.message || "发布工作单加载失败。");
        if (force) setGenerateFailed(true);
      }
    } finally {
      setGenerateOpId("");
      setRetrying(false);
      setGenerating(false);
      setLoadingDraft(false);
    }
  };

  const stopTranslate = () => {
    if (translateOpId) void (window as any).appilot?.ai?.cancel(translateOpId);
  };

  const stopGenerate = () => {
    if (generateOpId) void (window as any).appilot?.ai?.cancel(generateOpId);
  };

  const handleProductChange = async (value: string) => {
    setProductId(value);
    selectProduct(value);
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
    if (!masterConfirmed || batchConfirmed || feedbackReadOnly) return;
    // 重新翻译会覆盖已有内容，需要确认。
    if (localizations.some((item: any) => item.language === language)) {
      if (!window.confirm("将覆盖该语言的现有文案，是否继续？")) return;
    }

    const operationId = crypto.randomUUID();
    translatingRef.current.add(language);
    setTranslatingLanguages((prev) => new Set(prev).add(language));
    setTranslateOpId(operationId);
    setFailedTranslation("");
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
        operationId,
      );
      setActive((prev: any) => ({ ...prev, draft: next }));
      setActiveLanguage(language);
    } catch (e: any) {
      if (String(e?.message || "").includes("已取消")) {
        // 用户主动停止：不算错误，静默清理。
      } else {
        setError(e.message || `${languageLabel(language)} 翻译失败。`);
        setFailedTranslation(language);
      }
    } finally {
      translatingRef.current.delete(language);
      setTranslatingLanguages((prev) => {
        const next = new Set(prev);
        next.delete(language);
        return next;
      });
      setTranslateOpId("");
      setRetrying(false);
    }
  };

  useEffect(() => {
    if (viewMode !== "history" && !draft && selectedExistingDraft && selectedRelease?.draft && project && selectedTag) {
      void handleLoad(false);
    } else if (!draft && (viewMode === "working" || viewMode === "current")) {
      // 视图切换后目标没有可加载的草案（如发布列表尚未包含新建草案）时，
      // 结束载入态，避免一直停在「正在载入文案…」。
      setLoadingDraft(false);
    }
  }, [draft?.id, selectedExistingDraft?.id, project?.id, selectedTag, viewMode]);

  // 工作中的文案整批确定后，它就成为「最新文案」——视图随之切换。
  useEffect(() => {
    if (viewMode === "working" && draft?.batchConfirmedAt) {
      setViewMode("current");
    }
  }, [draft?.batchConfirmedAt, viewMode]);

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
              source={project.githubSource}
            />
            <CredentialBadge
              kind="asc"
              enabled={Boolean(project.hasAscKey)}
              projectId={project.id}
              source={project.ascSource}
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
            desc="有新提交、GitHub 发布草案（需配置 GitHub Token，Contents 只读权限）或创建新 tag 后，这里会自动生成发布文案素材。"
          />
        )
      ) : (
        <>
        <div className="mb-6">
          <ReleaseReadinessPanel
            projectId={project.id}
            productId={productId}
            draft={draft ? { id: draft.id, releaseTag: draft.releaseTag } : null}
            githubNode={githubNode}
            copyNode={copyNode}
            storeNode={storeNode}
            alerts={alerts}
            storeActions={storeActions}
            onAscRefresh={handleAscRefresh}
            ascRefreshing={ascRefreshing}
            ascInfo={ascInfo}
            onCheckGithub={() => void loadReleases(true)}
            checkingGithub={checking}
            githubWarning={githubWarning}
            onToggleChecklist={
              hasNewWork
                ? () => setShowChecklist((value) => !value)
                : undefined
            }
            checklistOpen={showChecklist}
          />
        </div>
        {alignment && (
          <div className="mb-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  与商店对齐
                </h4>
                <StatusChip
                  label={
                    alignment.mode === "asc"
                      ? "ASC 完整比对"
                      : "公开商店部分比对"
                  }
                  tone={alignment.mode === "asc" ? "blue" : "amber"}
                />
              </div>
              <button
                type="button"
                onClick={() => setAlignment(null)}
                className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                关闭
              </button>
            </div>
            <div className="p-4">
              {!alignment.versionMatched ? (
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  商店当前版本与目标版本不一致，无法核对（可先检查 App Store 版本刷新）。
                </p>
              ) : alignment.diffs.length === 0 ? (
                <p className="text-xs text-emerald-600 dark:text-emerald-500">
                  {alignment.applied ? "已应用商店文案。" : "本地文案与商店实际文案一致。"}
                </p>
              ) : (
                <>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                    发现 {alignment.diffs.length} 处差异（
                    {alignment.mode === "asc" ? "完整字段" : "描述 / 新增内容"}）：
                  </p>
                  <div className="max-h-72 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-800">
                    {alignment.diffs.map((diff, index) => (
                      <div key={`${diff.language}:${diff.field}:${index}`} className="px-3 py-2">
                        <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                          {languageLabel(diff.language)} ·{" "}
                          {ALIGNMENT_FIELD_LABEL[diff.field] || diff.field}
                        </p>
                        <p className="text-[11px] mt-0.5 text-zinc-500 dark:text-zinc-400 line-clamp-3">
                          <span className="text-zinc-400 dark:text-zinc-500">本地：</span>
                          {diff.local || "（空）"}
                        </p>
                        <p className="text-[11px] text-emerald-700 dark:text-emerald-400 line-clamp-3">
                          <span className="text-emerald-600/70 dark:text-emerald-500/70">商店：</span>
                          {diff.store || "（空）"}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleAlignmentApply()}
                      disabled={applyingAlignment}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
                    >
                      {applyingAlignment ? "应用中…" : "应用商店版本"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAlignment(null)}
                      className="inline-flex items-center px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 transition-colors"
                    >
                      保留本地
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] items-start">
          <aside className="min-w-0 space-y-4">
            {/* 区块1：最新文案草案（工作目标）。新建/打开与「最新文案」同级同风格。 */}
            {step <= 2 && releaseContext && hasWork && (
              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
                <div className="p-4">
                  <button
                    type="button"
                    onClick={() =>
                      workingDraft ? switchToWorking() : void handleCreateNew()
                    }
                    className={entryBtnActive(viewMode === "working")}
                  >
                    <span
                      className="flex items-center justify-between gap-2"
                    >
                      <span className={entryTextActive(viewMode === "working")}>
                        <span className="inline-flex items-center gap-1.5">
                          文案草案
                          {workingDraft && (
                            <span className="opacity-70">（工作中）</span>
                          )}
                        </span>
                      </span>
                    </span>
                    <span
                      className={entrySubActive(viewMode === "working")}
                    >
                      {workingDraft
                        ? `${draftVersionLabel(workingDraft)} · ${formatHumanTime(workingDraft.updatedAt)}`
                        : workTargetRelease?.name
                          ? `尚无草案，点击新建 · ${workTargetRelease.name}`
                          : "尚无草案，点击新建"}
                    </span>
                  </button>
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
                    defaultOpen={false}
                  >
                    {(previousDraft || latestCodeDate) && (
                      <div className="mb-2 flex items-center justify-between gap-2 text-[10px] text-zinc-400 dark:text-zinc-500">
                        <div className="space-y-0.5">
                          {previousDraft && (
                            <p>
                              上一次文案：{draftVersionLabel(previousDraft)} ·{" "}
                              {formatHumanTime(previousDraft.updatedAt)} 生成
                            </p>
                          )}
                          {latestCodeDate && (
                            <p>最新代码更新：{formatHumanTime(latestCodeDate)}</p>
                          )}
                        </div>
                        {summaryItems.length > 0 && (
                          <span
                            role="checkbox"
                            aria-checked={checkedCount === summaryItems.length}
                            tabIndex={0}
                            onClick={() => {
                              if (summaryEditable) {
                                void setAllSummaryChecked(
                                  checkedCount < summaryItems.length,
                                );
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                if (summaryEditable) {
                                  void setAllSummaryChecked(
                                    checkedCount < summaryItems.length,
                                  );
                                }
                              }
                            }}
                            title={
                              summaryEditable
                                ? checkedCount === summaryItems.length
                                  ? "取消全选"
                                  : "全部选择"
                                : "切换到工作视图后可调整素材范围"
                            }
                            className={cn(
                              "mt-0.5 w-4 h-4 shrink-0 rounded border flex items-center justify-center text-[10px] transition-colors",
                              summaryEditable ? "cursor-pointer" : "cursor-not-allowed opacity-60",
                              checkedCount === summaryItems.length
                                ? "bg-amber-500 border-amber-500 text-white"
                                : "border-zinc-300 dark:border-zinc-600",
                            )}
                          >
                            {checkedCount === summaryItems.length ? "✓" : ""}
                          </span>
                        )}
                      </div>
                    )}
                    {summaryItems.length === 0 ? (
                      <p className="text-sm text-zinc-400 dark:text-zinc-500">本次无变更</p>
                    ) : (
                      <>
                        <div className="space-y-1">
                          {sortedSummaryItems.map((item) => {
                            const included = summaryChecked.has(item.id);
                            const tone = CHANGE_TYPE_META[item.type].tone;
                            const latestDate = item.date || item.commits[0]?.date || "";
                            const subLine = item.github
                              ? `#${item.prNumber || ""} · ${item.commitCount ?? item.commits.length} 次提交${latestDate ? ` · ${formatHumanTime(latestDate)}` : ""}`
                              : `${item.commitCount ?? item.commits.length} 条提交${latestDate ? ` · 最新 ${formatHumanTime(latestDate)}` : ""}`;
                            return (
                              <div
                                key={item.id}
                                className={cn(
                                  "w-full flex items-center gap-2.5 py-1.5 rounded-lg",
                                  !included && "opacity-55",
                                )}
                              >
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
                                  role="checkbox"
                                  aria-checked={included}
                                  tabIndex={0}
                                  onClick={() => {
                                    if (summaryEditable) void toggleSummaryItem(item.id);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      if (summaryEditable) void toggleSummaryItem(item.id);
                                    }
                                  }}
                                  title={
                                    summaryEditable
                                      ? included
                                        ? "从 AI 素材中排除"
                                        : "作为 AI 素材提供"
                                      : "切换到工作视图后可调整素材范围"
                                  }
                                  className={cn(
                                    "mt-0.5 w-4 h-4 shrink-0 rounded border flex items-center justify-center text-[10px] transition-colors",
                                    summaryEditable
                                      ? "cursor-pointer"
                                      : "cursor-not-allowed opacity-60",
                                    included
                                      ? "bg-amber-500 border-amber-500 text-white"
                                      : "border-zinc-300 dark:border-zinc-600",
                                  )}
                                >
                                  {included ? "✓" : ""}
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

                  {contextLoading ? (
                    <div className="px-5 py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">
                      正在载入发布参考…
                    </div>
                  ) : releaseContext ? (
                    <>
                      <ReferenceSection title="固定素材" meta="始终发送给 AI" defaultOpen={false}>
                        <ul className="space-y-1.5">
                          {fixedMaterialRows.map((row) => (
                            <li
                              key={row.label}
                              className="flex items-center gap-2.5 py-1.5 rounded-lg bg-zinc-50/60 dark:bg-zinc-800/30"
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
                              <span
                                title="固定素材始终发送给 AI"
                                className="w-4 h-4 shrink-0 rounded border border-zinc-400 dark:border-zinc-500 bg-zinc-400/70 dark:bg-zinc-500/70 flex items-center justify-center text-[10px] text-white select-none"
                              >
                                ✓
                              </span>
                            </li>
                          ))}
                        </ul>
                        <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
                          这些素材无需逐项查看；如需调整素材范围，可在上方变更摘要中取消对应条目。
                        </p>
                      </ReferenceSection>
                    </>
                  ) : null}
                </div>
                )}
              </div>
            )}
            {/* 区块2：最新文案（当前正式文案）。 */}
            {step <= 2 && releaseContext && currentCopy && (
              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
                <div className="p-4">
                  <button
                    type="button"
                    onClick={switchToCurrent}
                    className={entryBtnActive(viewMode === "current")}
                  >
                    <span
                      className="flex items-center justify-between gap-2"
                    >
                      <span className={entryTextActive(viewMode === "current")}>
                        <span className="inline-flex items-center gap-1.5">
                          最新文案
                          {currentCopy?.ascSyncedAt && <AppleIcon className="w-3 h-3" />}
                        </span>
                      </span>
                    </span>
                    <span
                      className={entrySubActive(viewMode === "current")}
                    >
                      {`${draftVersionLabel(currentCopy)} · ${(currentCopy.localizations || []).filter(
                        (item: any) => item?.language,
                      ).length} 语言 · ${formatHumanTime(currentCopy.updatedAt)}`}
                    </span>
                  </button>
                </div>
              </div>
            )}
            {/* 区块3：历史文案。 */}
            {step <= 2 && releaseContext && (
              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
                <HistoryPanel
                  drafts={(releaseContext.drafts || []).filter(
                    (item: any) =>
                      item.id !== currentCopy?.id && item.id !== workingDraft?.id,
                  )}
                  selectedDraft={historyDraft}
                  onSelect={handleSelectHistory}
                  currentTag={viewMode === "current" ? currentCopy?.releaseTag : ""}
                  onDelete={(item: any) => void handleDeleteDraft(item)}
                />
              </div>
            )}
          </aside>

          <div className="min-w-0 space-y-6">
            {showChecklist ? (
              <PreReleaseChecklistPanel
                checklist={checklist}
                running={generatingChecklist}
                onRun={() => void handleGenerateChecklist()}
              />
            ) : historyDraft ? (
              <HistoryViewer
                draft={historyDraft}
                productTrackName={selectedProduct?.trackName}
                onBack={handleBackFromHistory}
              />
            ) : (
              <>
            {selectedRelease && step === 1 && (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold tracking-wider text-zinc-400 dark:text-zinc-500 shrink-0">
                    目标版本
                  </span>
                  <input
                    value={draftVersionHint}
                    onChange={(e) => {
                      if (draft) updateDraftField("appVersion", e.target.value);
                      else setPendingVersion(e.target.value);
                    }}
                    onBlur={() => void persistCurrentDraft()}
                    placeholder="如 1.2.6"
                    disabled={Boolean(draft) && (batchConfirmed || versionLocked)}
                    className={inputLineClass + " max-w-32"}
                  />
                  <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                    {draft ? "文案将按此版本标识" : "生成文案时将写入此版本"}
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

                {!versionLocked && !draft && (
                  <AIProgressButton
                    onStart={() => handleLoad(true)}
                    onStop={stopGenerate}
                    disabled={busy && !generating}
                    loading={generating}
                    progress={generationProgress}
                    idleLabel={summaryItems.length > 0 ? "下一步：生成文案" : "新建文案"}
                    retry={generateFailed}
                    retrying={retrying}
                  />
                )}

                {released && selectedExistingDraft && (
                  <button onClick={() => handleLoad(false)} disabled={busy} className="px-4 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60">
                    {loadingDraft ? "加载中..." : "查看文案"}
                  </button>
                )}
              </>
            )}

            {!draft ? (
              loadingDraft ? (
                <div className="py-16 text-center text-sm text-zinc-400 dark:text-zinc-500">
                  正在载入文案…
                </div>
              ) : selectedRelease && step > 1 ? (
                <EmptyState
                  title="尚未生成文案"
                  desc="可基于变更素材生成，也可以在无变更时从头新建文案。"
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
                    <ValueFlash value={draft.appVersion || ""} mode="input">
                      <input
                        value={draft.appVersion || ""}
                        onChange={(e) => updateDraftField("appVersion", e.target.value)}
                        onBlur={() => void persistCurrentDraft()}
                        placeholder="如 1.2.6"
                        disabled={batchConfirmed || versionLocked}
                        className={inputLineClass + " max-w-32"}
                      />
                    </ValueFlash>
                    <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                      确定文案前需填写
                    </span>
                  </div>
                  {/* 选项卡：内容页顶部放一个两边缩进、无边框的白底矩形，
                      盖住内容页顶边线（两侧圆角仍可见）；语言标签在该矩形内滚动。 */}
                  <div>
                  <div className="tab-scrollbar mx-3 -mb-px z-10 bg-white dark:bg-zinc-900 overflow-x-auto">
                    <div className="flex w-fit gap-0.5 px-1 pt-2 pb-1.5">
                      {tabLanguages.map((language) => {
                        const generated = localizations.some((item: any) => item.language === language);
                        const translating = translatingLanguages.has(language);
                        return (
                          <button
                            key={language}
                            type="button"
                            onClick={() => setActiveLanguage(language)}
                            title={
                              generated
                                ? `${languageLabel(language)}文案`
                                : translating
                                  ? `${languageLabel(language)}翻译进行中`
                                  : `${languageLabel(language)}尚未翻译`
                            }
                            className={cn(
                              "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-t-md shrink-0 whitespace-nowrap transition-colors",
                              activeLanguage === language
                                ? "border-zinc-300 dark:border-zinc-700 border-b-0 bg-white dark:bg-zinc-900 text-amber-700 dark:text-amber-400 font-medium"
                                : "border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700",
                            )}
                          >
                            {language === UI_SOURCE_LANGUAGE ? (
                              <span
                                className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"
                                title="界面语言（简体中文）"
                              />
                            ) : language === "en" ? (
                              <span
                                className="w-1.5 h-1.5 rounded-full bg-sky-500 shrink-0"
                                title="英文"
                              />
                            ) : null}
                            {languageLabel(language)}
                            {translating && (
                              <span className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
                            )}
                            {generated && !translating && (
                              <span className="text-emerald-500">✓</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {/* 内容页（圆角矩形）：上边缘被标签栏压住 */}
                  <div className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden">
                  <div className="p-4 space-y-4">
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
                              placeholder={selectedProduct?.trackName || "未设置名称"}
                              maxLength={30}
                            />
                            {!activeLocalization.name && (
                              <p className="text-[11px] text-amber-600/80 dark:text-amber-500/70 px-1">
                                名称未设置，商店当前显示 App 级名称：{selectedProduct?.trackName || "—"}
                              </p>
                            )}
                            <p className="text-[11px] text-amber-600/80 dark:text-amber-500/70 px-1">
                              建议：名称后加冒号和描述性短句（如 GloWalk: Path of Light）
                            </p>
                            <p className={charCounterClass((activeLocalization.name || "").length, 30)}>
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
                              placeholder={activeLocalization.name ? "未设置副标题" : "未设置副标题"}
                              maxLength={30}
                            />
                            {!activeLocalization.subtitle && (
                              <p className="text-[11px] text-amber-600/80 dark:text-amber-500/70 px-1">
                                副标题未设置
                              </p>
                            )}
                            <p className={charCounterClass((activeLocalization.subtitle || "").length, 30)}>
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
                            maxLength={170}
                          />
                          <p className={charCounterClass(activeLocalization.promotionalText.length, 170)}>
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
                            maxLength={4000}
                          />
                          <p className={charCounterClass(activeLocalization.description.length, 4000)}>
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
                            maxLength={4000}
                          />
                          <p className={charCounterClass(activeLocalization.whatsNew.length, 4000)}>
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
                            maxLength={100}
                          />
                          <p className={charCounterClass(activeLocalization.keywords.length, 100)}>
                            {activeLocalization.keywords.length}/100 字符
                          </p>
                        </div>
                      </div>
                    </>
                  )}
                  {/* 内容页内：当前语言页的翻译按钮（母本页无）——
                      未翻译显示「翻译为 X语」，翻译完成后保留为「重新翻译」
                      （覆盖前需确认）；运行中可停止。 */}
                  {activeLanguage !== primaryLanguage &&
                    (masterConfirmed ? (
                      <div className="flex items-center gap-3 flex-wrap">
                        <AIProgressButton
                          onStart={() => void handleTranslateOne(activeLanguage)}
                          onStop={stopTranslate}
                          loading={translatingLanguages.has(activeLanguage)}
                          progress={generationProgress}
                          disabled={
                            translatingLanguages.size > 0 &&
                            !translatingLanguages.has(activeLanguage)
                          }
                          idleLabel={
                            localizations.some(
                              (item: any) => item.language === activeLanguage,
                            )
                              ? "重新翻译"
                              : `翻译为${languageLabel(activeLanguage)}`
                          }
                          retry={failedTranslation === activeLanguage}
                          retrying={retrying}
                        />
                        {translatingLanguages.size > 0 &&
                          !translatingLanguages.has(activeLanguage) && (
                            <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                              已有翻译进行中，请稍候
                            </span>
                          )}
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-400 dark:text-zinc-500">
                        先确定母本语言，再翻译其他语言。
                      </p>
                    ))}
                  {activeLocalization === null &&
                    activeLanguage !== primaryLanguage && (
                      <p className="text-xs text-amber-600/80 dark:text-amber-500/70">
                        该语言尚未翻译。
                      </p>
                    )}
                  </div>
                  </div>
                  </div>
                  {/* 选项卡页面结束；下方为整份文案级操作 */}
                  <div className="border-t border-zinc-100 dark:border-zinc-800 pt-5 space-y-4">

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

                    {batchConfirmed && !versionLocked && (
                      <div className="flex justify-end">
                        <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                          文案已确定
                        </span>
                      </div>
                    )}
                    {versionLocked && batchConfirmed && (
                      <div className="flex justify-end">
                        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                          已上架，完全只读
                        </span>
                      </div>
                    )}
                  </div>

                  <FieldBlock label="驳回意见 / 我的修改意见（重新生成时作为上下文）">
                    <textarea
                      value={draft.reviewFeedback || ""}
                      onChange={(e) => updateDraftField("reviewFeedback", e.target.value)}
                      disabled={versionLocked}
                      className={inputClass + " min-h-20 resize-y"}
                    />
                    {!versionLocked && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <AIProgressButton
                          onStart={() => handleLoad(true)}
                          onStop={stopGenerate}
                          disabled={busy && !generating}
                          loading={generating}
                          progress={generationProgress}
                          idleLabel="重新生成"
                          retry={generateFailed}
                          retrying={retrying}
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
        </>
      )}
    </div>
  );
}

/* ── Keywords (tracking vs submission, one AI request per language) ── */
