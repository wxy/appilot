import { basename, resolve as resolvePath } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { jsonify } from '../jsonify.js';
import { AIProvider } from '@appilot/core/ai/ai-provider';
import { generateStoreSubmissionContent } from '@appilot/core/ai/release-reviewer';
import { collectRepoInfo } from '@appilot/core/git-info';
import { listGitTags } from '@appilot/core/release-watcher';
import { buildProjectProfile } from '@appilot/core/project-profile';
import {
  detectApplePlatform,
  detectLocalizedLanguages,
} from '@appilot/core/app-store-discovery';
import type { StoreSubmissionLocalization } from '@appilot/core/store-submission';
import {
  envCredentialReader,
  type CredentialReader,
} from '../credentials.js';
import { releaseFromGit } from './generate-store-copy.js';

/**
 * 按审核反馈修订既有商店文案。凭据经 reader 解析（宿主 ctx.credentials →
 * 环境变量）；不接受参数传 key。
 */
export function createReviseStoreCopyTool(
  reader: CredentialReader = envCredentialReader,
) {
  return defineTool({
    name: 'revise_store_copy',
    description:
      'Revise existing App Store copy for a repository release according to reviewer/author feedback, using the same @appilot/core pipeline as the desktop app. Pass the existing copy fields and the feedback; credentials from ctx.credentials / APILOT_AI_* env vars.',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: 'Absolute path of the project directory.',
      },
      language: {
        type: 'string',
        required: true,
        description: 'Store language code of the copy being revised (en, zh-Hans, ja, ...).',
      },
      versionTag: {
        type: 'string',
        description: 'The release tag this copy belongs to; defaults to the latest git tag.',
      },
      existingName: { type: 'string', required: true, description: 'Existing App Store name.' },
      existingSubtitle: { type: 'string', description: 'Existing subtitle.' },
      existingPromotionalText: { type: 'string', description: 'Existing promotional text.' },
      existingDescription: { type: 'string', required: true, description: 'Existing description.' },
      existingWhatsNew: { type: 'string', description: 'Existing What\'s New text.' },
      existingKeywords: { type: 'string', description: 'Existing keyword list.' },
      reviewFeedback: {
        type: 'string',
        required: true,
        description: 'Reviewer/author feedback the revision must address.',
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
      const baseLocalization: StoreSubmissionLocalization = {
        language: args.language,
        name: args.existingName,
        subtitle: args.existingSubtitle ?? '',
        promotionalText: args.existingPromotionalText ?? '',
        description: args.existingDescription,
        whatsNew: args.existingWhatsNew ?? '',
        keywords: args.existingKeywords ?? '',
      };
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
        language: args.language,
        trackedKeywords: profile.trackedKeywords ?? [],
        currentSubmissionKeywords: [],
        recentRankings: [],
        release: releaseFromGit(repo, tags, args.versionTag),
        reviewFeedback: args.reviewFeedback,
        baseLocalization,
        profile,
      });
      return jsonify({
        path,
        language: args.language,
        versionTag: args.versionTag || tags[0]?.name || '',
        summary: result.summary,
        localizations: result.localizations,
        submissionKeywords: result.submissionKeywords,
      });
    },
  });
}
