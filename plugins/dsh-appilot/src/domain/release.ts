import type { Context } from '@deepseek-ai/cordis';
import { getReleaseDraft } from '../tools/get-release-draft.js';
import { checkReleaseReadiness } from '../tools/check-release-readiness.js';
import { syncReleaseStatus } from '../tools/sync-release-status.js';
import { generateStoreCopy } from '../tools/generate-store-copy.js';
import { reviseStoreCopy } from '../tools/revise-store-copy.js';

/**
 * @appilot/dsh 域插件：release（发布草稿 / readiness / 发布状态 / 文案生成与修订）。
 * 独立可安装；由元插件 appilot 组合，用户也可单独安装本域。
 */
export const name = 'appilot-release';
export const inject = ['tools'];

export function apply(ctx: Context): void {
  for (const tool of [
    getReleaseDraft,
    checkReleaseReadiness,
    syncReleaseStatus,
    generateStoreCopy,
    reviseStoreCopy,
  ]) {
    ctx.tools.register(tool);
  }
}
