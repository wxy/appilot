import { resolve as resolvePath } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { jsonify } from '@appilot/dsh-common';
import { runReadinessChecks } from '@appilot/core/readiness-check';
import { listGitTags } from '@appilot/core/release-watcher';
import { detectLocalizedLanguages } from '@appilot/core/app-store-discovery';

/**
 * 对仓库执行 Appilot 发布准备度检查（各语言商店文案与字段上限、版本 tag、
 * ASC 状态、构建附件）。MVP：文案与 ASC 以空值传入，命中「缺失」检查项；
 * 后续接入草稿存储与 ASC 只读客户端。
 */
export const checkReleaseReadiness = defineTool({
  name: 'check_release_readiness',
  description:
    'Run Appilot release-readiness checks for a repository: per-language store copy presence and field limits, version tag, ASC status, build attachment. Returns a checklist of pass/warning/fail items.',
  parameters: {
    path: {
      type: 'string',
      required: true,
      description: 'Absolute path of the project directory.',
    },
    versionTag: {
      type: 'string',
      description: 'The version tag to check; defaults to the latest git tag.',
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
    const versionTag = args.versionTag || tags[0]?.name || '';
    const supportedLanguages = detectLocalizedLanguages(path);
    const checks = runReadinessChecks({
      localizations: [],
      supportedLanguages,
      versionTag,
      ascVersion: null,
      buildAttached: false,
    });
    return jsonify({
      path,
      versionTag,
      supportedLanguages,
      checks,
    });
  },
});
