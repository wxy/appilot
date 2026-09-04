/**
 * /appilot 命令结果卡片（conversation.chat.commandview keyed renderer）。
 *
 * 宿主对命令长文本默认折叠（GenericCommandCard）——注册 key='appilot' 的
 * 自定义行组件，把命令输出渲染为「卡片 + 默认全展开」，消除折叠/单行问题。
 * 数据：CommandNode（node.outcome.text = 服务端直读 DB 生成的结构化文本）。
 */
import { jsx, jsxs } from 'react/jsx-runtime';

const SUB_LABEL: Record<string, string> = {
  projects: '项目与产品',
  rank: '排名采集概览',
  release: '发布摘要',
  task: '任务中心',
};

/** 卡片底色映射（语义色使用宿主 CSS 变量）。 */
function toneColor(tone: string): string {
  switch (tone) {
    case 'error':
      return 'var(--dsw-alias-state-error-primary)';
    case 'warn':
      return 'var(--dsw-alias-state-warn-primary)';
    default:
      return 'var(--dsw-alias-state-success-primary)';
  }
}

export function AppilotCommandCard(props: any) {
  // 兼容多种宿主传参形态：commandview owner={node}；个别版本经 props.node
  const cmd: any = props?.node?.data ?? props?.node ?? null;
  const outcome: any = cmd?.outcome ?? null;
  const args: string = cmd?.args ?? '';
  const sub = String(args.trim().split(/\s+/)[0] ?? '').toLowerCase();
  const subLabel = SUB_LABEL[sub] ?? (sub ? sub : '帮助');

  const card: React.CSSProperties = {
    borderRadius: 12,
    border: '1px solid var(--dsw-alias-border-l2)',
    background: 'var(--dsw-alias-bg-layer-3)',
    padding: '10px 12px',
    maxWidth: 640,
  };
  const head: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  };
  const title: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--dsw-alias-label-primary)',
  };
  const dot: React.CSSProperties = {
    width: 8,
    height: 8,
    borderRadius: 999,
    background: outcome
      ? outcome.kind === 'error'
        ? 'var(--dsw-alias-state-error-primary)'
        : 'var(--dsw-alias-state-success-primary)'
      : 'var(--dsw-alias-state-warn-primary)',
    animation: outcome ? undefined : 'dsw-pulse 1s infinite',
  };
  const body: React.CSSProperties = {
    margin: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontSize: 12.5,
    lineHeight: '19px',
    color: outcome?.kind === 'error'
      ? 'var(--dsw-alias-state-error-primary)'
      : 'var(--dsw-alias-label-secondary)',
    fontFamily: 'inherit',
  };

  const text = outcome?.text ?? '';
  return (
    <div style={card}>
      <div style={head}>
        <span style={dot} />
        <span style={title}>Appilot · {subLabel}</span>
        <span style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' }}>
          {outcome ? (outcome.kind === 'error' ? '执行失败' : '执行完成') : '执行中…'}
        </span>
      </div>
      <pre style={body}>{text || (outcome ? '(无输出)' : '正在读取共享数据库…')}</pre>
    </div>
  );
}
