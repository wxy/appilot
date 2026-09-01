import { basename, resolve as resolvePath } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { jsonify } from '@appilot-labs/appilot-common';
import { AIProvider } from '@appilot-labs/appilot-core/ai/ai-provider';
import { generateStoreSubmissionContent } from '@appilot-labs/appilot-core/ai/release-reviewer';
import { collectRepoInfo } from '@appilot-labs/appilot-core/git-info';
import { listGitTags } from '@appilot-labs/appilot-core/release-watcher';
import { buildProjectProfile } from '@appilot-labs/appilot-core/project-profile';
import {
  detectApplePlatform,
  detectLocalizedLanguages,
} from '@appilot-labs/appilot-core/app-store-discovery';
import type { ReleaseInfo } from '@appilot-labs/appilot-core/release-watcher';
import {
  envCredentialReader,
  type CredentialReader,
} from '@appilot-labs/appilot-common';

/** 由 git 状态构造最小 ReleaseInfo（MVP：本地 tag 驱动）。 */
export function releaseFromGit(
  repo: { githubUrl: string | null; headMessage: string | null },
  tags: { name: string; sha: string; date: string }[],
  versionTag?: string,
): ReleaseInfo {
  const tag = versionTag || tags[0]?.name || '';
  return {
    id: tag,
    tag,
    name: tag || null,
    publishedAt: tags[0]?.date ?? new Date().toISOString(),
    url: repo.githubUrl ? `${repo.githubUrl}/releases/tag/${tag}` : '',
    body: repo.headMessage || '',
    material: null,
    source: 'git-tag',
    githubDraft: null,
    draft: true,
    commitSha: tags[0]?.sha ?? null,
  };
}

/**
 * 生成单语言 App Store 文案。凭据经 reader 解析（宿主 ctx.credentials →
 * 环境变量）；刻意不接收参数传入 apiKey——工具参数对模型可见，防泄漏。
 */
export function createGenerateStoreCopyTool(
  reader: CredentialReader = envCredentialReader,
) {
  return defineTool({
    name: 'generate_store_copy',
    description:
      'Generate App Store copy (name/subtitle/description/whatsNew/keywords) for a repository release using the @appilot-labs/appilot-core AI pipeline. Credentials come from ctx.credentials / APILOT_AI_* env vars. One language per call.',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: 'Absolute path of the project directory.',
      },
      language: {
        type: 'string',
        description: 'Store language code (en, zh-Hans, ja, ...); defaults to en.',
      },
      versionTag: {
        type: 'string',
        description: 'The release tag to draft copy for; defaults to the latest git tag.',
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
      const profile = buildProjectProfile({
        name: basename(path),
        platform: detectApplePlatform(path),
        supportedLanguages: detectLocalizedLanguages(path),
        description: repo.description || '',
        readme: repo.description || undefined,
      });
      const language = args.language || 'en';
      const baseURL =
        (await reader('APILOT_AI_BASE_URL')) ||
        (await reader('OPENAI_BASE_URL')) ||
        '';
      const apiKey =
        (await reader('APILOT_AI_API_KEY')) ||
        (await reader('OPENAI_API_KEY')) ||
        '';
      const model = (await reader('APILOT_AI_MODEL')) || 'deepseek-chat';
      if (!baseURL || !apiKey) {
        throw new Error(
          '缺少 AI 凭据：请在 Harness 设置/环境变量中配置 APILOT_AI_BASE_URL 与 APILOT_AI_API_KEY（或 OPENAI_*）。',
        );
      }
      const provider = new AIProvider({ baseURL, apiKey, model });
      const result = await generateStoreSubmissionContent(provider, {
        name: profile.name,
        description: profile.description,
        language,
        trackedKeywords: profile.trackedKeywords ?? [],
        currentSubmissionKeywords: [],
        recentRankings: [],
        release: releaseFromGit(repo, tags, args.versionTag),
        profile,
      });
      return jsonify({
        path,
        language,
        versionTag: args.versionTag || tags[0]?.name || '',
        summary: result.summary,
        localizations: result.localizations,
        submissionKeywords: result.submissionKeywords,
      });
    },
  });
}
