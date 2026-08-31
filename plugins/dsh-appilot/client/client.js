/**
 * @appilot/dsh 客户端 UI 插件（浏览器端）。
 *
 * 加载方式：package.json 声明 `dsh.client`（platform: web）；web profile 的
 * client-modules 系统在重启时扫描宿主 loader 条目，编入 `window.__DSH_BOOT__`，
 * 浏览器端经 `window.__ModuleLoader__` 加载。
 *
 * 本文件提供三类可见 UI：
 * 1. `conversation.input.dock` — 输入区上方可展开的 Appilot 面板：
 *    - 头部点击展开/收起（chevron）
 *    - 展开后两列布局：左列操作按钮（一键触发 agent 调用 Appilot 工具），
 *      右列信息面板（注册项目 + 图表）
 * 2. `settings.section` — 设置页（导航中的 Appilot 页：项目/凭据概览）
 * 3. `tool.call.toolview` — 工具调用卡片（沿用既有骨架）
 *
 * 参考实现：@deepseek-ai/dsh-client-ui-conversation（QueueDock）、
 * @deepseek-ai/dsh-client-ui-agent-preset（settings.section）。
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

    var NS = 'en';

    /* ── 纯 SVG 迷你条形图 ──────────────────────────────────────────── */
    function BarChart({ data, width = 240, height = 64 }) {
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

    /* ── 输入区 dock：可展开的 Appilot 面板 ──────────────────────────── */
    /**
     * 按钮通过注入的 `send(text)` 调 conversation.send()，让 agent 在会话里
     * 执行对应 Appilot 工具，结果以 toolview 卡片（本插件注册）呈现。
     */
    function AppilotDock({ send, t }) {
      var _open = useState(false);
      var open = _open[0];
      var setOpen = _open[1];
      var actions = [
        { label: '列出已注册项目', prompt: '用 list_projects 工具列出已注册的 Appilot 项目。' },
        { label: '检查发布准备度', prompt: '对当前工作区仓库运行 check_release_readiness，并总结结果。' },
        { label: '同步发布状态', prompt: '对当前工作区仓库运行 sync_release_status，报告最新版本。' },
        { label: '生成商店文案', prompt: '对当前工作区仓库用 generate_store_copy 生成英文商店文案。' },
      ];
      return jsxRuntime.jsxs('div', {
        style: {
          width: 'calc(100% - var(--dsh-composer-side-clearance, 32px) * 2)',
          margin: '0 auto',
          borderRadius: 12,
          border: '1px solid var(--dsw-alias-border-l1, #e4e4e7)',
          background: 'var(--dsw-alias-bg-base, #fff)',
          overflow: 'hidden',
          font: '13px/1.5 ui-sans-serif, system-ui',
        },
        children: [
          jsxRuntime.jsx('button', {
            type: 'button',
            onClick: function () { setOpen(!open); },
            'aria-expanded': open,
            style: {
              width: '100%', display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 12px', border: 'none', background: 'none', cursor: 'pointer',
              color: 'var(--dsw-alias-label-primary, #18181b)', fontWeight: 600, fontSize: 13,
            },
            children: [
              jsxRuntime.jsx('span', { children: 'Appilot' }),
              jsxRuntime.jsx('span', {
                style: { flex: 1, textAlign: 'right', color: 'var(--dsw-alias-label-tertiary, #71717a)' },
                children: open ? '▾' : '▸',
              }),
            ],
          }),
          open && jsxRuntime.jsxs('div', {
            style: {
              display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
              gap: 12, padding: '8px 12px 12px', borderTop: '1px solid var(--dsw-alias-border-l1, #e4e4e7)',
            },
            children: [
              /* 左列：操作按钮 */
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
              /* 右列：信息面板（侧栏形态） */
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
                    children: '运行「列出已注册项目」后此处展示注册表；点击操作按钮可直接触发。',
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
          }),
        ],
      });
    }

    var dockInject = function (sessionId) {
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

    /* ── 设置页：Appilot 概览 ────────────────────────────────────────── */
    function AppilotSettingsSection({ t }) {
      return jsxRuntime.jsxs('div', {
        style: { font: '13px/1.6 ui-sans-serif, system-ui', color: 'var(--dsw-alias-label-primary, #18181b)' },
        children: [
          jsxRuntime.jsx('p', {
            style: { fontWeight: 600, margin: '0 0 8px' },
            children: 'Appilot',
          }),
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

    /* ── 插件体：注册可见入口 ────────────────────────────────────────── */
    var inject = ['slots'];

    function apply(ctx) {
      // 1) 输入区可展开面板（入口 + 侧栏式面板）
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'appilot',
        order: 5,
        locale: NS,
        inject: dockInject,
      }, AppilotDock));
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
