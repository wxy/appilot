/**
 * @appilot/dsh 客户端 UI 插件（浏览器端）。
 *
 * 入口设计（v2，按用户反馈调整）：
 * 1. `sidebar.footer.action` — 侧边栏底部「设置」按钮旁的 Appilot 按钮，
 *    点击弹出**锚定面板**（参照 Cordis 的 cordis-panel：侧栏按钮 + 浮动面板）。
 *    面板内含操作按钮（经 conversation.send() 触发 agent 执行 Appilot 工具）
 *    与项目概览（含 SVG 图表）——即「像独立应用一样的面板」的最小落点。
 * 2. `settings.section` — 设置导航中的 Appilot 页（项目/凭据概览）。
 * 3. `tool.call.toolview` — 工具调用结果卡片。
 *
 * 说明：当前插件为对话驱动，是因为专用面板 GUI 尚未实现（迁移文档 §11 的
 * Phase 3 工作台路线）；侧栏按钮 + 浮动面板是该路线在 0.1.x 槽位上的第一步。
 */
window.__ModuleLoader__.load({
  id: '@appilot/dsh',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    var react = require('react');
    var jsxRuntime = require('react/jsx-runtime');
    var useState = react.useState;
    var useEffect = react.useEffect;
    var useRef = react.useRef;

    var NS = 'en';

    /* ── 纯 SVG 迷你条形图 ──────────────────────────────────────────── */
    function BarChart({ data, width = 260, height = 72 }) {
      if (!Array.isArray(data) || data.length === 0) return null;
      var max = Math.max(1, ...data.map(function (d) { return d.value || 0; }));
      var barW = Math.max(2, Math.floor(width / data.length) - 4);
      return jsxRuntime.jsx('svg', {
        width: width,
        height: height,
        role: 'img',
        'aria-label': 'Appilot bar chart',
        children: data.map(function (d, i) {
          var h = Math.max(2, Math.round((d.value / max) * (height - 12)));
          return jsxRuntime.jsx('rect', {
            x: i * (barW + 4),
            y: height - h - 4,
            width: barW,
            height: h,
            rx: 2,
            fill: d.color || '#10b981',
          }, String(i));
        }),
      });
    }

    /* ── 面板内容：两列（操作 + 项目概览） ───────────────────────────── */
    function AppilotPanelContent({ send, t }) {
      var actions = [
        { label: '列出已注册项目', prompt: '用 list_projects 工具列出已注册的 Appilot 项目。' },
        { label: '检查发布准备度', prompt: '对当前工作区仓库运行 check_release_readiness，并总结结果。' },
        { label: '同步发布状态', prompt: '对当前工作区仓库运行 sync_release_status，报告最新版本。' },
        { label: '生成商店文案', prompt: '对当前工作区仓库用 generate_store_copy 生成英文商店文案。' },
      ];
      return jsxRuntime.jsxs('div', {
        style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 },
        children: [
          jsxRuntime.jsx('div', {
            children: [
              jsxRuntime.jsx('div', {
                style: { fontWeight: 600, marginBottom: 6, color: 'var(--dsw-alias-label-primary, #18181b)' },
                children: '操作',
              }),
              jsxRuntime.jsx('div', {
                style: { display: 'flex', flexDirection: 'column', gap: 6 },
                children: actions.map(function (a) {
                  return jsxRuntime.jsx('button', {
                    type: 'button',
                    onClick: function () { if (send) void send(a.prompt); },
                    style: {
                      textAlign: 'left', padding: '6px 10px', borderRadius: 8, cursor: 'pointer',
                      border: '1px solid var(--dsw-alias-border-l1, #e4e4e7)',
                      background: 'var(--dsw-alias-interactive-bg-hover, #f4f4f5)',
                      color: 'var(--dsw-alias-label-primary, #18181b)', fontSize: 13,
                    },
                    children: a.label,
                  }, a.label);
                }),
              }),
            ],
          }),
          jsxRuntime.jsx('div', {
            children: [
              jsxRuntime.jsx('div', {
                style: { fontWeight: 600, marginBottom: 6, color: 'var(--dsw-alias-label-primary, #18181b)' },
                children: '项目概览',
              }),
              jsxRuntime.jsx('div', {
                style: {
                  border: '1px solid var(--dsw-alias-border-l1, #e4e4e7)', borderRadius: 8,
                  padding: 8, color: 'var(--dsw-alias-label-secondary, #52525b)', fontSize: 12,
                },
                children: '点上方按钮触发 agent 运行工具，结果以卡片出现在对话里；注册表数据接线见工作台 UI 阶段。',
              }),
              jsxRuntime.jsx('div', { style: { marginTop: 8 }, children: jsxRuntime.jsx(BarChart, {
                data: [
                  { value: 3, color: '#10b981' },
                  { value: 1, color: '#f59e0b' },
                  { value: 2, color: '#3b82f6' },
                  { value: 0, color: '#71717a' },
                ],
              }) }),
            ],
          }),
        ],
      });
    }

    /* ── 侧边栏底部按钮 + 锚定弹出面板（参照 Cordis cordis-panel） ───── */
    function AppilotSidebarAction({ send, t }) {
      var _open = useState(false);
      var open = _open[0];
      var setOpen = _open[1];
      var rootRef = useRef(null);
      var _anchor = useState();
      var anchor = _anchor[0];
      var setAnchor = _anchor[1];

      useEffect(function () {
        if (!open) return;
        function place() {
          var rect = rootRef.current && rootRef.current.getBoundingClientRect();
          if (rect) setAnchor({ left: rect.right + 8, top: rect.top });
        }
        place();
        window.addEventListener('resize', place);
        function onDown(e) {
          if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
        }
        document.addEventListener('mousedown', onDown);
        return function () {
          window.removeEventListener('resize', place);
          document.removeEventListener('mousedown', onDown);
        };
      }, [open]);

      return jsxRuntime.jsxs('div', {
        ref: rootRef,
        style: { position: 'relative' },
        children: [
          jsxRuntime.jsx('button', {
            type: 'button',
            onClick: function () { setOpen(!open); },
            title: 'Appilot',
            'aria-label': 'Appilot',
            'aria-expanded': open,
            style: {
              display: 'grid', placeItems: 'center', width: 28, height: 28, borderRadius: 8,
              border: 'none', cursor: 'pointer',
              background: open
                ? 'var(--dsw-alias-interactive-bg-active, #e4e4e7)'
                : 'transparent',
              color: 'var(--dsw-alias-label-primary, #18181b)',
              font: '600 12px/1 ui-sans-serif, system-ui',
            },
            children: 'A',
          }),
          open && anchor && jsxRuntime.jsx('div', {
            style: {
              position: 'fixed', left: anchor.left, top: anchor.top, zIndex: 1000,
              width: 380, maxHeight: '70vh', overflowY: 'auto',
              borderRadius: 12, padding: 12,
              border: '1px solid var(--dsw-alias-border-l1, #e4e4e7)',
              background: 'var(--dsw-alias-bg-base, #fff)',
              boxShadow: '0 8px 28px rgba(0,0,0,.16)',
              font: '13px/1.5 ui-sans-serif, system-ui',
            },
            children: [
              jsxRuntime.jsx('div', {
                style: { fontWeight: 700, marginBottom: 10, color: 'var(--dsw-alias-label-primary, #18181b)' },
                children: 'Appilot',
              }),
              jsxRuntime.jsx(AppilotPanelContent, { send: send, t: t }),
            ],
          }),
        ],
      });
    }

    /* ── 设置页：Appilot 概览 ────────────────────────────────────────── */
    function AppilotSettingsSection({ t }) {
      return jsxRuntime.jsxs('div', {
        style: { font: '13px/1.6 ui-sans-serif, system-ui', color: 'var(--dsw-alias-label-primary, #18181b)' },
        children: [
          jsxRuntime.jsx('p', { style: { fontWeight: 600, margin: '0 0 8px' }, children: 'Appilot' }),
          jsxRuntime.jsx('p', {
            style: { margin: '0 0 12px', color: 'var(--dsw-alias-label-secondary, #52525b)' },
            children:
              'App 运营 Agent：项目注册表 / 发布草稿 / readiness / 商店文案。凭据通过环境变量或宿主凭据存储配置（APILOT_AI_* / GITHUB_TOKEN）。',
          }),
          jsxRuntime.jsx('div', {
            style: {
              border: '1px solid var(--dsw-alias-border-l1, #e4e4e7)', borderRadius: 8,
              padding: 10, color: 'var(--dsw-alias-label-tertiary, #71717a)',
            },
            children: '已注册项目列表与凭据状态将在此展示（数据接线见工作台 UI 阶段）。',
          }),
        ],
      });
    }

    /* ── resolve_current_project 卡片（沿用） ────────────────────────── */
    function ProjectCard({ toolName }) {
      return jsxRuntime.jsxs('div', {
        style: { padding: '8px 12px', font: '13px/1.5 ui-sans-serif, system-ui' },
        children: [
          jsxRuntime.jsx('div', {
            style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary, #18181b)' },
            children: toolName || 'resolve_current_project',
          }),
          jsxRuntime.jsx('pre', {
            style: {
              margin: '6px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              color: 'var(--dsw-alias-label-secondary, #52525b)',
              font: '12px/1.5 ui-monospace, SFMono-Regular, monospace',
            },
            children: 'Project card — renders repo context here.',
          }),
        ],
      });
    }

    /* ── 会话作用域的 send 注入（当前会话） ──────────────────────────── */
    var sendInject = function (sessionId) {
      try {
        var actx = ctx.sessions.scope(sessionId);
        var conversation = actx && actx.get('conversation');
        if (!conversation) return {};
        return {
          send: function (text) { return conversation.send(text); },
        };
      } catch (err) {
        return {};
      }
    };

    /* ── 插件体 ──────────────────────────────────────────────────────── */
    var inject = ['slots'];

    function apply(ctx) {
      // 1) 侧边栏底部按钮 + 弹出面板（主入口）
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'appilot',
        order: 5,
        locale: NS,
        inject: sendInject,
      }, AppilotSidebarAction));
      // 2) 设置页
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'appilot',
        order: 50,
        label: () => 'Appilot',
        locale: NS,
      }, AppilotSettingsSection));
      // 3) 工具调用卡片
      ctx.slots.inject('tool.call.toolview', function* () {
        yield ctx.slots.register({
          name: 'tool.call.toolview',
          key: 'resolve_current_project',
          locale: NS,
        }, ProjectCard);
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
