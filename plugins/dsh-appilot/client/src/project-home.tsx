/**
 * 侧边栏底部入口（sidebar.footer.action）：Appilot 应用首页。
 * 点击打开全局居中浮层（AppHome，shell.overlay）——项目列表 + 添加项目 + 全局入口。
 * 按钮附带已注册项目数徽标（读当前会话的 list_projects 结果）。
 */
import { useEffect, useState } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { openHome } from './home-store';
import { collectToolResults, resultOf } from './helpers';

interface ProjectHomeProps {
  wide: boolean;
  useSessions: (sel: (s: any) => any) => any;
  useWorkspaces: (sel: (s: any) => any) => any;
  sessionObservable?: (id: string | null) => any;
}

export function ProjectHome(props: ProjectHomeProps) {
  const sessions = props.useSessions((s: any) => s);
  const currentId = sessions && sessions.current;
  const [nodes, setNodes] = useState<readonly any[]>([]);

  // 订阅当前会话节点（list_projects 结果 → 项目数徽标）。
  useEffect(() => {
    const session = props.sessionObservable ? props.sessionObservable(currentId) : null;
    if (!session) {
      setNodes([]);
      return;
    }
    const read = () => {
      const snapshot = session.getSnapshot ? session.getSnapshot() : null;
      setNodes((snapshot && snapshot.nodes) || []);
    };
    read();
    if (typeof session.subscribe === 'function') return session.subscribe(read);
  }, [currentId, props.sessionObservable]);

  const listNode = collectToolResults(nodes)['list_projects'];
  const listValue = listNode ? resultOf(listNode.content).value : null;
  const count =
    listValue && typeof listValue.count === 'number'
      ? listValue.count
      : listValue && Array.isArray(listValue.projects)
        ? listValue.projects.length
        : 0;

  return (
    <button
      type="button"
      onClick={openHome}
      title="Appilot 首页：已添加项目、添加项目、全局设置与任务中心"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: props.wide ? '7px 12px' : '8px',
        borderRadius: 10,
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 13,
        lineHeight: '18px',
        cursor: 'pointer',
        justifyContent: props.wide ? 'flex-start' : 'center',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background =
          'var(--dsw-alias-interactive-bg-hover)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600, flex: 'none' }}>A</span>
      {props.wide ? (
        <>
          <span style={{ flex: 'none' }}>Appilot</span>
          {count > 0 ? (
            <span
              style={{
                flex: 'none',
                minWidth: 18,
                height: 18,
                padding: '0 5px',
                borderRadius: 9,
                background: 'var(--dsw-alias-interactive-bg-hover)',
                color: 'var(--dsw-alias-label-secondary)',
                fontSize: 11,
                lineHeight: '18px',
                textAlign: 'center',
              }}
            >
              {count}
            </span>
          ) : null}
        </>
      ) : null}
    </button>
  );
}
