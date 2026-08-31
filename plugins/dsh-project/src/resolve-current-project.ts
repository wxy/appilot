import { basename, resolve as resolvePath } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { jsonify } from '@appilot/dsh-common';
import { collectRepoInfo } from '@appilot/core/git-info';
import {
  detectApplePlatform,
  detectLocalizedLanguages,
} from '@appilot/core/app-store-discovery';

/**
 * 解析一个本地仓库路径为 Appilot 项目：仓库状态、Apple 平台、商店语言。
 * 其他 Appilot 工具的入口——先调用它确定当前工作目录属于哪个项目。
 */
export const resolveCurrentProject = defineTool({
  name: 'resolve_current_project',
  description:
    'Resolve a local repository path into an Appilot project: repo state, Apple platform (ios/macos), and localized store languages. Call this first to identify which project the current working directory belongs to.',
  parameters: {
    path: {
      type: 'string',
      description:
        'Absolute path of the project directory; defaults to the current working directory.',
    },
  },
  output: {
    schema: { type: 'json', description: 'Structured JSON result (see render output for the actual shape)' },
    render: (_args, value) => [
      { type: 'text', text: JSON.stringify(value, null, 2) },
    ],
  },
  async execute(args) {
    const path = resolvePath(args.path || process.cwd());
    const repo = await collectRepoInfo(path);
    return jsonify({
      path,
      name: basename(path),
      platform: detectApplePlatform(path),
      languages: detectLocalizedLanguages(path),
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
    });
  },
});
