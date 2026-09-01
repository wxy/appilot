/**
 * Appilot 专属会话编排：每个工作区（cwd）一个，标题 `[Appilot] <仓库名>`。
 *
 * 目的：刷新/简报/快捷操作都发到专属会话，避免污染用户正在工作的对话上下文；
 * 专属会话本身成为 Appilot 数据流的审计日志（侧边栏可见）。
 *
 * - findDedicatedId：按标题前缀 + cwd 从会话列表找已存在的专属会话；
 * - ensureDedicatedSession：find → 没有则 create + rename（幂等，模块级缓存按 cwd）；
 * - sendToDedicated：向专属会话发送提示词（触发 agent 运行工具）；
 * - dedicatedSessionObservable：专属会话的 binding.session（subscribe/getSnapshot）。
 */

const TITLE_PREFIX = '[Appilot] ';

let cache: { cwd: string; id: string } | null = null;

function repoNameOf(cwd: string): string {
  return cwd.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || cwd;
}

function titleFor(cwd: string): string {
  return TITLE_PREFIX + repoNameOf(cwd);
}

/** 从会话列表找已存在的专属会话（标题前缀 + cwd 匹配）。 */
export function findDedicatedId(
  sessionsList: any,
  cwd: string | null,
): string | null {
  if (!cwd || !sessionsList || !sessionsList.byId) return null;
  for (const id of Object.keys(sessionsList.byId)) {
    const s = sessionsList.byId[id];
    if (s && s.cwd === cwd && s.displayTitle && s.displayTitle.startsWith(TITLE_PREFIX)) {
      return id;
    }
  }
  return null;
}

/**
 * 确保专属会话存在（幂等）。返回 sessionId；无工作区/无法创建时返回 null。
 * @param ctx - 客户端 cordis 上下文（需 inject sessions/workspaces）
 * @param cwd - 当前工作目录（git 仓库路径）
 */
export async function ensureDedicatedSession(
  ctx: any,
  cwd: string | null,
): Promise<string | null> {
  if (!cwd) return null;

  // 模块级缓存：同一 cwd 直接复用（会话被删则失效重建）。
  if (cache && cache.cwd === cwd) {
    const live = ctx.sessions.list.getSnapshot().byId[cache.id];
    if (live && live.cwd === cwd) return cache.id;
    cache = null;
  }

  // 1) 列表里已有（重启后缓存丢失时按标题+cwd 找回）。
  const existing = findDedicatedId(ctx.sessions.list.getSnapshot(), cwd);
  if (existing) {
    cache = { cwd, id: existing };
    return existing;
  }

  // 2) 按 cwd 找 workspace，创建会话并改名。
  const workspaces = ctx.workspaces?.list?.getSnapshot?.() ?? null;
  const workspace = (workspaces?.items || []).find((w: any) => w.path === cwd);
  if (!workspace) return null;

  const sessionId: string = await ctx.sessions.create({ workspaceId: workspace.workspaceId });
  const binding = ctx.sessions.binding(sessionId);
  if (binding?.session?.rename) {
    await binding.session.rename(titleFor(cwd)).catch(() => {});
  }
  cache = { cwd, id: sessionId };
  return sessionId;
}

/** 向专属会话发送提示词（触发 agent 运行工具）。 */
export async function sendToDedicated(
  ctx: any,
  cwd: string | null,
  prompt: string,
): Promise<void> {
  const id = await ensureDedicatedSession(ctx, cwd);
  if (!id) throw new Error('无法创建 Appilot 专属会话（请先打开/新建一个工作区）');
  const conversation = ctx.sessions.scope(id).get('conversation');
  if (!conversation) throw new Error('conversation 服务不可用');
  await conversation.send(prompt);
}

/** 专属会话的 binding.session（可观察对象：getSnapshot/subscribe）。 */
export function dedicatedSessionObservable(ctx: any, id: string | null): any {
  if (!id) return null;
  return ctx.sessions.binding(id)?.session ?? null;
}
