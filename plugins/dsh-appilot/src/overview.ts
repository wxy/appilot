import { basename, resolve as resolvePath } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { jsonify, openSharedHeadlessStore, type CredentialReader } from '@appilot-labs/appilot-common';
import { collectRepoInfo, getCommitActivity } from '@appilot-labs/appilot-core/git-info';
import {
  detectApplePlatform,
  detectLocalizedLanguages,
  discoverAppStoreTrackId,
  lookupApp,
  fetchStoreCurrentVersion,
} from '@appilot-labs/appilot-core/app-store-discovery';
import { collectKeywordRankings, type RankTarget } from '@appilot-labs/appilot-core/rank-collector';
import { storefrontsForLanguage } from '@appilot-labs/appilot-core/storefronts';
import { listGitTags } from '@appilot-labs/appilot-core/release-watcher';
import { listGitHubReleases } from '@appilot-labs/appilot-core/github-api';
import { runReadinessChecks } from '@appilot-labs/appilot-core/readiness-check';
import { fetchTrafficSnapshot } from '@appilot-labs/appilot-core/gh-traffic';
import { createAscClient } from '@appilot-labs/appilot-core/asc-api';
import { computeRankMovers, type OverviewBriefInput } from '@appilot-labs/appilot-core/overview-summary';
import { AIProvider } from '@appilot-labs/appilot-core/ai/ai-provider';
import { generateOverviewBrief } from '@appilot-labs/appilot-core/ai/overview-brief';

/** 从按需聚合的数据构造 AI 简报输入（与 Electron 的 buildBriefInput 同形状，缺 draft/竞品部分）。 */
function buildBriefInput(ov: {
  name: string;
  description: string | null;
  platform: string | null;
  languages: string[];
  snapshots: { keyword: string; language: string; storefront: string; rank: number | null; checkedAt: string }[];
}): OverviewBriefInput {
  const keywords = new Set(ov.snapshots.map((s) => s.keyword));
  const ranked = new Set(
    ov.snapshots.filter((s) => s.rank != null).map((s) => s.keyword),
  );
  const top10 = new Set(
    ov.snapshots.filter((s) => s.rank != null && s.rank <= 10).map((s) => s.keyword),
  );
  return {
    name: ov.name,
    description: ov.description || '',
    platform: ov.platform || 'unknown',
    supportedLanguages: ov.languages,
    keywordStats: {
      tracked: keywords.size,
      ranked: ranked.size,
      top10: top10.size,
      paused: 0,
    },
    rankMovers: computeRankMovers(ov.snapshots),
    release: null,
    submissionKeywordCount: 0,
    uiLanguage: 'zh',
    feedbackThemes: [],
    competitorDeltas: [],
  };
}

/**
 * Appilot 总览工具：按需聚合一个仓库的运营总览。
 *
 * - 仓库本地（无需凭据）：项目身份（platform/languages/repo 状态）、git tags、
 *   readiness 清单（MVP 语义：本地化/文案以空值传入，命中「缺失」检查项）。
 * - GitHub（公开仓库匿名可读；token 解锁私有/草稿/流量）：releases、
 *   traffic 快照。
 * - App Store（免费 iTunes API，无需凭据）：README 里的商店链接 → trackId →
 *   商店元数据（名称/图标/bundleId）与当前线上版本；传 `keywords` 时按
 *   trackId 采集关键词在各商店的实时排名。
 * - 暂缓项（后续阶段）：ASC 商店状态（需要 App Store Connect 凭据）、AI 简报。
 */
export function createAppilotOverviewTool(
  reader: CredentialReader,
) {
  return defineTool({
    name: 'appilot_overview',
    description:
      'Gather a full Appilot overview for a repository: project identity (platform/languages/repo state), release status (git tags + GitHub releases), release readiness checklist, and GitHub traffic (when a token is configured). Run this to refresh the Appilot workbench overview.',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: 'Absolute path of the project directory.',
      },
      keywords: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional tracked keywords for real-time App Store rank collection (one keyword per entry; expanded across the project languages/storefronts). Omit to skip the rank section.',
      },
      includeBrief: {
        type: 'boolean',
        description:
          'Whether to generate the AI overview brief. Requires an OpenAI-compatible key (OPENAI_API_KEY via ctx.credentials/env). Default false (costs tokens).',
      },
      token: {
        type: 'string',
        description:
          'Optional GitHub token for private repos, draft visibility, or traffic. Prefer configuring GITHUB_TOKEN via ctx.credentials; avoid passing secrets in the conversation.',
      },
    },
    output: {
      schema: { type: 'json', description: 'Aggregated overview JSON (see render output for the actual shape)' },
      render: (_args, value) => [
        { type: 'text', text: JSON.stringify(value, null, 2) },
      ],
    },
    async execute(args) {
      const path = resolvePath(args.path);
      const repo = await collectRepoInfo(path);
      const platform = detectApplePlatform(path);
      const supportedLanguages = detectLocalizedLanguages(path);
      const tags = await listGitTags(path);
      const token = args.token || (await reader('GITHUB_TOKEN')) || null;
      const releases = await listGitHubReleases(path, token);
      const versionTag = tags[0]?.name || '';
      const checks = runReadinessChecks({
        localizations: [],
        supportedLanguages,
        versionTag,
        ascVersion: null,
        buildAttached: false,
      });
      const traffic = await fetchTrafficSnapshot(path, token);
      const commits = await getCommitActivity(path);

      // 凭据状态（供客户端正确渲染 GitHub/App Store 能力徽标）。
      const ascIssuer = await reader('APP_STORE_CONNECT_ISSUER_ID');
      const ascKeyId = await reader('APP_STORE_CONNECT_KEY_ID');
      const ascPem = await reader('APP_STORE_CONNECT_PRIVATE_KEY');
      const ascConfigured = !!(ascIssuer && ascKeyId && ascPem);
      const credentials = { githubToken: !!token, ascConfigured };

      // App Store（免费 API）：README 商店链接 → trackId → 元数据 + 当前版本。
      const discovery = discoverAppStoreTrackId(path);
      let store: {
        trackId: string;
        metadata: {
          trackName: string;
          bundleId: string;
          artworkUrl: string;
          version: string;
          averageUserRating: number;
          userRatingCount: number;
          primaryGenreName: string;
        } | null;
        currentVersion: { version: string; currentVersionReleaseDate: string | null } | null;
      } | null = null;
      if (discovery) {
        const metadata = await lookupApp(discovery.trackId).catch(() => null);
        const currentVersion = await fetchStoreCurrentVersion(discovery.trackId).catch(() => null);
        store = {
          trackId: discovery.trackId,
          metadata: metadata
            ? {
                trackName: metadata.trackName,
                bundleId: metadata.bundleId,
                artworkUrl: metadata.artworkUrl,
                version: metadata.version,
                averageUserRating: metadata.averageUserRating,
                userRatingCount: metadata.userRatingCount,
                primaryGenreName: metadata.primaryGenreName,
              }
            : null,
          currentVersion,
        };
      }

      // 排名采集（免费 iTunes Search API）：keywords × languages × storefronts。
      const keywords = Array.isArray(args.keywords)
        ? args.keywords.map((k: unknown) => String(k).trim()).filter(Boolean).slice(0, 10)
        : [];
      let rank: {
        keywords: string[];
        targets: number;
        snapshots: { keyword: string; language: string; storefront: string; rank: number | null; totalResults: number; checkedAt: string }[];
        failed: number;
      } | null = null;
      if (store?.trackId && keywords.length > 0) {
        const targets: RankTarget[] = [];
        for (const keyword of keywords) {
          for (const language of supportedLanguages) {
            for (const storefront of storefrontsForLanguage(language)) {
              targets.push({ keyword, language, storefront });
            }
          }
        }
        // 上限：避免对网络 API 的请求过多拖慢工具。
        const capped = targets.slice(0, 24);
        const result = await collectKeywordRankings({
          targets: capped,
          trackId: store.trackId,
          productType: platform,
          entity: platform === 'macos' ? 'macSoftware' : 'software',
          delayMs: 150,
        });
        rank = {
          keywords,
          targets: capped.length,
          snapshots: result.snapshots,
          failed: result.failed,
        };
        // Phase 4a：采集结果写入共享 SQLite（rank_snapshots 历史）——供任务中心/
        // 未来 Electron 复用同一份排名历史。DB 不可用时不影响本工具返回。
        if (result.snapshots.length > 0) {
          try {
            openSharedHeadlessStore().snapshots.add(
              result.snapshots.map((sn) => ({ projectName: basename(path), ...sn })),
            );
          } catch {
            /* 忽略：采集结果照常返回 */
          }
        }
      }

      // ASC 商店状态（App Store Connect 凭据门控；无凭据则为 null）。
      let asc: {
        status: string;
        versions: { id: string; versionString: string; appStoreState: string; createdDate: string | null; buildId: string | null }[];
        builds: { id: string; version: string; processingState: string; uploadedDate: string | null; betaReviewState: string | null }[];
        fetchedAt: string;
      } | { status: string; message: string } | null = null;
      const bundleId = store?.metadata?.bundleId ?? null;
      if (store?.trackId && bundleId) {
        if (ascConfigured) {
          try {
            const client = createAscClient({ issuerId: ascIssuer!, keyId: ascKeyId!, privateKeyPem: ascPem! });
            const appId = await client.getAppIdByBundleId(bundleId);
            if (appId) {
              const [versions, builds] = await Promise.all([
                client.listAppStoreVersions(appId).catch(() => null),
                client.listBuilds(appId).catch(() => null),
              ]);
              asc = {
                status: 'ok',
                versions: versions ?? [],
                builds: builds ?? [],
                fetchedAt: new Date().toISOString(),
              };
            } else {
              asc = { status: 'error', message: 'App Store Connect 中未找到该 bundleId 的应用' };
            }
          } catch (err) {
            asc = {
              status: 'error',
              message: err instanceof Error ? err.message : String(err),
            };
          }
        }
      }

      // AI 简报（includeBrief 门控；需要 OPENAI_API_KEY）。
      let brief: { status: string; suggestions?: unknown[]; message?: string } | null = null;
      if (args.includeBrief) {
        const apiKey = await reader('OPENAI_API_KEY');
        if (!apiKey) {
          brief = { status: 'skipped', message: '未配置 OPENAI_API_KEY' };
        } else {
          try {
            const baseUrl = (await reader('OPENAI_BASE_URL')) || 'https://api.openai.com/v1';
            const model = (await reader('OPENAI_MODEL')) || 'gpt-4o-mini';
            const provider = new AIProvider({ baseURL: baseUrl, apiKey, model });
            const input = buildBriefInput({
              name: basename(path),
              description: repo.description,
              platform,
              languages: supportedLanguages,
              snapshots: rank?.snapshots ?? [],
            });
            const suggestions = await generateOverviewBrief(provider, input);
            brief = { status: 'ready', suggestions };
          } catch (err) {
            brief = {
              status: 'error',
              message: err instanceof Error ? err.message : String(err),
            };
          }
        }
      }

      return jsonify({
        path,
        name: basename(path),
        platform,
        languages: supportedLanguages,
        repo: {
          remoteUrl: repo.remoteUrl,
          githubUrl: repo.githubUrl,
          branch: repo.branch,
          headSha: repo.headSha,
          headMessage: repo.headMessage,
          headDate: repo.headDate,
          dirty: repo.dirty,
          description: repo.description,
        },
        release: {
          latestTag: tags[0] ?? null,
          recentTags: tags.slice(0, 5).map((tag) => ({
            name: tag.name,
            sha: tag.sha,
            date: tag.date,
          })),
          githubReleases: releases.slice(0, 5).map((r) => ({
            tag: r.tag,
            name: r.name,
            draft: r.draft,
            prerelease: r.prerelease,
            publishedAt: r.publishedAt,
          })),
          readiness: {
            versionTag,
            supportedLanguages,
            checks,
          },
        },
        activity: {
          /** 每日提交数（近 120 天，本地 git log，与 Electron 口径一致）。 */
          commits,
          /** GitHub 发布（带 publishedAt，供活跃热力图标注）。 */
          releases: releases.slice(0, 20).map((r) => ({
            tag: r.tag,
            publishedAt: r.publishedAt,
          })),
          /** GitHub 流量（需要 token）。 */
          traffic,
        },
        store,
        rank,
        asc,
        brief,
        credentials,
        skipped: {
          traffic: token
            ? undefined
            : 'GitHub 流量需要 GITHUB_TOKEN（公开仓库匿名可读时跳过）',
          asc: asc ? undefined : '需要 App Store Connect 凭据（APP_STORE_CONNECT_ISSUER_ID / KEY_ID / PRIVATE_KEY）',
          brief: brief ? undefined : 'AI 简报需要 includeBrief=true 与 OPENAI_API_KEY',
        },
      });
    },
  });
}
