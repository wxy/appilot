/**
 * @appilot/dsh 客户端 UI 插件（浏览器端）。
 *
 * 加载方式：package.json 声明 `dsh.client`（platform: web）；web profile 的
 * client-modules 系统在重启时扫描宿主 loader 条目，收集本模块并编入
 * `window.__DSH_BOOT__` 入口图，浏览器端经 `window.__ModuleLoader__` 加载。
 *
 * 本骨架注册 `tool.call.toolview` keyed slot：为 Appilot 工具名注册自定义
 * React 卡片，替换通用工具行。包含一个纯 SVG 图表组件——证明 Harness Web
 * 前端可渲染图表/表格等富交互（对应迁移文档 §12 结论）。
 *
 * 参考实现：@deepseek-ai/dsh-client-ui-tool（FileMutationRow / ReadRow）。
 */
window.__ModuleLoader__.load({
  id: '@appilot/dsh-client',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    var react = require('react');
    var jsxRuntime = require('react/jsx-runtime');

    var NS = 'en';

    /* ── 纯 SVG 迷你条形图：证明图表渲染可行性 ─────────────────────── */
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

    /* ── resolve_current_project 卡片 ───────────────────────────────── */
    function ProjectCard({ toolName, block }) {
      var title = toolName || 'resolve_current_project';
      return jsxRuntime.jsxs('div', {
        style: { padding: '8px 12px', font: '13px/1.5 ui-sans-serif, system-ui' },
        children: [
          jsxRuntime.jsx('div', {
            style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary, #18181b)' },
            children: title,
          }),
          jsxRuntime.jsx('pre', {
            style: {
              margin: '6px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              color: 'var(--dsw-alias-label-secondary, #52525b)',
              font: '12px/1.5 ui-monospace, SFMono-Regular, monospace',
            },
            children: 'Project card — renders repo context here. See Appilot workbench UI phase.',
          }),
        ],
      });
    }

    /* ── check_release_readiness 卡片：彩色清单 + 图表 ───────────────── */
    function ReadinessCard() {
      var items = [
        { id: 'version', label: '版本 tag', status: 'pass', detail: 'v0.4.4 已存在' },
        { id: 'languages', label: '商店语言文案', status: 'warning', detail: '缺 zh-Hans 文案' },
        { id: 'asc', label: 'ASC 状态', status: 'fail', detail: '未配置凭据' },
      ];
      var colors = { pass: '#10b981', warning: '#f59e0b', fail: '#ef4444' };
      return jsxRuntime.jsxs('div', {
        style: { padding: '8px 12px', font: '13px/1.5 ui-sans-serif, system-ui' },
        children: [
          jsxRuntime.jsx('div', {
            style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary, #18181b)' },
            children: 'check_release_readiness',
          }),
          jsxRuntime.jsx('ul', {
            style: { margin: '6px 0', padding: 0, listStyle: 'none' },
            children: items.map(function (it) {
              return jsxRuntime.jsxs('li', {
                style: { display: 'flex', gap: 8, alignItems: 'baseline', padding: '2px 0' },
                children: [
                  jsxRuntime.jsx('span', {
                    style: {
                      width: 8, height: 8, borderRadius: 4, background: colors[it.status],
                      alignSelf: 'center',
                    },
                  }),
                  jsxRuntime.jsx('span', { style: { fontWeight: 500 }, children: it.label }),
                  jsxRuntime.jsx('span', { style: { color: 'var(--dsw-alias-label-tertiary, #71717a)' }, children: it.detail }),
                ],
              }, it.id);
            }),
          }),
          jsxRuntime.jsx(BarChart, {
            data: [
              { value: 3, color: '#10b981' },
              { value: 1, color: '#f59e0b' },
              { value: 2, color: '#3b82f6' },
              { value: 0, color: '#71717a' },
            ],
          }),
        ],
      });
    }

    /* ── sync_release_status 卡片：tag 时间线条形图 ──────────────────── */
    function ReleaseStatusCard({ toolName }) {
      return jsxRuntime.jsxs('div', {
        style: { padding: '8px 12px', font: '13px/1.5 ui-sans-serif, system-ui' },
        children: [
          jsxRuntime.jsx('div', {
            style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary, #18181b)' },
            children: toolName || 'sync_release_status',
          }),
          jsxRuntime.jsx(BarChart, {
            data: [
              { value: 6, color: '#10b981' },
              { value: 9, color: '#10b981' },
              { value: 4, color: '#10b981' },
              { value: 7, color: '#10b981' },
            ],
          }),
          jsxRuntime.jsx('div', {
            style: { color: 'var(--dsw-alias-label-tertiary, #71717a)', fontSize: 12 },
            children: 'Release timeline — bind to tool result in the workbench UI phase.',
          }),
        ],
      });
    }

    /* ── 插件体：注册 keyed toolview 卡片 ────────────────────────────── */
    var inject = ['slots'];

    function apply(ctx) {
      ctx.slots.inject('tool.call.toolview', function* () {
        yield ctx.slots.register({
          name: 'tool.call.toolview',
          key: 'resolve_current_project',
          locale: NS,
        }, ProjectCard);
        yield ctx.slots.register({
          name: 'tool.call.toolview',
          key: 'check_release_readiness',
          locale: NS,
        }, ReadinessCard);
        yield ctx.slots.register({
          name: 'tool.call.toolview',
          key: 'sync_release_status',
          locale: NS,
        }, ReleaseStatusCard);
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
