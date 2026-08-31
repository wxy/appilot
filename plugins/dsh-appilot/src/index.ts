import type { Context } from '@deepseek-ai/cordis';
import { createProjectStore } from '@appilot/dsh-common';
import * as projectDomain from '@appilot/dsh-project';
import * as releaseDomain from '@appilot/dsh-release';

/**
 * @appilot/dsh — Appilot 的 DeepSeek Harness 元插件（插件组）。
 *
 * 组合独立分发的域插件包（@appilot/dsh-project / @appilot/dsh-release）；
 * 每个域插件可单独安装（用户可按需只装 release 域等）。
 * 全部工具走 @appilot/core 同一代码路径。
 *
 * 存储：有宿主 domain 存储（web profile）用持久化实现，否则回退内存。
 */
export const name = 'appilot';
export const inject = ['tools'];

export function apply(ctx: Context): void {
  const store = createProjectStore(ctx);
  ctx.plugin(projectDomain, { store });
  ctx.plugin(releaseDomain, { store });
}
