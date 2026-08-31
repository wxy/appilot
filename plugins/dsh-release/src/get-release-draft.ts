import { resolve as resolvePath } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { jsonify } from '@appilot/dsh-common';
import { collectRepoInfo } from '@appilot/core/git-info';
import { listGitTags } from '@appilot/core/release-watcher';
import type { ProjectStore } from '@appilot/dsh-common';

/**
 * 查看仓库最近的 git tag 与 HEAD，确定当前进行中/最新的发布草稿版本。
 * 传入 store 时支持按已注册项目名引用（path 与 project 二选一）。
 */
export function createGetReleaseDraftTool(store?: ProjectStore) {
  return defineTool({
    name: 'get_release_draft',
    description:
      'Inspect the latest git tags and HEAD of a repository to determine the current or latest release draft: version tag, date, and HEAD commit. Pass either an absolute path or a registered project name.',
    parameters: {
      path: {
        type: 'string',
        description: 'Absolute path of the project directory (either path or project).',
      },
      project: {
        type: 'string',
        description: 'Name of a registered project (see register_project / list_projects).',
      },
      limit: {
        type: 'number',
        description: 'How many recent tags to list; defaults to 3.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [
        { type: 'text', text: JSON.stringify(value, null, 2) },
      ],
    },
    async execute(args) {
      let path = args.path ? resolvePath(args.path) : '';
      if (!path) {
        if (!store || !args.project) {
          throw new Error('请提供 path，或先 register_project 后用 project 名引用。');
        }
        const record = await store.get(args.project);
        if (!record) {
          throw new Error(`未找到已注册项目 "${args.project}"，请先 register_project。`);
        }
        path = record.path;
      }
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
}

/** 无 store 的默认实例（向后兼容；不支持按名引用）。 */
export const getReleaseDraft = createGetReleaseDraftTool();
