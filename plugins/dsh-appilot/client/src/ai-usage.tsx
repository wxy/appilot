/**
 * AI 计量（会话头部右上角，对应独立应用应用级头部右上角的 AI 用量）。
 * 数据：宿主 tokenUsage 会话投影（useProjection('tokenUsage')）。
 */
import { jsx, jsxs } from 'react/jsx-runtime';

interface AiUsageProps {
  useProjection?: (key: string) => any;
}

export function AiUsage(props: AiUsageProps) {
  let usage: any = null;
  if (props.useProjection) {
    try {
      usage = props.useProjection('tokenUsage');
    } catch {
      usage = null;
    }
  }
  if (!usage) return null;
  const input = usage.inputTokens || 0;
  const cacheRead = usage.cacheReadTokens || 0;
  const cacheWrite = usage.cacheWriteTokens || 0;
  const output = usage.outputTokens || 0;
  const total = input + cacheRead + cacheWrite + output;
  if (total === 0) return null;
  return (
    <span
      title={`AI 用量（本会话）：输入 ${input} · 缓存读 ${cacheRead} · 缓存写 ${cacheWrite} · 输出 ${output}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 999,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-interactive-bg-hover)',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 11,
        lineHeight: '18px',
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden>⚡</span>
      {total.toLocaleString()} tokens
    </span>
  );
}
