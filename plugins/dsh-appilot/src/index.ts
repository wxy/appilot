import type { Context } from '@deepseek-ai/cordis';
import * as projectDomain from './domain/project.js';
import * as releaseDomain from './domain/release.js';

/**
 * @appilot/dsh — Appilot 的 DeepSeek Harness 元插件（插件组）。
 *
 * 用 ctx.plugin() 组合各域子插件（project / release）；每个子插件可独立
 * 安装（域拆分，见 docs/migration §10）。全部工具走 @appilot/core 同一代码路径。
 * 未来 keywords / reviews / workbench-ui 域插件加入同一组合。
 *
 * 分发形态演进：本元插件 + 各域插件一起发布；用户可只装
 * `@appilot/dsh`（全量）或单独域插件；Phase 6 用 loader 级 Group +
 * profile 声明式条目做整包 profile。
 */
export const name = 'appilot';
export const inject = ['tools'];

export function apply(ctx: Context): void {
  ctx.plugin(projectDomain);
  ctx.plugin(releaseDomain);
}
