import type { Context } from '@deepseek-ai/cordis';
import { createGetReleaseDraftTool } from '../tools/get-release-draft.js';
import { checkReleaseReadiness } from '../tools/check-release-readiness.js';
import { syncReleaseStatus } from '../tools/sync-release-status.js';
import { createGenerateStoreCopyTool } from '../tools/generate-store-copy.js';
import { createReviseStoreCopyTool } from '../tools/revise-store-copy.js';
import { ctxCredentialReader } from '../credentials.js';
import type { ProjectStore } from '../storage.js';

/**
 * @appilot/dsh 域插件：release（发布草稿 / readiness / 发布状态 / 文案生成与修订）。
 * AI 工具凭据经 ctx.credentials 解析；store 支持按已注册项目名引用。
 */
export const name = 'appilot-release';
export const inject = ['tools', 'credentials'];

export function apply(ctx: Context, config?: { store?: ProjectStore }): void {
  const reader = ctxCredentialReader(ctx);
  const store = config?.store;
  ctx.tools.register(createGetReleaseDraftTool(store));
  ctx.tools.register(checkReleaseReadiness);
  ctx.tools.register(syncReleaseStatus);
  ctx.tools.register(createGenerateStoreCopyTool(reader));
  ctx.tools.register(createReviseStoreCopyTool(reader));
}
