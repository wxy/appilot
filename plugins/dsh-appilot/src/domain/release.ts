import type { Context } from '@deepseek-ai/cordis';
import { getReleaseDraft } from '../tools/get-release-draft.js';
import { checkReleaseReadiness } from '../tools/check-release-readiness.js';
import { syncReleaseStatus } from '../tools/sync-release-status.js';
import { createGenerateStoreCopyTool } from '../tools/generate-store-copy.js';
import { createReviseStoreCopyTool } from '../tools/revise-store-copy.js';
import { ctxCredentialReader } from '../credentials.js';

/**
 * @appilot/dsh 域插件：release（发布草稿 / readiness / 发布状态 / 文案生成与修订）。
 * 独立可安装；由元插件 appilot 组合，用户也可单独安装本域。
 * AI 工具凭据经 ctx.credentials 解析（回退环境变量），Phase 4 落地。
 */
export const name = 'appilot-release';
export const inject = ['tools', 'credentials'];

export function apply(ctx: Context): void {
  const reader = ctxCredentialReader(ctx);
  ctx.tools.register(getReleaseDraft);
  ctx.tools.register(checkReleaseReadiness);
  ctx.tools.register(syncReleaseStatus);
  ctx.tools.register(createGenerateStoreCopyTool(reader));
  ctx.tools.register(createReviseStoreCopyTool(reader));
}
