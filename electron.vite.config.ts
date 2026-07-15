import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const engineAlias = { '@engine': path.resolve(__dirname, 'src/engine') } as const;

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: engineAlias },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: engineAlias },
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src/renderer'),
        '@engine': path.resolve(__dirname, 'src/engine'),
      },
    },
  },
});
