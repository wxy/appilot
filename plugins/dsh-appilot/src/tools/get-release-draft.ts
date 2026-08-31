import { resolve as resolvePath } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { jsonify } from '../jsonify.js';
import { collectRepoInfo } from '@appilot/core/git-info';
import { listGitTags } from '@appilot/core/release-watcher';

/**
 * 查看仓库最近的 git tag 与 HEAD，确定当前进行中/最新的发布草稿版本。
 * MVP：本地 tag 驱动；后续接入 GitHub release 与草稿存储。
 */
export const getReleaseDraft = defineTool({
  name: 'get_release_draft',
  description:
    'Inspect the latest git tags and HEAD of a repository to determine the current or latest release draft: version tag, date, and HEAD commit. Works from local git history; GitHub release / draft storage integration comes later.',
  parameters: {
    path: {
      type: 'string',
      required: true,
      description: 'Absolute path of the project directory.',
    },
    limit: {
      type: 'number',
      description: 'How many recent tags to list; defaults to 3.',
    },
  },
  output: {
    schema: { type: 'json', description: 'Structured JSON result (see render output for the actual shape)' },
    render: (_args, value) => [
      { type: 'text', text: JSON.stringify(value, null, 2) },
    ],
  },
  async execute(args) {
    const path = resolvePath(args.path);
    const tags = await listGitTags(path);
    const repo = await collectRepoInfo(path);
    const limit = Math.max(1, args.limit ?? 3);
    return jsonify({
      path,
      versionTag: tags[0]?.name ?? null,
      head: {
        sha: repo.headSha,
        message: repo.headMessage,
        date: repo.headDate,
        dirty: repo.dirty,
      },
      latestTags: tags.slice(0, limit).map((tag) => ({
        name: tag.name,
        sha: tag.sha,
        date: tag.date,
      })),
    });
  },
});
