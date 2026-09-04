import type { Context } from '@deepseek-ai/cordis';
import { createProjectStore, ctxCredentialReader } from '@appilot-labs/appilot-common';
import * as projectDomain from '@appilot-labs/appilot-project';
import * as releaseDomain from '@appilot-labs/appilot-release';
import { createAppilotOverviewTool } from './overview.js';
import { createTasksStatusTool, createTaskRunTool } from './tasks.js';
import { createSnapshotsQueryTool } from './snapshots.js';
import { registerAppilotCommands } from './commands.js';

/**
 * @appilot-labs/dsh — Appilot 的 DeepSeek Harness 元插件（插件组）。
 *
 * 组合独立分发的域插件包（@appilot-labs/appilot-project / @appilot-labs/appilot-release）；
 * 每个域插件可单独安装（用户可按需只装 release 域等）。
 * 全部工具走 @appilot-labs/appilot-core 同一代码路径。
 *
 * 存储：共享注册表文件（方案 A）——Electron 与 DSH 共用 registry.json。
 */
export const name = 'appilot';
export const inject = ['tools', 'commands'];

export function apply(ctx: Context): void {
  const reader = ctxCredentialReader(ctx);
  const store = createProjectStore(ctx);
  ctx.plugin(projectDomain, { store });
  ctx.plugin(releaseDomain, { store });
  // 总览聚合工具（跨域，放在元插件）：刷新 Appilot 工作台总览页。
  ctx.tools.register(createAppilotOverviewTool(reader));
  // 任务中心：headless 租约选主调度（仅主壳执行任务）+ 状态工具。
  ctx.tools.register(createTasksStatusTool());
  // 排名快照只读查询（共享 DB：DSH 采集 + Electron 双写都能读）。
  ctx.tools.register(createSnapshotsQueryTool());
  // 任务显式触发（runNow：经常驻 daemon——DSH 不自行拉起调度器）。
  ctx.tools.register(createTaskRunTool());
  // 斜杠命令（/appilot task …）：任意会话可用，直读共享 DB，不经模型。
  registerAppilotCommands(ctx);
}
