/**
 * 专属会话输入区的快捷操作按钮：用户直接点击触发各模块主要任务，
 * 不必回到工作台标签页。仅当当前会话是 Appilot 专属会话时显示。
 */
import { useState } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';

interface QuickActionsProps {
  sessionId: string;
  useSessions: (sel: (s: any) => any) => any;
  send?: (prompt: string) => Promise<unknown>;
}

const TITLE_PREFIX = '[Appilot] ';

const ACTIONS: Array<{ id: string; label: string; title: string; prompt: string }> = [
  {
    id: 'refresh',
    label: '刷新总览',
    title: '运行 appilot_overview 聚合项目/发布/readiness/排名/活动数据',
    prompt:
      '请运行 appilot_overview（路径使用当前工作目录）刷新 Appilot 总览数据；' +
      '如果已知该产品的跟踪关键词，请一并传入 keywords 参数。然后简要汇报结果。',
  },
  {
    id: 'release',
    label: '发布状态',
    title: '运行 sync_release_status 汇总 git tag 与 GitHub 发布',
    prompt: '请运行 sync_release_status（路径使用当前工作目录），汇总发布状态。',
  },
  {
    id: 'rank',
    label: '采集排名',
    title: '运行 appilot_overview 采集关键词实时排名（需 keywords）',
    prompt:
      '请运行 appilot_overview（路径使用当前工作目录，keywords 使用本项目跟踪关键词），' +
      '采集关键词在各商店的实时排名并汇报。',
  },
  {
    id: 'brief',
    label: '生成简报',
    title: '运行 appilot_overview（includeBrief=true）生成 AI 简报',
    prompt:
      '请运行 appilot_overview（路径使用当前工作目录，includeBrief=true），' +
      '生成 Appilot AI 简报（副驾驶简报），然后简要汇报建议事项。',
  },
];

export function QuickActions(props: QuickActionsProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = props.useSessions((s: any) => (s.current ? s.byId?.[s.current] : null));
  const isDedicated =
    !!current &&
    !!current.displayTitle &&
    current.displayTitle.startsWith(TITLE_PREFIX);

  if (!isDedicated || !props.send) return null;

  function run(action: { id: string; prompt: string }) {
    if (busyId) return;
    setBusyId(action.id);
    setError(null);
    Promise.resolve(props.send!(action.prompt))
      .catch((err: any) => setError(err && err.message ? err.message : String(err)))
      .then(() => setBusyId(null));
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 16px 10px',
        flexWrap: 'wrap',
      }}
    >
      {ACTIONS.map((action) => (
        <button
          key={action.id}
          type="button"
          title={action.title}
          disabled={busyId === action.id || undefined}
          onClick={() => run(action)}
          style={{
            padding: '4px 10px',
            borderRadius: 8,
            border: '1px solid var(--dsw-alias-border-l2)',
            background: 'var(--dsw-alias-interactive-bg-hover)',
            color: 'var(--dsw-alias-label-primary)',
            fontSize: 12,
            lineHeight: '18px',
            cursor: 'pointer',
            opacity: busyId === action.id ? 0.6 : 1,
          }}
        >
          {busyId === action.id ? '运行中…' : action.label}
        </button>
      ))}
      {error ? (
        <span style={{ fontSize: 11, color: 'var(--dsw-alias-state-error-primary)' }}>
          失败：{error}
        </span>
      ) : null}
    </div>
  );
}
