/**
 * @appilot-labs/appilot — DSH 客户端 UI 插件入口（架构收敛 C4 后：轻量工具集）。
 *
 * 收敛决策（docs/architecture-convergence.md）：DSH 不做完整 GUI 壳——移除
 * 大型复刻 UI（全局首页浮层 / 侧边栏入口 / conversation 工作台面板），只保留
 * 「agent 工具 + 会话内结果卡片」的最小交互面：
 *  1. tool.call.toolview — Appilot 工具结果卡片（agent 调用即呈现）；
 *  2. conversation.composer.dock — 专属会话（`[Appilot] <名>`）输入区快捷按钮
 *     （一键让 agent 跑总览/发布/排名/任务工具）；
 *  3. conversation.session.header.utilities — AI 计量小卡（非 Appilot GUI）。
 *
 * 服务端工具集（appilot_tasks / appilot_task_run / appilot_snapshots /
 * appilot_overview + dsh-project 的 list/register）不变——任何会话的 agent
 * 均可调用；深链路 GUI 在 Electron。
 *
 * 构建：scripts/build-client.mjs（esbuild）→ client/client.js（__ModuleLoader__ 格式）。
 * 依赖（宿主提供，构建时 external）：react / react/jsx-runtime / @deepseek-ai/*。
 */
import { CSS, CSS_ID } from './styles';
import { ProjectCard, ReadinessCard, ReleaseStatusCard, OverviewCard } from './toolcards';
import { QuickActions } from './quick-actions';
import { AiUsage } from './ai-usage';

/* ── 主题样式注入（模块物化时执行；node 侧无 document 时跳过）── */
if (
  typeof document !== 'undefined' &&
  !document.querySelector(`style[data-plugin-css="${CSS_ID}"]`)
) {
  const style = document.createElement('style');
  style.dataset.plugin = '@appilot-labs/appilot';
  style.dataset.pluginCss = CSS_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

/** 插件使用的客户端服务（cordis inject 声明；缺省会抛 "cannot get property without inject"）。 */
export const inject = ['slots', 'sessions', 'workspaces'];

/** 注册入口。ctx 为宿主客户端 cordis 上下文。 */
export function apply(ctx: any) {
  // 0c. 会话头部右上角：AI 计量（对应独立应用头部右上角的 AI 用量）
  ctx.slots.inject('conversation.session.header.utilities', () =>
    ctx.slots.register(
      {
        name: 'conversation.session.header.utilities',
        id: 'appilot-ai-usage',
        order: 100,
        label: 'AI 用量',
      },
      AiUsage,
    ),
  );

  // 2. 专属会话输入区：快捷操作按钮（各模块主要任务）——渲染在 composer 卡片内部
  //    （conversation.composer.dock = InputBar 的 footer 位）。仅 Appilot 专属会话
  //    显示（见 quick-actions 标题前缀判断）。
  ctx.slots.inject('conversation.composer.dock', () =>
    ctx.slots.register(
      {
        name: 'conversation.composer.dock',
        id: 'appilot-quick-actions',
        order: 0,
        label: 'Appilot 快捷操作',
        inject: (dockSessionId: string) => ({
          send: (prompt: string) => {
            const conversation = ctx.sessions.scope(dockSessionId).get('conversation');
            if (!conversation) return Promise.reject(new Error('conversation 服务不可用'));
            return conversation.send(prompt);
          },
        }),
      },
      QuickActions,
    ),
  );

  // 3. 工具结果卡片（agent 调用 Appilot 工具后，在会话中可视化呈现）
  const cards: Array<[string, any]> = [
    ['appilot_overview', OverviewCard],
    ['resolve_current_project', ProjectCard],
    ['check_release_readiness', ReadinessCard],
    ['sync_release_status', ReleaseStatusCard],
  ];
  for (const [toolName, Card] of cards) {
    ctx.slots.inject('tool.call.toolview', () =>
      ctx.slots.register(
        {
          name: 'tool.call.toolview',
          key: toolName,
        },
        Card,
      ),
    );
  }
}
