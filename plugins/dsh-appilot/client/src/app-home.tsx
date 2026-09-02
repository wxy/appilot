/**
 * Appilot 应用首页（shell.overlay 居中浮层，跨工作区全局）。
 *
 * 三方状态统一管理（数据源：注册表 list_projects × 宿主工作区列表）：
 * - 已添加项目（注册表）——按独立应用样式显示图标；未关联工作区的可「添加到工作区」；
 * - 未注册工作区——已存在的工作区尚未注册，可一键「注册」；
 * - 添加新项目——全新路径：自动补建工作区 + 注册 + App Store 适配性识别
 *   （platform 为 null 提示不适合 App Store 运营，本阶段暂不支持）。
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
  /** 打开项目到 Appilot：确保专属会话存在并发一次注册刷新（添加后默认可见面板）。 */
  openProject?: (path: string) => Promise<string | null>;
}

/** 独立应用样式的 App 图标（有 artworkUrl 用图，否则琥珀占位 ⌖）。 */
function AppIcon({ url, size = 40 }: { url?: string | null; size?: number }) {
  const base: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: Math.round(size * 0.3),
    border: '1px solid var(--dsw-alias-border-l2)',
    flex: 'none',
    overflow: 'hidden',
  };
  if (url) {
    return <img src={url} alt="" style={{ ...base, objectFit: 'cover' }} />;
  }
  return (
    <div
      style={{
        ...base,
        background: '#fef5e7',
        color: '#f59e0b',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.62),
      }}
    >
      ⌖
    </div>
  );
}

function normPath(p: string): string {
  return (p || '').replace(/[/\\]+$/, '');
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

  // 订阅当前会话节点（list_projects / register_project 结果）。
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
  const records = (listValue && listValue.projects) || [];

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

  function registerPath(path: string) {
    runAction(
      'reg:' + normPath(path),
      `请运行 register_project（路径为 ${JSON.stringify(path)}）注册此项目，` +
        '然后运行 list_projects 刷新注册列表。',
    );
  }

  async function addToWorkspace(path: string) {
    if (!props.createWorkspace || busy) return;
    setBusy('ws:' + normPath(path));
    setError(null);
    try {
      await props.createWorkspace(path);
      // 补专属会话：新建 workspace 默认无会话，Appilot 面板无处可见。
      await props.openProject?.(path);
    } catch (err: any) {
      setError(err && err.message ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  /** 添加新项目（情况 C）：路径缺工作区则自动新建工作区，然后注册 + 刷新。 */
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
      const existing = (workspaces?.items || []).some((w: any) => normPath(w.path) === normPath(path));
      if (!existing) {
        if (!props.createWorkspace) throw new Error('无法新建工作区（workspaces 服务不可用）');
        await props.createWorkspace(path);
      }
      await props.run(
        `请运行 register_project（路径为 ${JSON.stringify(path)}）注册该项目，` +
          '然后运行 list_projects 刷新列表。',
      );
      // 补专属会话：注册后让该项目有一个可见的 Appilot 面板（专属会话承载）。
      await props.openProject?.(path);
    } catch (err: any) {
      setError(err && err.message ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  // 三方匹配：注册表 × 工作区。
  const wsItems = (workspaces?.items || []) as any[];
  const regPaths = new Set(records.map((r: any) => normPath(r.path)));
  const wsByPath = new Map(wsItems.map((w: any) => [normPath(w.path), w]));
  const registeredNoWs = records.filter((r: any) => !wsByPath.has(normPath(r.path)));
  const unregisteredWs = wsItems.filter((w: any) => !regPaths.has(normPath(w.path)));
  const wsName = (w: any) => w.title || normPath(w.path).split(/[/\\]/).pop() || w.path;

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

        {/* 已添加项目（注册表） */}
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
          已添加项目{records.length > 0 ? `（${records.length}）` : ''}
        </div>
        {!listNode ? (
          <div style={emptyBox}>正在获取项目列表（agent 运行 list_projects）…</div>
        ) : records.length === 0 ? (
          <div style={emptyBox}>暂无注册项目——从下方工作区注册，或输入路径添加。</div>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {records.map((p: any) => {
              const noWs = !wsByPath.has(normPath(p.path));
              const warnPlatform = !p.platform;
              return (
                <li key={p.name} style={projectRow}>
                  <AppIcon url={p.artworkUrl} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 500 }}>{p.name}</span>
                      {p.platform ? (
                        <span style={platformBadge}>{p.platform}</span>
                      ) : (
                        <span
                          style={{
                            ...platformBadge,
                            background: 'var(--dsw-alias-state-warn-tertiary)',
                            color: 'var(--dsw-alias-state-warn-primary)',
                          }}
                          title="未检测到 Apple 平台（iOS/macOS）——可能不适合 App Store 运营"
                        >
                          未识别 Apple 平台
                        </span>
                      )}
                      {warnPlatform ? (
                        <span style={{ fontSize: 11, color: 'var(--dsw-alias-state-warn-primary)' }}>
                          暂不支持其运营功能
                        </span>
                      ) : null}
                    </div>
                    <div style={pathLine}>
                      {p.path}
                      {noWs ? ' · 未关联工作区' : ' · 已关联工作区'}
                    </div>
                  </div>
                  {noWs ? (
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => addToWorkspace(p.path)}
                      style={smallBtn}
                    >
                      {busy === 'ws:' + normPath(p.path) ? '创建中…' : '添加到工作区'}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {/* 未注册工作区（情况 A） */}
        {unregisteredWs.length > 0 ? (
          <>
            <div style={{ fontWeight: 600, fontSize: 14, margin: '18px 0 8px' }}>
              未注册的工作区{`（${unregisteredWs.length}）`}
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {unregisteredWs.map((w: any) => (
                <li key={w.workspaceId} style={projectRow}>
                  <AppIcon url={null} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 500 }}>{wsName(w)}</div>
                    <div style={pathLine}>{w.path}</div>
                  </div>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => registerPath(w.path)}
                    style={smallBtn}
                  >
                    {busy === 'reg:' + normPath(w.path) ? '注册中…' : '注册'}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {/* 添加新项目（情况 C） */}
        <div style={{ fontWeight: 600, fontSize: 14, margin: '18px 0 8px' }}>添加新项目</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={addPath}
            onChange={(e) => setAddPath(e.target.value)}
            placeholder="项目路径（缺工作区时自动新建；将识别是否适合 App Store）"
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
            {busy === 'add' ? '添加中…' : '添加项目'}
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', marginTop: 6 }}>
          未检测到 Apple 平台（iOS/macOS）的项目暂不支持运营功能（添加后仍会保留在列表中并标注）。
        </div>

        {/* 全局入口 */}
        <div style={{ fontWeight: 600, fontSize: 14, margin: '18px 0 8px' }}>全局</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div style={entryCard}>
            <div style={{ fontWeight: 500 }}>任务中心</div>
            <div style={entryDesc}>定时任务（发布同步 / readiness）的状态——见工作台「任务」标签页</div>
          </div>
          <div style={entryCard}>
            <div style={{ fontWeight: 500 }}>设置</div>
            <div style={entryDesc}>Appilot 配置（凭据 / 项目注册表）——规划中</div>
          </div>
        </div>

        <div style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 11, marginTop: 12 }}>
          项目数据来自 list_projects 工具运行结果（当前会话，可审计）；工作区数据来自宿主。
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

const smallBtn: React.CSSProperties = {
  flex: 'none',
  padding: '4px 10px',
  borderRadius: 8,
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-interactive-bg-hover)',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 12,
  lineHeight: '18px',
  cursor: 'pointer',
};

const projectRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 10px',
  marginBottom: 8,
  borderRadius: 12,
  border: '1px solid var(--dsw-alias-border-l1)',
  background: 'var(--dsw-alias-bg-layer-1)',
};

const platformBadge: React.CSSProperties = {
  padding: '1px 8px',
  borderRadius: 999,
  fontSize: 11,
  background: 'var(--dsw-alias-interactive-bg-hover)',
  color: 'var(--dsw-alias-label-secondary)',
};

const pathLine: React.CSSProperties = {
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 12,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  marginTop: 2,
};

const emptyBox: React.CSSProperties = {
  padding: 16,
  borderRadius: 12,
  border: '1px dashed var(--dsw-alias-border-l2)',
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 13,
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
