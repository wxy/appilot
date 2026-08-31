import { basename, resolve as resolvePath } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { jsonify } from '../jsonify.js';
import { collectRepoInfo } from '@appilot/core/git-info';
import {
  buildProjectProfile,
  profileToPromptBlock,
} from '@appilot/core/project-profile';
import {
  detectApplePlatform,
  detectLocalizedLanguages,
} from '@appilot/core/app-store-discovery';

/**
 * 构建项目画像（platform / languages / README 摘要 / 商店链接）并输出 prompt 块，
 * 供 Agent 在生成商店文案、检查发布准备度前获得结构化项目上下文。
 */
export const getProjectContext = defineTool({
  name: 'get_project_context',
  description:
    'Build the Appilot project profile for a local repository: name, Apple platform, supported store languages, README description. Use this to give the agent structured context about a project before drafting store copy or checking readiness.',
  parameters: {
    path: {
      type: 'string',
      required: true,
      description: 'Absolute path of the project directory.',
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
    const repo = await collectRepoInfo(path);
    const platform = detectApplePlatform(path);
    const languages = detectLocalizedLanguages(path);
    const profile = buildProjectProfile({
      name: basename(path),
      platform,
      supportedLanguages: languages,
      description: repo.description || '',
      readme: repo.description || undefined,
    });
    return jsonify({
      path,
      profile,
      promptBlock: profileToPromptBlock(profile),
    });
  },
});
