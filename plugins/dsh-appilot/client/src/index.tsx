/**
 * @appilot-labs/appilot — DSH 客户端 UI 插件入口。
 *
 * 入口：
 *  1. conversation.view — 对话窗口第三个选项卡「Appilot」：工作台。总览/发布/趋势
 *     数据来自**专属会话**（`[Appilot] <仓库名>`）的工具运行结果——刷新/简报发到
 *     专属会话，不污染当前对话上下文。
 *  2. conversation.input.dock — 专属会话输入区的快捷操作按钮（各模块主要任务）。
 *  3. tool.call.toolview — Appilot 工具结果卡片。
 *
 * 构建：scripts/build-client.mjs（esbuild）→ client/client.js（__ModuleLoader__ 格式）。
 * 依赖（宿主提供，构建时 external）：react / react/jsx-runtime / @deepseek-ai/*。
 */
import { CSS, CSS_ID } from './styles';
import { AppilotWorkbench, REFRESH_PROMPT, BRIEF_PROMPT } from './workbench';
import { ProjectCard, ReadinessCard, ReleaseStatusCard, OverviewCard } from './toolcards';
import { QuickActions } from './quick-actions';
import { ProjectHome } from './project-home';
import { AppHome } from './app-home';
import { AiUsage } from './ai-usage';
import { sendToDedicated, ensureDedicatedSession, dedicatedSessionObservable } from './dedicated-session';

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
  // 0a. 侧边栏底部：Appilot 首页入口（点击打开全局首页浮层）
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register(
      {
        name: 'sidebar.footer.action',
        id: 'appilot-home',
        order: 0,
        label: 'Appilot',
        inject: () => ({
          run: (prompt: string) => {
            const current = ctx.sessions.list.getSnapshot().current;
            if (!current) return Promise.reject(new Error('未打开会话'));
            const conversation = ctx.sessions.scope(current).get('conversation');
            if (!conversation) return Promise.reject(new Error('conversation 服务不可用'));
            return conversation.send(prompt);
          },
          sessionObservable: (id: string | null) =>
            ctx.sessions.binding(id)?.session ?? null,
        }),
      },
      ProjectHome,
    ),
  );

  // 0b. 全局首页浮层（跨工作区：项目列表 + 添加项目 + 全局入口）
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      {
        name: 'shell.overlay',
        id: 'appilot-home',
        order: 100,
        label: 'Appilot 首页',
        inject: () => ({
          run: (prompt: string) => {
            const current = ctx.sessions.list.getSnapshot().current;
            if (!current) return Promise.reject(new Error('未打开会话'));
            const conversation = ctx.sessions.scope(current).get('conversation');
            if (!conversation) return Promise.reject(new Error('conversation 服务不可用'));
            return conversation.send(prompt);
          },
          sessionObservable: (id: string | null) =>
            ctx.sessions.binding(id)?.session ?? null,
          /** 注册的项目若尚无工作区，则新建工作区。 */
          createWorkspace: (path: string) =>
            ctx.workspaces.create({ path }).then((w: any) => w?.workspaceId ?? null),
        }),
      },
      AppHome,
    ),
  );

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

  // 1. 对话窗口第三个选项卡：Appilot 工作台（chat=0, trajectory=10, appilot=20）
  ctx.slots.inject('conversation.view', () =>
    ctx.slots.register(
      {
        name: 'conversation.view',
        id: 'appilot',
        order: 20,
        label: 'Appilot',
        inject: (sessionId: string) => {
          const cwdOf = () => {
            const cur = ctx.sessions.list.getSnapshot().byId[sessionId];
            return (cur && cur.cwd) || null;
          };
          const sendIn = (target: string, prompt: string) => {
            const conversation = ctx.sessions.scope(target).get('conversation');
            if (!conversation) return Promise.reject(new Error('conversation 服务不可用'));
            return conversation.send(prompt);
          };
          return {
            ensureDedicated: () => ensureDedicatedSession(ctx, cwdOf()),
            refresh: () => sendToDedicated(ctx, cwdOf(), REFRESH_PROMPT),
            refreshBrief: () => sendToDedicated(ctx, cwdOf(), BRIEF_PROMPT),
            /** 在当前会话运行（注册等操作——注册表是共享 store，结果落当前会话便于本面板读取）。 */
            runCurrent: (prompt: string) => sendIn(sessionId, prompt),
            dedicatedSession: (id: string | null) => dedicatedSessionObservable(ctx, id),
          };
        },
      },
      AppilotWorkbench,
    ),
  );

  // 2. 专属会话输入区：快捷操作按钮（各模块主要任务）——渲染在 composer 卡片内部
  //    （conversation.composer.dock = InputBar 的 footer 位），卡片自然长高容纳。
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

  // 3. 工具结果卡片
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
