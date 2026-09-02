/**
 * Appilot 工作台（conversation.view 第三个选项卡）。
 * 总览/发布/趋势数据来自**专属会话**（[Appilot] <仓库名>）的工具运行结果：
 * 刷新/简报经 conversation.send() 发到专属会话，不污染当前对话上下文。
 */
import { useEffect, useState } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import {
  useProjectName,
  collectToolResults,
  resultOf,
  type SnapshotSelectorHook,
} from './helpers';
import { OverviewDsh } from './overview-dsh';
import { ReleaseTab, TrendTab, TaskTab } from './tabs';
import { findDedicatedId } from './dedicated-session';
import { openHome } from './home-store';
import { setRegistryCache, maybeRefreshRegistry, REGISTRY_LIST_PROMPT } from './registry-cache';

/** 「刷新数据」提示词：让 agent 运行 appilot_overview 聚合工具（发到专属会话）。 */
export const REFRESH_PROMPT =
  '请运行 appilot_overview（路径使用当前工作目录）刷新 Appilot 总览数据；' +
  '如果已知该产品的跟踪关键词，请一并传入 keywords 参数（可采集实时排名）。' +
  '然后简要汇报结果。';

/** 「任务中心」提示词：让 agent 运行 appilot_tasks 读取定时任务状态。 */
export const TASKS_PROMPT = '请运行 appilot_tasks，查看 Appilot 定时任务状态，并简要汇报。';

/** 「生成简报」提示词：让 agent 运行 appilot_overview 并生成 AI 简报。 */
export const BRIEF_PROMPT =
  '请运行 appilot_overview（路径使用当前工作目录，includeBrief=true），' +
  '生成 Appilot AI 简报（副驾驶简报），然后简要汇报建议事项。';

const WB_TABS = [
  { id: 'overview', label: '总览' },
  { id: 'release', label: '发布' },
  { id: 'trend', label: '趋势' },
  { id: 'tasks', label: '任务' },
];

export interface WorkbenchProps {
  sessionId: string;
  useSessions: SnapshotSelectorHook;
  useWorkspaces: SnapshotSelectorHook;
  useProjection?: (key: string) => any;
  refresh?: () => Promise<unknown>;
  refreshBrief?: () => Promise<unknown>;
  refreshTasks?: () => Promise<unknown>;
  /** 在当前会话运行（注册等操作）。 */
  runCurrent?: (prompt: string) => Promise<unknown>;
  /** 专属会话的 binding.session 可观察对象（subscribe/getSnapshot）。 */
  dedicatedSession?: (id: string | null) => any;
  // 其余标准 props（useSession / useInput / inputActions…）暂不使用
}

export function AppilotWorkbench(props: WorkbenchProps) {
  const project = useProjectName(props.useSessions, props.useWorkspaces);
  const sessionsList = props.useSessions((s: any) => s);
  const currentId = sessionsList && sessionsList.current;
  const [dedicatedId, setDedicatedId] = useState<string | null>(null);
  const [dedicatedNodes, setDedicatedNodes] = useState<readonly any[]>([]);
  const [currentNodes, setCurrentNodes] = useState<readonly any[]>([]);
  const [activeTab, setActiveTab] = useState('overview');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regBusy, setRegBusy] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);

  // 当前会话节点：读取 list_projects 结果判断工作区是否已注册。
  useEffect(() => {
    const session = props.dedicatedSession ? props.dedicatedSession(currentId) : null;
    if (!session) {
      setCurrentNodes([]);
      return;
    }
    const read = () => {
      const snapshot = session.getSnapshot ? session.getSnapshot() : null;
      setCurrentNodes((snapshot && snapshot.nodes) || []);
    };
    read();
    if (typeof session.subscribe === 'function') return session.subscribe(read);
  }, [currentId, props.dedicatedSession]);

  // 专属会话在列表中出现时认领（首次打开/刷新后自动接上）。
  useEffect(() => {
    if (!project.cwd) return;
    const found = findDedicatedId(sessionsList, project.cwd);
    if (found) setDedicatedId(found);
  }, [sessionsList, project.cwd]);

  // 订阅专属会话的节点（工具结果所在）。会话列表变化时重试（新建会话的 binding 可能延迟物化）。
  useEffect(() => {
    const session = props.dedicatedSession ? props.dedicatedSession(dedicatedId) : null;
    if (!session) {
      setDedicatedNodes([]);
      return;
    }
    const read = () => {
      const snapshot = session.getSnapshot ? session.getSnapshot() : null;
      setDedicatedNodes((snapshot && snapshot.nodes) || []);
    };
    read();
    if (typeof session.subscribe === 'function') return session.subscribe(read);
  }, [dedicatedId, props.dedicatedSession, sessionsList]);

  function onRefresh() {
    if (!props.refresh || busy) return;
    setBusy(true);
    setError(null);
    Promise.resolve(props.refresh())
      .catch((err: any) => setError(err && err.message ? err.message : String(err)))
      .then(() => setBusy(false));
  }

  // 注册状态：当前工作区是否在 list_projects 注册表里。
  const regNode = collectToolResults(currentNodes)['list_projects'];
  const regValue = regNode ? resultOf(regNode.content).value : null;
  const registryKnown = !!regValue && Array.isArray(regValue.projects);
  const isRegistered =
    registryKnown &&
    !!project.cwd &&
    regValue.projects.some((p: any) => p && p.path === project.cwd);

  // 观察到新的 list_projects 节点 → 更新共享缓存。
  useEffect(() => {
    if (regValue) setRegistryCache(regValue);
  }, [regValue]);

  // 挂载时：注册表缓存缺失/过期则自动刷新一次（旧节点不再挡住判断）。
  useEffect(() => {
    if (props.runCurrent) {
      maybeRefreshRegistry((prompt) => props.runCurrent!(prompt));
    }
  }, [props.runCurrent]);

  if (registryKnown && !isRegistered) {
    return (
      <div className="ap-wb">
        <div className="ap-wb-body">
          <div className="ap-empty">
            <div className="ap-empty-title">此工作区尚未注册为 Appilot 项目</div>
            <div className="ap-empty-hint">
              {project.cwd ? project.cwd : '未选择工作区'}——注册后该工作区才启用 Appilot
              工作台（总览/发布/趋势）。
            </div>
            {regError ? (
              <div className="ap-empty-hint" style={{ color: 'var(--dsw-alias-state-error-primary)' }}>
                注册失败：{regError}
              </div>
            ) : null}
            <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="ap-btn"
                disabled={regBusy || !project.cwd || undefined}
                onClick={() => {
                  if (!props.runCurrent || !project.cwd || regBusy) return;
                  setRegBusy(true);
                  setRegError(null);
                  Promise.resolve(
                    props.runCurrent(
                      `请运行 register_project（路径为 ${JSON.stringify(project.cwd)}）注册此项目，` +
                        '然后运行 list_projects 刷新注册列表。',
                    ),
                  )
                    .catch((err: any) =>
                      setRegError(err && err.message ? err.message : String(err)),
                    )
                    .then(() => setRegBusy(false));
                }}
              >
                {regBusy ? '注册中…' : '注册此项目'}
              </button>
              <button
                type="button"
                className="ap-btn"
                disabled={regBusy || undefined}
                onClick={() => {
                  if (!props.runCurrent || regBusy) return;
                  setRegBusy(true);
                  setRegError(null);
                  Promise.resolve(props.runCurrent(REGISTRY_LIST_PROMPT))
                    .catch((err: any) =>
                      setRegError(err && err.message ? err.message : String(err)),
                    )
                    .then(() => setRegBusy(false));
                }}
              >
                重新检查
              </button>
              <span className="ap-wb-sub">注册后本页自动启用（也可在 Appilot 首页统一管理）</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ap-wb">
      <div className="ap-wb-header">
        <div className="ap-wb-title">
          Appilot 工作台{project.name ? ' · ' + project.name : ''}
        </div>
        <div className="ap-wb-sub">
          {project.cwd ? project.cwd : '未选择项目（新建/打开一个工作区后自动识别）'}
        </div>
      </div>
      <div className="ap-wb-tabs">
        {WB_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className="ap-wb-tab"
            data-active={tab.id === activeTab || undefined}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="ap-wb-body">
        {renderWbPanel(
          activeTab,
          project.cwd,
          dedicatedNodes,
          { busy, error, onRefresh },
          props.refreshBrief,
          props.refreshTasks,
        )}
      </div>
    </div>
  );
}

function renderWbPanel(
  tab: string,
  cwd: string | null,
  nodes: readonly any[] | undefined,
  actions: { busy: boolean; error: string | null; onRefresh: () => void },
  refreshBrief?: () => Promise<unknown>,
  refreshTasks?: () => Promise<unknown>,
) {
  const results = collectToolResults(nodes);
  const overviewNode = results['appilot_overview'];
  if (tab === 'release') {
    return <ReleaseTab node={overviewNode} />;
  }
  if (tab === 'trend') {
    return <TrendTab node={overviewNode} />;
  }
  if (tab === 'tasks') {
    return (
      <TaskTab
        node={results['appilot_tasks']}
        busy={actions.busy}
        onRefresh={() => {
          if (actions.busy || !refreshTasks) return;
          actions.onRefresh();
          Promise.resolve(refreshTasks()).catch(() => {});
        }}
      />
    );
  }
  return (
    <OverviewDsh
      cwd={cwd}
      aggregatedNode={overviewNode}
      actions={actions}
      onGenerateBrief={refreshBrief}
    />
  );
}

export function EmptyPanel(props: { title: string; hint: string }) {
  return (
    <div className="ap-empty">
      <div className="ap-empty-title">{props.title}</div>
      <div className="ap-empty-hint">{props.hint}</div>
    </div>
  );
}
