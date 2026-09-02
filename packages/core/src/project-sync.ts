/**
 * 项目级发布同步执行器（Phase：任务执行逻辑收敛到 core 单一实现）。
 *
 * 背景：两壳曾各自实现「项目 GitHub 发布同步」——Electron 的
 * scheduler.runGithubSyncTask（完整检测链 + githubSyncCache 缓存供发布页 UI）
 * 与 DSH/headless jobs 的 release-sync（git tags + releases 摘要）逻辑重叠。
 * 本模块是**不依赖壳存储**的纯执行器：输入项目路径与 token，输出结构化的
 * 发布状态（tags / releases / 摘要），两壳的任务 run 都从这里取数据；
 * 壳特有的副作用（Electron 的 githubSyncCache/notify、任务执行统计）留在壳层。
 *
 * 本模块只调用 core 纯函数（node:git / GitHub REST），可在 node 单测。
 */
import { listGitTags, fetchRemoteTags, checkForRelease, type GitTagInfo } from './release-watcher';
import {
  listGitHubReleases,
  fetchRepoCapabilities,
  type GitHubReleaseItem,
  type GitHubRepoCapabilities,
} from './github-api';
import type { ReleaseCheckResult, ReleaseMaterial, ReleaseInfo } from './release-watcher';

export interface ProjectReleaseState {
  /** 本地最新 tag（tags[0]）。 */
  latestTag: GitTagInfo | null;
  /** 全部本地 tag（按时间倒序）。 */
  tags: GitTagInfo[];
  /** GitHub releases（含草稿可见性取决于 token）。 */
  releases: GitHubReleaseItem[];
  /** 非草稿发布数。 */
  publishedCount: number;
  /** 草稿数。 */
  draftCount: number;
  /** 汇总摘要（任务 summary 用，与既有 DSH release-sync 文案一致）。 */
  summary: string;
  /** fetch 是否执行过（仅当 opts.fetchRemote=true）。 */
  fetched: boolean;
  syncedAt: string;
}

export interface SyncProjectReleasesOptions {
  /** GitHub token（可为 null → 公开数据降级，草稿不可见）。 */
  token?: string | null;
  /**
   * 是否先 fetch remote tags（改 remote-tracking refs，不改工作树）——
   * Electron github-sync 行为；DSH release-sync 未 fetch（只读本地 tag）。
   */
  fetchRemote?: boolean;
  /** API 流量统计（requestBytes/responseBytes 累计），透传给 GitHub 调用。 */
  onApiStats?(requestBytes: number, responseBytes: number): void;
}

/**
 * 计算单个项目的发布同步状态（纯：不写任何壳存储）。
 * 每个项目独立 try/catch 由调用方负责（此处失败即抛出）。
 */
export async function syncProjectReleaseState(
  localPath: string,
  opts: SyncProjectReleasesOptions = {},
): Promise<ProjectReleaseState> {
  const token = opts.token ?? null;
  const fetched = opts.fetchRemote === true ? await fetchRemoteTags(localPath) : false;
  const tags = await listGitTags(localPath);
  const releases = await listGitHubReleases(localPath, token, opts.onApiStats);
  const drafts = releases.filter((r) => r.draft).length;
  const summary = [
    `tag=${tags[0]?.name ?? '无'}`,
    `GitHub 发布 ${releases.length}（草稿 ${drafts}）`,
  ].join(' · ');
  return {
    latestTag: tags[0] ?? null,
    tags,
    releases,
    publishedCount: releases.length - drafts,
    draftCount: drafts,
    summary,
    fetched,
    syncedAt: new Date().toISOString(),
  };
}

/**
 * 深度发布检测（Electron github-sync 的完整计算链）：
 * fetch remote + GitHub releases + repo capabilities + checkForRelease
 * （发布素材 material / PR / 最新发布边界）。Electron 壳只负责把产物写进
 * githubSyncCache 供发布页 UI——计算实现唯一来源是这里。
 */
export interface ProjectReleaseInspection extends ProjectReleaseState {
  /** checkForRelease 的最新候选发布。 */
  release: ReleaseInfo | null;
  /** checkForRelease 全部候选。 */
  releasesAll: ReleaseInfo[];
  lastSeenTag: string | null;
  /** release 的发布素材（commits/PR/diffStat/githubRelease）。 */
  material: ReleaseMaterial | null;
  /** repo 能力探测（token 决定 drafts 可否发布）。 */
  repoCapabilities: GitHubRepoCapabilities;
  /** 上次已见 sha（输入透传，供壳记录）。 */
  lastSeenSha: string | null;
}

export interface InspectProjectReleaseOptions extends SyncProjectReleasesOptions {
  /** 上次已见 sha（checkForRelease 的 lastSeenSha 边界）。 */
  lastSeenSha?: string | null;
}

/** Electron github-sync 深度计算链的 core 单一实现。 */
export async function inspectProjectRelease(
  localPath: string,
  opts: InspectProjectReleaseOptions = {},
): Promise<ProjectReleaseInspection> {
  const token = opts.token ?? null;
  const base = await syncProjectReleaseState(localPath, {
    token,
    fetchRemote: opts.fetchRemote,
    onApiStats: opts.onApiStats,
  });
  const repoCapabilities = await fetchRepoCapabilities(localPath, token);
  const check: ReleaseCheckResult = await checkForRelease(localPath, opts.lastSeenSha ?? null, token, {
    sync: false,
    githubReleases: base.releases,
    onApiStats: opts.onApiStats,
  });
  return {
    ...base,
    release: check.latest,
    releasesAll: check.releases,
    lastSeenTag: check.lastSeenTag,
    material: check.latest?.material ?? null,
    repoCapabilities,
    lastSeenSha: opts.lastSeenSha ?? null,
  };
}

export interface ProjectReleaseState {
  /** 本地最新 tag（tags[0]）。 */
  latestTag: GitTagInfo | null;
  /** 全部本地 tag（按时间倒序）。 */
  tags: GitTagInfo[];
  /** GitHub releases（含草稿可见性取决于 token）。 */
  releases: GitHubReleaseItem[];
  /** 非草稿发布数。 */
  publishedCount: number;
  /** 草稿数。 */
  draftCount: number;
  /** 汇总摘要（任务 summary 用，与既有 DSH release-sync 文案一致）。 */
  summary: string;
  /** fetch 是否执行过（仅当 opts.fetchRemote=true）。 */
  fetched: boolean;
  syncedAt: string;
}
