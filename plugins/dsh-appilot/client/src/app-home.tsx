/**
 * Appilot 应用首页（shell.overlay 居中浮层，跨工作区全局）。
 * 内容：已注册项目列表 + 添加项目入口 + 全局入口（设置 / 任务中心）。
 * 项目数据经 agent 运行 list_projects 落在当前会话，浮层订阅会话节点自动更新。
 */
import { useEffect, useState } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { isHomeOpen, subscribeHome, closeHome } from './home-store';
import { collectToolResults, resultOf } from './helpers';
import { setRegistryCache, maybeRefreshRegistry, REGISTRY_LIST_PROMPT } from './registry-cache';

const LIST_PROMPT = REGISTRY_LIST_PROMPT;

interface AppHomeProps {
  useSessions: (sel: (s: any) => any) => any;
  useWorkspaces: (sel: (s: any) => any) => any;
  run?: (prompt: string) => Promise<unknown>;
  sessionObservable?: (id: string | null) => any;
  /** 注册的项目若尚无工作区，则新建工作区（返回 workspaceId）。 */
  createWorkspace?: (path: string) => Promise<string | null>;
}

export function AppHome(props: AppHomeProps) {
  const [visible, setVisible] = useState(isHomeOpen());
  const sessions = props.useSessions((s: any) => s);
  const currentId = sessions && sessions.current;
  const currentCwd = currentId ? sessions.byId?.[currentId]?.cwd ?? null : null;
  const workspaces = props.useWorkspaces((s: any) => s);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nodes, setNodes] = useState<readonly any[]>([]);
  const [addPath, setAddPath] = useState<string>('');

  // 默认填入当前工作区路径。
  useEffect(() => {
    if (visible && currentCwd && !addPath) setAddPath(currentCwd);
  }, [visible, currentCwd]);

  useEffect(() => subscribeHome(setVisible), []);

  // 订阅当前会话节点（list_projects 结果）。
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

  const results = collectToolResults(nodes);
  const listNode = results['list_projects'];
  const listValue = listNode ? resultOf(listNode.content).value : null;
  const projects = (listValue && listValue.projects) || [];

  // 观察到新的 list_projects 节点 → 更新共享缓存。
  useEffect(() => {
    if (listValue) setRegistryCache(listValue);
  }, [listValue]);

  // 打开时自动刷新列表：缓存缺失或过期才触发（旧节点不再挡住自动刷新）。
  useEffect(() => {
    if (visible && props.run) {
      maybeRefreshRegistry((prompt) => props.run!(prompt));
    }
  }, [visible, props.run]);

  if (!visible) return null;

  function runAction(id: string, prompt: string) {
    if (!props.run || busy) return;
    setBusy(id);
    setError(null);
    Promise.resolve(props.run(prompt))
      .catch((err: any) => setError(err && err.message ? err.message : String(err)))
      .then(() => setBusy(null));
  }

  /** 添加项目：路径缺工作区则自动新建工作区，然后注册 + 刷新。 */
  async function onAddProject() {
    const path = (addPath || '').trim();
    if (!path) {
      setError('请输入项目路径');
      return;
    }
    if (!props.run || busy) return;
    setBusy('add');
    setError(null);
    try {
      // 1) 该路径是否已有工作区？没有则新建。
      const existing = (workspaces?.items || []).some((w: any) => w.path === path);
      if (!existing) {
        if (!props.createWorkspace) throw new Error('无法新建工作区（workspaces 服务不可用）');
        await props.createWorkspace(path);
      }
      // 2) 注册项目（agent 运行 register_project）。
      await props.run(
        `请运行 register_project（路径为 ${JSON.stringify(path)}）注册该项目，` +
          '然后运行 list_projects 刷新列表。',
      );
    } catch (err: any) {
      setError(err && err.message ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {/* 遮罩：点击关闭 */}
      <div
        onClick={closeHome}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1200,
          background: 'rgba(0,0,0,0.4)',
          pointerEvents: 'auto',
        }}
      />
      {/* 居中浮层 */}
      <div
        style={{
          position: 'fixed',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 1201,
          width: 'min(760px, 92vw)',
          maxHeight: '82vh',
          overflow: 'auto',
          padding: 24,
          borderRadius: 18,
          border: '1px solid var(--dsw-alias-border-l2)',
          background: 'var(--dsw-alias-bg-layer-3)',
          boxShadow: 'var(--dsw-shadow-lv3)',
          color: 'var(--dsw-alias-label-primary)',
          fontSize: 14,
          lineHeight: '22px',
          pointerEvents: 'auto',
        }}
      >
        {/* 头部 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 16,
          }}
        >
          <div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>Appilot 首页</div>
            <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>
              应用运营总览——项目分散在各个工作区，这里统一管理
            </div>
          </div>
          <button
            type="button"
            onClick={closeHome}
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              border: '1px solid var(--dsw-alias-border-l2)',
              background: 'transparent',
              color: 'var(--dsw-alias-label-secondary)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            关闭
          </button>
        </div>

        {error ? (
          <div style={{ color: 'var(--dsw-alias-state-error-primary)', fontSize: 12, marginBottom: 10 }}>
            失败：{error}
          </div>
        ) : null}

        {/* 项目列表 */}
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
          已添加项目{listValue && typeof listValue.count === 'number' ? `（${listValue.count}）` : ''}
        </div>
        {!listNode ? (
          <div
            style={{
              padding: 16,
              borderRadius: 12,
              border: '1px dashed var(--dsw-alias-border-l2)',
              color: 'var(--dsw-alias-label-tertiary)',
              fontSize: 13,
            }}
          >
            正在获取项目列表（agent 运行 list_projects）…
          </div>
        ) : projects.length === 0 ? (
          <div
            style={{
              padding: 16,
              borderRadius: 12,
              border: '1px dashed var(--dsw-alias-border-l2)',
              color: 'var(--dsw-alias-label-tertiary)',
              fontSize: 13,
            }}
          >
            暂无注册项目。点「添加项目」注册当前工作区。
          </div>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {projects.map((p: any) => (
              <li
                key={p.name}
                style={{
                  padding: '10px 12px',
                  marginBottom: 8,
                  borderRadius: 12,
                  border: '1px solid var(--dsw-alias-border-l1)',
                  background: 'var(--dsw-alias-bg-layer-1)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500 }}>
                  {p.name}
                  {p.platform ? (
                    <span
                      style={{
                        padding: '1px 8px',
                        borderRadius: 999,
                        fontSize: 11,
                        background: 'var(--dsw-alias-interactive-bg-hover)',
                        color: 'var(--dsw-alias-label-secondary)',
                      }}
                    >
                      {p.platform}
                    </span>
                  ) : null}
                </div>
                <div
                  style={{
                    color: 'var(--dsw-alias-label-tertiary)',
                    fontSize: 12,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    marginTop: 2,
                  }}
                >
                  {p.path}
                  {p.githubUrl ? ' · ' + p.githubUrl : ''}
                  {p.languages && p.languages.length ? ' · ' + p.languages.length + ' 语言' : ''}
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* 操作行 */}
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => runAction('refresh', LIST_PROMPT)}
            style={actionBtn}
          >
            {busy === 'refresh' ? '刷新中…' : '刷新列表'}
          </button>
          <input
            value={addPath}
            onChange={(e) => setAddPath(e.target.value)}
            placeholder="项目路径（缺工作区时自动新建）"
            style={{
              flex: 1,
              minWidth: 220,
              padding: '7px 12px',
              borderRadius: 10,
              border: '1px solid var(--dsw-alias-border-l2)',
              background: 'var(--dsw-alias-bg-base)',
              color: 'var(--dsw-alias-label-primary)',
              fontSize: 13,
              lineHeight: '20px',
            }}
          />
          <button
            type="button"
            disabled={!!busy}
            onClick={onAddProject}
            style={{ ...actionBtn, background: 'var(--dsw-alias-button-info-fill)', color: '#fff' }}
          >
            {busy === 'add' ? '注册中…' : '添加项目'}
          </button>
        </div>

        {/* 全局入口 */}
        <div style={{ fontWeight: 600, fontSize: 14, margin: '18px 0 8px' }}>全局</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div style={entryCard}>
            <div style={{ fontWeight: 500 }}>任务中心</div>
            <div style={entryDesc}>
              定时任务（排名采集 / 发布同步）的状态与调度——规划中
            </div>
          </div>
          <div style={entryCard}>
            <div style={{ fontWeight: 500 }}>设置</div>
            <div style={entryDesc}>Appilot 配置（凭据 / 项目注册表）——规划中</div>
          </div>
        </div>

        <div style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 11, marginTop: 12 }}>
          项目数据来自 list_projects 工具运行结果（当前会话，可审计）。
        </div>
      </div>
    </>
  );
}

const actionBtn: React.CSSProperties = {
  padding: '7px 14px',
  borderRadius: 10,
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-interactive-bg-hover)',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 13,
  lineHeight: '20px',
  cursor: 'pointer',
};

const entryCard: React.CSSProperties = {
  padding: '12px 14px',
  borderRadius: 12,
  border: '1px dashed var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-1)',
};

const entryDesc: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--dsw-alias-label-tertiary)',
  marginTop: 2,
};
