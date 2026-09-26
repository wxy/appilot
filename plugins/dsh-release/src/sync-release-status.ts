import { resolve as resolvePath } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { jsonify, envCredentialReader, type CredentialReader } from '@appilot-labs/appilot-common';
import { collectRepoInfo } from '@appilot-labs/appilot-core/git-info';
import { listGitTags } from '@appilot-labs/appilot-core/release-watcher';
import { listGitHubReleases } from '@appilot-labs/appilot-core/github-api';

/**
 * 刷新并汇总仓库的发布状态：最近 git tag + GitHub release（公开仓库匿名可读，
 * token 从 ctx.credentials / 环境变量读取——审计 H8：token 不作为模型可见的
 * 工具参数，防止落入会话转录/持久化存储）。ASC 商店状态需要凭据，Phase 4 接入。
 */
export function createSyncReleaseStatusTool(
  reader: CredentialReader = envCredentialReader,
) {
  return defineTool({
  name: 'sync_release_status',
  description:
    'Refresh and summarize release status of a repository: latest git tags and, when the remote is GitHub, published/draft releases. GitHub token (for private repos/draft visibility) is read from configured credentials, not from tool arguments. ASC store status needs credentials and is not checked yet.',
  parameters: {
    path: {
      type: 'string',
      required: true,
      description: 'Absolute path of the project directory.',
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
    // 审计 H8：token 只从凭据通道读取，绝不接受模型传入的工具参数。
    const token = (await reader('GITHUB_TOKEN')) || null;
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
