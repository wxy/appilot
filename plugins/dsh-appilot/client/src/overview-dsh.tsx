/**
 * DSH 侧总览包装：把 appilot_overview 工具结果映射成 Electron Project/StoreProduct
 * 形状，渲染共享组件 OverviewContent（同一套 UI）。
 *
 * - Link：DSH 无路由，用 DshLink（外观一致、点击无导航）。
 * - 暗色：宿主 `body[data-ds-dark-theme]` → 给 OverviewContent 加 `.dark` 祖先
 *   （Electron 的 tailwind `dark:` 变体依赖 `.dark` class）。
 * - 样式：`OVERVIEW_TAILWIND_CSS`（scoped 构建：preflight 关闭），随本模块注入。
 */
import { useEffect, useState } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { OverviewContent } from '../../../../src/renderer/components/overview/OverviewContent';
import type { Project, StoreProduct } from '../../../../src/renderer/stores/project';
import { resultOf } from './helpers';
import { OVERVIEW_TAILWIND_CSS, OVERVIEW_CSS_ID } from './generated/tailwind-css';

/* ── 样式注入（tailwind 工具类，仅本页使用；宿主用独立哈希类，无冲突）── */
if (
  typeof document !== 'undefined' &&
  !document.querySelector(`style[data-plugin-css="${OVERVIEW_CSS_ID}"]`)
) {
  const style = document.createElement('style');
  style.dataset.plugin = '@appilot-labs/appilot';
  style.dataset.pluginCss = OVERVIEW_CSS_ID;
  style.textContent = OVERVIEW_TAILWIND_CSS;
  document.head.appendChild(style);
}

/** DSH 轻量 Link：保持外观，点击不导航。 */
function DshLink(props: any) {
  return jsx('a', {
    href: '#',
    className: props.className,
    title: 'DSH 内暂不可用（Electron 应用中可跳转）',
    onClick: (e: any) => e.preventDefault(),
    children: props.children,
  });
}

function isHostDark(): boolean {
  return (
    typeof document !== 'undefined' &&
    !!document.body &&
    document.body.dataset.dsDarkTheme !== undefined
  );
}

/** 把 appilot_overview 的值映射成 Electron Project 形状（空字段保持空态）。 */
function mapOverviewToProject(v: any, fallbackPath: string | null): {
  project: Project;
  product: StoreProduct;
  releaseOverview: { draft: { name: string | null; tag: string; publishedAt: string; commitCount: number } | null; submission: any | null };
} {
  const name = v?.name || (fallbackPath ? fallbackPath.split(/[/\\]/).pop() || fallbackPath : 'Appilot 项目');
  const path = v?.path || fallbackPath || '';
  const platform: 'ios' | 'macos' | 'unknown' =
    v?.platform === 'ios' || v?.platform === 'macos' ? v.platform : 'unknown';
  const languages: { code: string; name: string }[] = (v?.languages || []).map((code: string) => ({
    code,
    name: code,
  }));
  const repo = v?.repo || {};
  const store = v?.store || null;
  const rank = v?.rank || null;

  // 排名快照 → trackedKeywords（去重 keyword×language，供指标/分布/榜单复用）。
  const kwPairs = new Map<string, { keyword: string; language: string }>();
  for (const s of rank?.snapshots || []) {
    kwPairs.set(`${s.keyword}\u0000${s.language}`, { keyword: s.keyword, language: s.language });
  }
  const trackedKeywords: any[] = [...kwPairs.values()].map((e) => ({
    language: e.language,
    keyword: e.keyword,
    rationale: '',
    translation: '',
    status: 'active',
    source: 'manual',
  }));

  const product: StoreProduct = {
    id: 'dsh-product',
    projectId: 'dsh-project',
    platform,
    trackId: store?.trackId ?? null,
    bundleId: store?.metadata?.bundleId ?? null,
    trackName: store?.metadata?.trackName ?? name,
    artworkUrl: store?.metadata?.artworkUrl ?? null,
    supportedLanguages: languages,
    storeLinks: [],
    trackedKeywords,
    submissionKeywords: [],
    removedKeywords: [],
    rankSnapshots: rank?.snapshots ?? [],
    createdAt: new Date().toISOString(),
  };

  const project: Project = {
    id: 'dsh-project',
    name,
    localPath: path,
    hasGithubToken: Boolean(v?.credentials?.githubToken),
    hasAscKey: Boolean(v?.credentials?.ascConfigured),
    githubSource: v?.credentials?.githubToken ? 'global' : null,
    ascSource: v?.credentials?.ascConfigured ? 'global' : null,
    createdAt: new Date().toISOString(),
    repo: {
      remoteUrl: repo.remoteUrl ?? null,
      githubUrl: repo.githubUrl ?? null,
      branch: repo.branch ?? null,
      headSha: repo.headSha ?? null,
      headMessage: repo.headMessage ?? null,
      headDate: repo.headDate ?? null,
      dirty: Boolean(repo.dirty),
      description: repo.description ?? null,
      capturedAt: new Date().toISOString(),
    },
    briefActions: [],
    storeProducts: [product],
    productType: platform === 'unknown' ? null : platform,
    bundleId: product.bundleId,
    trackId: product.trackId,
    trackName: product.trackName,
    artworkUrl: product.artworkUrl,
    supportedLanguages: languages,
    storeLinks: [],
    trackedKeywords,
    submissionKeywords: [],
    removedKeywords: [],
    rankSnapshots: product.rankSnapshots,
  };

  const latest = v?.release?.latestTag;
  const releaseOverview = latest
    ? {
        draft: {
          name: latest.name,
          tag: latest.name,
          publishedAt: latest.date || '',
          commitCount: 0,
        },
        submission: null,
      }
    : null;

  return { project, product, releaseOverview };
}

export interface OverviewDshProps {
  cwd: string | null;
  aggregatedNode: any; // appilot_overview 的 tool-result 节点（可能为 null）
  actions: { busy: boolean; error: string | null; onRefresh: () => void };
  /** 可选：触发 agent 生成 AI 简报（appilot_overview includeBrief=true）。 */
  onGenerateBrief?: () => Promise<unknown>;
}

export function OverviewDsh(props: OverviewDshProps) {
  const [dark, setDark] = useState(isHostDark());
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  useEffect(() => {
    const body = document.body;
    if (!body) return;
    const observer = new MutationObserver(() => setDark(isHostDark()));
    observer.observe(body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'class'] });
    return () => observer.disconnect();
  }, []);

  // 新的 appilot_overview 节点到达 → 简报生成结束（无论成败）。
  useEffect(() => {
    setBriefBusy(false);
  }, [props.aggregatedNode]);

  const v = props.aggregatedNode ? resultOf(props.aggregatedNode.content).value : null;
  const { project, product, releaseOverview } = mapOverviewToProject(v, props.cwd);
  const activityData =
    v && v.activity && v.activity.commits
      ? {
          commits: v.activity.commits,
          releases: (v.activity.releases || []).filter(
            (r: any) => r && r.publishedAt,
          ),
        }
      : { commits: {}, releases: [] };

  // ASC 状态 → OverviewContent.ascInfo（仅凭据可用且查询成功时）。
  const ascInfo =
    v && v.asc && v.asc.status === 'ok'
      ? { versions: v.asc.versions || [], builds: v.asc.builds || [], fetchedAt: v.asc.fetchedAt }
      : null;

  // AI 简报 → OverviewContent.briefState。
  let briefState: any = { status: 'idle', suggestions: [], progress: null, error: '' };
  if (briefBusy) {
    briefState = { status: 'loading', suggestions: [], progress: null, error: '' };
  } else if (briefError) {
    briefState = { status: 'error', suggestions: [], progress: null, error: briefError };
  } else if (v && v.brief) {
    if (v.brief.status === 'ready') {
      briefState = { status: 'ready', suggestions: v.brief.suggestions || [], progress: null, error: '' };
    } else if (v.brief.status === 'error') {
      briefState = { status: 'error', suggestions: [], progress: null, error: v.brief.message || '生成失败' };
    } else if (v.brief.status === 'skipped') {
      briefState = { status: 'idle', suggestions: [], progress: null, error: v.brief.message || '' };
    }
  }
  const actions = props.actions;

  function onGenerateBrief() {
    if (!props.onGenerateBrief || briefBusy) return;
    setBriefBusy(true);
    setBriefError(null);
    Promise.resolve(props.onGenerateBrief())
      .catch((err: any) => setBriefError(err && err.message ? err.message : String(err)));
  }

  return (
    <div className={dark ? 'ap-ov dark' : 'ap-ov'}>
      <div className="ap-ov-toolbar">
        <div className="ap-ov-toolbar-row">
          <div className="ap-ov-row">
            <button
              type="button"
              className="ap-btn"
              disabled={actions.busy || undefined}
              onClick={actions.onRefresh}
            >
              {actions.busy ? '刷新中…' : '刷新数据'}
            </button>
            {v ? (
              <span className="ap-wb-sub">数据来自最近一次 appilot_overview 运行</span>
            ) : (
              <span className="ap-wb-sub">
                尚未运行 appilot_overview——点击刷新，agent 会收集项目/发布/readiness/流量数据
              </span>
            )}
          </div>
        </div>
        {actions.error ? (
          <div className="ap-empty">
            <div className="ap-empty-hint">刷新失败：{actions.error}</div>
          </div>
        ) : null}
      </div>
      <OverviewContent
        project={project}
        product={product}
        releaseOverview={releaseOverview}
        ascInfo={null}
        storeCurrentVersion={v?.store?.currentVersion?.version ?? null}
        activityData={activityData}
        feedbackThemes={[]}
        ascInfo={ascInfo}
        briefState={briefState}
        LinkComponent={DshLink}
        onSelectProduct={() => {}}
        onOpenExternal={(url) => window.open(url, '_blank', 'noopener')}
        onRevealInFolder={() => {}}
        onOpenSettings={() => {}}
        onGenerateBrief={onGenerateBrief}
        onBriefAction={() => {}}
      />
    </div>
  );
}
