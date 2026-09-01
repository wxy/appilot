/**
 * Appilot 客户端 UI 样式：宿主 CSS 变量（--dsw-alias-*），随深色/浅色自动适配。
 * 注入 id：@appilot-labs/appilot/client.css。
 */
export const CSS_ID = '@appilot-labs/appilot/client.css';

export const CSS = [
  /* DSH 对话固定宽度（--dsh-chat-content-width: 748px）——面板对齐该宽度并居中。 */
  '.ap-wb{display:flex;flex-direction:column;height:100%;min-height:0;max-width:748px;margin:0 auto;padding:20px 0 0;gap:14px;font-size:14px}',
  /* 面板（Appilot 视图）内不显示对话输入框（composer 对非 chat 视图默认仍渲染）。 */
  '[data-conversation-scroll]:has(.ap-wb) [data-composer-seat]{display:none}',
  '.ap-wb-header{display:flex;flex-direction:column;gap:2px}',
  '.ap-wb-title{font-size:15px;line-height:22px;font-weight:600;color:var(--dsw-alias-label-primary)}',
  '.ap-wb-sub{font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
  '.ap-wb-tabs{display:flex;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l2)}',
  '.ap-wb-tab{padding:7px 14px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:18px;border-radius:8px 8px 0 0;cursor:pointer}',
  '.ap-wb-tab:hover{color:var(--dsw-alias-label-primary)}',
  '.ap-wb-tab[data-active]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);font-weight:500}',
  '.ap-wb-body{flex:1;min-height:0;overflow:auto;padding-bottom:24px}',
  '.ap-empty{display:flex;flex-direction:column;gap:6px;padding:28px 20px;border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;color:var(--dsw-alias-label-secondary)}',
  '.ap-empty-title{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}',
  '.ap-empty-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
  '.ap-ov{display:flex;flex-direction:column;gap:14px}',
  '.ap-ov-card{display:flex;flex-direction:column;gap:8px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px}',
  '.ap-ov-card-title{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}',
  '.ap-ov-row{display:flex;flex-wrap:wrap;gap:6px}',
  '.ap-ov-kv{display:flex;gap:6px;font-size:12px;line-height:18px}',
  '.ap-ov-key{color:var(--dsw-alias-label-tertiary)}',
  '.ap-ov-val{color:var(--dsw-alias-label-primary)}',
  '.ap-btn{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;cursor:pointer}',
  '.ap-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.ap-btn:disabled{opacity:.55;cursor:default}',
  '.ap-ov-toolbar-row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}',
  '.ap-ov-usage{display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap}',
  '.ap-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:12px;line-height:18px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}',
  '.ap-chip-pass{color:var(--dsw-alias-state-success-primary)}',
  '.ap-chip-warn{color:var(--dsw-alias-state-warning-primary)}',
  '.ap-chip-fail{color:var(--dsw-alias-state-error-primary)}',
  '.ap-tool-card{display:flex;flex-direction:column;gap:6px;width:100%;min-width:0}',
  '.ap-tool-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}',
  '.ap-tool-meta{font-size:12px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.ap-tool-row{display:flex;flex-wrap:wrap;gap:6px}',
].join('');
