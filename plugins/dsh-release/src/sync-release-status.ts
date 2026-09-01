import { resolve as resolvePath } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { jsonify, envCredentialReader, type CredentialReader } from '@appilot-labs/appilot-common';
import { collectRepoInfo } from '@appilot-labs/appilot-core/git-info';
import { listGitTags } from '@appilot-labs/appilot-core/release-watcher';
import { listGitHubReleases } from '@appilot-labs/appilot-core/github-api';

/**
 * 刷新并汇总仓库的发布状态：最近 git tag + GitHub release（公开仓库匿名可读，
 * 传 token 可看私有/草稿）。ASC 商店状态需要凭据，Phase 4 接入 ctx.credentials。
 */
export function createSyncReleaseStatusTool(
  reader: CredentialReader = envCredentialReader,
) {
  return defineTool({
  name: 'sync_release_status',
  description:
    'Refresh and summarize release status of a repository: latest git tags and, when the remote is GitHub, published/draft releases. ASC store status needs credentials and is not checked yet.',
  parameters: {
    path: {
      type: 'string',
      required: true,
      description: 'Absolute path of the project directory.',
    },
    token: {
      type: 'string',
      description:
        'Optional GitHub token for private repos or draft visibility. Prefer configuring GITHUB_TOKEN via ctx.credentials; avoid passing secrets in the conversation.',
    },
  },
  output: {
    schema: { type: 'json' },
    render: (_args, value) => [
      { type: 'text', text: JSON.stringify(value, null, 2) },
    ],
  },
  async execute(args) {
    const path = resolvePath(args.path);
    const repo = await collectRepoInfo(path);
    const tags = await listGitTags(path);
    const token = args.token || (await reader('GITHUB_TOKEN')) || null;
    const releases = await listGitHubReleases(path, token);
    return jsonify({
      path,
      remote: {
        githubUrl: repo.githubUrl,
        branch: repo.branch,
        headSha: repo.headSha,
      },
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
      note: 'ASC store status requires credentials; wired via ctx.credentials in Phase 4.',
    });
  },
});
}
