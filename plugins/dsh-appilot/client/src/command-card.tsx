/**
 * /appilot 命令结果卡片（conversation.chat.commandview keyed renderer）。
 *
 * 宿主对命令长文本默认折叠——注册 key='appilot' 的自定义行组件，输出
 * 「卡片 + 默认全展开」。文本渲染增强：子命令主题色、键值行对齐、
 * 状态词（ok/err/never/✓ 等）着色、列表行缩进。
 */
import { jsx, Fragment } from 'react/jsx-runtime';

/* ── 子命令主题色（头部色条/标题点） ── */
const THEME: Record<string, { accent: string; label: string }> = {
  projects: { accent: '#818cf8', label: '项目与产品' },
  rank: { accent: '#a78bfa', label: '排名采集概览' },
  release: { accent: '#38bdf8', label: '发布摘要' },
  task: { accent: '#34d399', label: '任务中心' },
};
const FALLBACK_THEME = { accent: '#a1a1aa', label: 'Appilot' };
/** 主题色 12% 叠加（亮暗主题都安全：暗色下偏黑、亮色下浅 tint）。 */
const softOf = (accent: string) => `color-mix(in srgb, ${accent} 14%, transparent)`;

/* 行内状态词 → 语义色 */
const TOKEN_RULES: Array<{ re: RegExp; color: string }> = [
  { re: /✓/g, color: 'var(--dsw-alias-state-success-primary)' },
  { re: /\bok \d+\b/g, color: 'var(--dsw-alias-state-success-primary)' },
  { re: /\b(err|error) \d+\b/g, color: 'var(--dsw-alias-state-error-primary)' },
  { re: /\bnever \d+\b/g, color: 'var(--dsw-alias-label-tertiary)' },
  { re: /\b(失败|未运行|未到期|已到期未采到|部分覆盖|有失败)\b/g, color: 'var(--dsw-alias-state-error-primary)' },
  { re: /\b(已全采到|全采到|覆盖齐)\b/g, color: 'var(--dsw-alias-state-success-primary)' },
  { re: /\b(未过半|过半)\b/g, color: 'var(--dsw-alias-state-warn-primary)' },
];

/** 行内着色：将文本按 token 规则切分成带色 span。 */
function tint(text: string) {
  const parts: any[] = [];
  let rest = text;
  // 迭代所有规则的最小命中位置，逐步切分（朴素但够用）
  interface Hit { index: number; len: number; color: string; raw: string }
  const find = (): Hit | null => {
    let best: Hit | null = null;
    for (const r of TOKEN_RULES) {
      const m = r.re.exec(rest);
      if (m && (best === null || m.index < best.index)) {
        best = { index: m.index, len: m[0].length, color: r.color, raw: m[0] };
      }
    }
    for (const r of TOKEN_RULES) r.re.lastIndex = 0;
    return best;
  };
  let guard = 0;
  while (rest.length > 0 && guard++ < 200) {
    const hit = find();
    if (!hit || hit.index > rest.length) {
      if (rest) parts.push(rest);
      break;
    }
    if (hit.index > 0) parts.push(rest.slice(0, hit.index));
    parts.push(
      jsx('span', { style: { color: hit.color, fontWeight: 600 }, children: hit.raw }),
    );
    rest = rest.slice(hit.index + hit.len);
  }
  if (parts.length === 0) parts.push(rest);
  return parts;
}

function Row({ kind, children }: { kind: 'kv' | 'bullet' | 'para'; children: any }) {
  const base: React.CSSProperties = { lineHeight: '19px' };
  if (kind === 'bullet') {
    return jsx('div', {
      style: { ...base, display: 'flex', gap: 6, alignItems: 'baseline' },
      children: [
        jsx('span', { style: { color: 'var(--dsw-alias-label-tertiary)' }, children: '▸' }),
        jsx('span', { style: { flex: 1, minWidth: 0 }, children }),
      ],
    });
  }
  if (kind === 'kv') {
    const [label, ...valueParts] = children.props?.content ?? [];
    const labelText = label;
    const valueText = (valueParts || []).join('：');
    return jsx('div', {
      style: { ...base, display: 'flex', gap: 8 },
      children: [
        jsx('span', {
          style: { flex: '0 0 120px', color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 },
          children: labelText,
        }),
        jsx('span', { style: { flex: 1, minWidth: 0 }, children: valueText }),
      ],
    });
  }
  return jsx('div', { style: { ...base, paddingLeft: 2 }, children });
}

function TableBlock({ rows }: { rows: string[][] }) {
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  const cellStyle: React.CSSProperties = {
    padding: '3px 10px 3px 0',
    fontSize: 12,
    textAlign: 'left',
    whiteSpace: 'nowrap',
  };
  const thStyle: React.CSSProperties = {
    ...cellStyle,
    color: 'var(--dsw-alias-label-tertiary)',
    fontWeight: 600,
    borderBottom: '1px solid var(--dsw-alias-border-l2)',
  };
  const tdStyle: React.CSSProperties = {
    ...cellStyle,
    color: 'var(--dsw-alias-label-secondary)',
    borderBottom: '1px solid var(--dsw-alias-border-l1)',
  };
  const tintCell = (v: string) => jsx('span', { children: tint(v) });
  return jsx('table', {
    style: { borderCollapse: 'collapse', width: '100%' },
    children: [
      jsx('thead', {
        children: jsx('tr', {
          children: header.map((h, i) =>
            jsx('th', { key: i, style: thStyle, children: tintCell(h) }),
          ),
        }),
      }),
      jsx('tbody', {
        children: body.map((r, ri) =>
          jsx('tr', {
            key: ri,
            children: r.map((v, ci) =>
              jsx('td', { key: ci, style: tdStyle, children: tintCell(v) }),
            ),
          }),
        ),
      }),
    ],
  });
}

function Lines({ text }: { text: string }) {
  const lines = String(text || '').split('\n');
  const out: any[] = [];
  // 收集连续含 '|' 的行 → 表格块；其余按普通行渲染
  let tableRows: string[][] | null = null;
  const flushTable = () => {
    if (tableRows && tableRows.length > 0) {
      out.push(jsx('div', { key: 't' + out.length, style: { overflowX: 'auto' }, children: jsx(TableBlock, { rows: tableRows }) }));
      tableRows = null;
    }
  };
  lines.forEach((ln, i) => {
    const line = ln.trimEnd();
    if (!line.trim()) {
      flushTable();
      return;
    }
    if (line.includes('|')) {
      tableRows = tableRows ?? [];
      tableRows.push(line.split('|').map((s) => s.trim()).filter((s, idx, arr) => !(idx === 0 && s === '') && !(idx === arr.length - 1 && s === '')));
      return;
    }
    flushTable();
    const isFirst = i === 0;
    const content = tint(line);
    out.push(
      jsx('div', {
        key: i,
        style: isFirst
          ? { fontWeight: 600, color: 'var(--dsw-alias-label-primary)', marginBottom: 3, lineHeight: '20px' }
          : { paddingLeft: 2, lineHeight: '19px' },
        children: content,
      }),
    );
  });
  flushTable();
  return jsx('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 }, children: out });
}

export function AppilotCommandCard(props: any) {
  const cmd: any = props?.node?.data ?? props?.node ?? null;
  const outcome: any = cmd?.outcome ?? null;
  const args: string = cmd?.args ?? '';
  const sub = String(args.trim().split(/\s+/)[0] ?? '').toLowerCase();
  const theme = THEME[sub] ?? FALLBACK_THEME;
  const running = !outcome;
  const isError = outcome?.kind === 'error';
  const text = outcome?.text ?? '';

  return (
    <div
      style={{
        borderRadius: 14,
        border: '1px solid var(--dsw-alias-border-l2)',
        overflow: 'hidden',
        maxWidth: 680,
        boxShadow: 'var(--dsw-shadow-lv1)',
      }}
    >
      {/* 主题色头条 */}
      <div style={{ height: 3, background: `linear-gradient(90deg, ${theme.accent}, transparent)` }} />
      <div
        style={{
          background: softOf(theme.accent),
          padding: '8px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          borderBottom: '1px solid var(--dsw-alias-border-l2)',
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: running
              ? 'var(--dsw-alias-state-warn-primary)'
              : isError
                ? 'var(--dsw-alias-state-error-primary)'
                : 'var(--dsw-alias-state-success-primary)',
          }}
        />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }}>
          /appilot {sub}
        </span>
        <span style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' }}>
          {running ? '执行中…' : isError ? '执行失败' : '执行完成'}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' }}>
          {theme.label}
        </span>
      </div>
      <div style={{ padding: '10px 14px 12px', background: 'var(--dsw-alias-bg-layer-3)' }}>
        {running ? (
          <div style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)' }}>
            正在读取共享数据库…
          </div>
        ) : text ? (
          jsx(Lines, { text })
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-tertiary)' }}>（无输出）</div>
        )}
      </div>
    </div>
  );
}
