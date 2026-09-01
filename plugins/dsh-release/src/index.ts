import type { Context } from '@deepseek-ai/cordis';
import { createGetReleaseDraftTool } from './get-release-draft.js';
import { checkReleaseReadiness } from './check-release-readiness.js';
import { createSyncReleaseStatusTool } from './sync-release-status.js';
import { createGenerateStoreCopyTool } from './generate-store-copy.js';
import { createReviseStoreCopyTool } from './revise-store-copy.js';
import { ctxCredentialReader } from '@appilot-labs/appilot-common';
import type { ProjectStore } from '@appilot-labs/appilot-common';

/**
 * @appilot-labs/dsh 域插件：release（发布草稿 / readiness / 发布状态 / 文案生成与修订）。
 * AI 工具凭据经 ctx.credentials 解析；store 支持按已注册项目名引用。
 */
export const name = 'appilot-release';
export const inject = ['tools', 'credentials'];

export function apply(ctx: Context, config?: { store?: ProjectStore }): void {
  const reader = ctxCredentialReader(ctx);
  const store = config?.store;
  ctx.tools.register(createGetReleaseDraftTool(store));
  ctx.tools.register(checkReleaseReadiness);
  ctx.tools.register(createSyncReleaseStatusTool(reader));
  ctx.tools.register(createGenerateStoreCopyTool(reader));
  ctx.tools.register(createReviseStoreCopyTool(reader));
}
