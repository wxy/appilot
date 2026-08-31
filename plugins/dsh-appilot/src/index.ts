import type { Context } from '@deepseek-ai/cordis';
import * as projectDomain from './domain/project.js';
import * as releaseDomain from './domain/release.js';
import { createProjectStore } from './storage.js';

/**
 * @appilot/dsh — Appilot 的 DeepSeek Harness 元插件（插件组）。
 *
 * 用 ctx.plugin() 组合各域子插件（project / release）；每个子插件可独立
 * 安装（域拆分，见 docs/migration §10）。全部工具走 @appilot/core 同一代码路径。
 *
 * 存储：有宿主 domain 存储（web profile）用持久化实现，否则回退内存
 * （headless / 无存储环境，会话内仍可形成"注册→按名引用"循环）。
 */
export const name = 'appilot';
export const inject = ['tools'];

export function apply(ctx: Context): void {
  const store = createProjectStore(ctx);
  ctx.plugin(projectDomain, { store });
  ctx.plugin(releaseDomain, { store });
}
