import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // 忽略“同一模块既静态又动态导入、不会拆 chunk”的提示（无害，属预期）。
        onwarn(warning, warn) {
          if (warning.message?.includes('dynamic import will not move module into another chunk')) return;
          warn(warning);
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: [
        { find: /^@appilot-labs\/core\/(.+)$/, replacement: path.resolve(__dirname, 'packages/core/src') + '/$1' },
        { find: /^@appilot-labs\/appilot-core\/(.+)$/, replacement: path.resolve(__dirname, 'packages/core/src') + '/$1' },
        { find: /^@appilot-labs\/appilot-core$/, replacement: path.resolve(__dirname, 'packages/core/src/index.ts') },
        { find: '@', replacement: path.resolve(__dirname, 'src/renderer') },
      ],
    },
  },
});
