/**
 * 共享组件（OverviewContent 等）的 scoped tailwind 构建配置。
 * - preflight 关闭：不注入全局 reset，避免污染 DSH 宿主 UI；
 * - darkMode 'class'：与 Electron 一致，DSH 侧由 OverviewDsh 给祖先加 `.dark`；
 * - content 指向整个 renderer（与应用一致），生成的工具类覆盖全部共享组件。
 * 产物由 scripts/build-client.mjs 读取并注入 client bundle。
 */
const path = require('node:path');

module.exports = {
  content: [path.join(__dirname, '..', '..', '..', 'src', 'renderer', '**', '*.{ts,tsx,html}')],
  darkMode: 'class',
  corePlugins: { preflight: false },
  theme: {
    extend: {
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [],
};
