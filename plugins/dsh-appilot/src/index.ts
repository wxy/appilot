import type { Context } from '@deepseek-ai/cordis';
import { resolveCurrentProject } from './tools/resolve-current-project.js';
import { getProjectContext } from './tools/get-project-context.js';
import { getReleaseDraft } from './tools/get-release-draft.js';
import { checkReleaseReadiness } from './tools/check-release-readiness.js';

/**
 * @appilot/dsh — Appilot 的 DeepSeek Harness 插件。
 *
 * 目前注册一组只读工具（项目识别/上下文/发布草稿/readiness），
 * 全部走 @appilot/core 同一代码路径；后续按插件组模式拆分域插件。
 */
export const name = 'appilot';
export const inject = ['tools'];

export function apply(ctx: Context): void {
  for (const tool of [
    resolveCurrentProject,
    getProjectContext,
    getReleaseDraft,
    checkReleaseReadiness,
  ]) {
    ctx.tools.register(tool);
  }
}
