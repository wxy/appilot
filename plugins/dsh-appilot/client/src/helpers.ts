/**
 * 客户端工具函数：项目身份解析、工具结果解析、会话节点收集。
 */
import { jsx } from 'react/jsx-runtime';
import type { ReactNode } from 'react';

/** 路径 basename（与宿主 workspaceTitleOf 语义一致：末段非空路径段）。 */
export function basenameOf(cwd?: string | null): string {
  if (!cwd) return '';
  return String(cwd).replace(/[/\\]+$/, '').split(/[/\\]/).pop() || '';
}

/** 宿主标准 hook 形状（useSessions / useWorkspaces 均为 SnapshotSelectorHook）。 */
export type SnapshotSelectorHook = (selector: (snapshot: any) => any) => any;

export interface ProjectIdentity {
  name: string | null;
  cwd: string | null;
  workspaceId: string | null;
}

/**
 * 解析「当前项目名」：优先宿主工作区标题，其次当前会话 cwd 的 basename
 * （git 仓库名）。必须只在组件渲染期间调用。
 */
export function useProjectName(
  useSessions: SnapshotSelectorHook,
  useWorkspaces: SnapshotSelectorHook,
): ProjectIdentity {
  const sessions = useSessions((s: any) => s);
  const workspaces = useWorkspaces((s: any) => s);
  const currentId = sessions && sessions.current;
  const current = currentId && sessions.byId ? sessions.byId[currentId] : undefined;
  const cwd = current && current.cwd;
  let workspace: any = null;
  if (currentId && workspaces && workspaces.items) {
    for (const w of workspaces.items) {
      if (w && w.sessionIds && w.sessionIds.indexOf(currentId) !== -1) {
        workspace = w;
        break;
      }
    }
  }
  return {
    name: (workspace && workspace.title) || basenameOf(cwd) || null,
    cwd: cwd || null,
    workspaceId: workspace ? workspace.workspaceId : null,
  };
}

/**
 * 把工具结果 content 块展平成文本并尝试解析 JSON
 * （与 ui-tool 的 resultText 语义一致：text 块原文、其余块 pretty JSON）。
 */
export function resultOf(content: unknown): { text: string; value: any } {
  const parts: string[] = [];
  if (Array.isArray(content)) {
    for (const b of content) {
      if (b && b.type === 'text') parts.push(b.text);
      else if (b) parts.push(JSON.stringify(b, null, 2));
    }
  }
  const text = parts.join('\n');
  let value: any = null;
  try {
    value = JSON.parse(text);
  } catch {
    value = null;
  }
  return { text, value };
}

/** 会话节点中的 tool-result（`call.name` = 工具 wire 名，`content` = 结果块）。 */
export interface ToolResultNode {
  kind: string;
  seq: number;
  call: { name: string; argsRaw: string } | null;
  content: readonly any[];
}

/** 从会话节点里收集「每种工具最近一次已结算的 tool-result」。 */
export function collectToolResults(
  nodes: readonly any[] | undefined,
): Record<string, ToolResultNode> {
  const out: Record<string, ToolResultNode> = {};
  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      if (n && n.kind === 'tool-result' && n.call && n.call.name) {
        out[n.call.name] = n; // 节点按 seq 有序，后到者覆盖
      }
    }
  }
  return out;
}

/** 状态徽标。 */
export function chip(label: string, tone?: '' | 'pass' | 'warn' | 'fail'): ReactNode {
  let cls = 'ap-chip';
  if (tone === 'pass') cls += ' ap-chip-pass';
  else if (tone === 'warn') cls += ' ap-chip-warn';
  else if (tone === 'fail') cls += ' ap-chip-fail';
  return jsx('span', { className: cls, children: label });
}

/** readiness 状态 → 徽标音调（core 用 'warning'，归一化为 'warn'；'unknown' 无音调）。 */
export function statusTone(status?: string): '' | 'pass' | 'warn' | 'fail' {
  if (status === 'pass') return 'pass';
  if (status === 'fail') return 'fail';
  if (status === 'warning' || status === 'warn') return 'warn';
  return '';
}

/** 键值对文本（值为空时不渲染）。 */
export function kv(key: string, value: unknown): ReactNode {
  if (value === null || value === undefined || value === '') return null;
  return jsx(
    'span',
    { className: 'ap-ov-kv', children: [jsx('span', { className: 'ap-ov-key', children: key }), jsx('span', { className: 'ap-ov-val', children: String(value) })] },
  );
}
