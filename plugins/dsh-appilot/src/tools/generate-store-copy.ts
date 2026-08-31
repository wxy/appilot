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
import type { ReleaseInfo } from '@appilot/core/release-watcher';

/**
 * 从环境变量读取 AI 凭据（MVP；Phase 4 迁移到 ctx.credentials）。
 * 刻意不接受参数传入 apiKey——工具参数对模型可见，防止密钥进入会话记录。
 */
function credentialsFromEnv() {
  const baseURL =
    process.env.APILOT_AI_BASE_URL || process.env.OPENAI_BASE_URL || '';
  const apiKey = process.env.APILOT_AI_API_KEY || process.env.OPENAI_API_KEY || '';
  const model = process.env.APILOT_AI_MODEL || 'deepseek-chat';
  if (!baseURL || !apiKey) {
    throw new Error(
      '缺少 AI 凭据：请设置 APILOT_AI_BASE_URL 与 APILOT_AI_API_KEY 环境变量（Phase 4 将改用 ctx.credentials）。',
    );
  }
  return { baseURL, apiKey, model };
}

/** 由 git 状态构造最小 ReleaseInfo（MVP：本地 tag 驱动）。 */
function releaseFromGit(
  path: string,
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

export const generateStoreCopy = defineTool({
  name: 'generate_store_copy',
  description:
    'Generate App Store copy (name/subtitle/description/whatsNew/keywords) for a repository release using the @appilot/core AI pipeline. Credentials come from APILOT_AI_BASE_URL / APILOT_AI_API_KEY env vars. One language per call.',
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
    const provider = new AIProvider(credentialsFromEnv());
    const result = await generateStoreSubmissionContent(provider, {
      name: profile.name,
      description: profile.description,
      language,
      trackedKeywords: profile.trackedKeywords ?? [],
      currentSubmissionKeywords: [],
      recentRankings: [],
      release: releaseFromGit(path, repo, tags, args.versionTag),
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
