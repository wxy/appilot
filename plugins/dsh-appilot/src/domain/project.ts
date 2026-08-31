import type { Context } from '@deepseek-ai/cordis';
import { resolveCurrentProject } from '../tools/resolve-current-project.js';
import { getProjectContext } from '../tools/get-project-context.js';

/**
 * @appilot/dsh 域插件：project（项目识别 / 项目上下文）。
 * 独立可安装；由元插件 appilot 组合，用户也可单独安装本域。
 */
export const name = 'appilot-project';
export const inject = ['tools'];

export function apply(ctx: Context): void {
  ctx.tools.register(resolveCurrentProject);
  ctx.tools.register(getProjectContext);
}
