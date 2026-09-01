import type { Context } from '@deepseek-ai/cordis';
import { resolveCurrentProject } from './resolve-current-project.js';
import { getProjectContext } from './get-project-context.js';
import { createRegisterProjectTool } from './register-project.js';
import { createListProjectsTool } from './list-projects.js';
import type { ProjectStore } from '@appilot-labs/dsh-common';

/**
 * @appilot-labs/dsh 域插件：project（项目识别 / 上下文 / 注册表）。
 * store 由元插件注入（domain 存储或内存回退）。
 */
export const name = 'appilot-project';
export const inject = ['tools'];

export function apply(ctx: Context, config?: { store?: ProjectStore }): void {
  const store = config?.store;
  ctx.tools.register(resolveCurrentProject);
  ctx.tools.register(getProjectContext);
  if (store) {
    ctx.tools.register(createRegisterProjectTool(store));
    ctx.tools.register(createListProjectsTool(store));
  }
}
