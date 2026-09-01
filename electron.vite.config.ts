import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: [
        { find: /^@appilot-labs\/core\/(.+)$/, replacement: path.resolve(__dirname, 'packages/core/src') + '/$1' },
        { find: '@appilot-labs/core', replacement: path.resolve(__dirname, 'packages/core/src/index.ts') },
        { find: '@', replacement: path.resolve(__dirname, 'src/renderer') },
      ],
    },
  },
});
