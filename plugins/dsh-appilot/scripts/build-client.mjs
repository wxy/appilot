#!/usr/bin/env node
/**
 * 构建 Appilot 客户端 UI 插件 → client/client.js（__ModuleLoader__ lazy-CJS 格式）。
 *
 * 1. tailwind：用 scripts/tailwind-overview.config.cjs 为共享组件（Electron 同款
 *    OverviewContent）生成 scoped 工具类 CSS（preflight 关闭），写入
 *    client/src/generated/tailwind-css.ts（随 bundle 注入）。
 * 2. esbuild：打包 client/src/index.tsx（export apply / inject），宿主提供的模块
 *    external（react / react/jsx-runtime / @deepseek-ai/*），其余内联。
 *
 * 用法：node scripts/build-client.mjs
 */
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url))); // plugins/dsh-appilot
const outFile = join(root, 'client', 'client.js');
const genDir = join(root, 'client', 'src', 'generated');
const genFile = join(genDir, 'tailwind-css.ts');

/* ── 1. scoped tailwind 构建 ── */
const twBin = resolve(root, '..', '..', 'node_modules', '.bin', 'tailwindcss');
const twOut = join(root, 'client', '.build', 'overview.css');
await mkdir(dirname(twOut), { recursive: true });
const tw = spawnSync(twBin, [
  '-c', join(root, 'scripts', 'tailwind-overview.config.cjs'),
  '-i', join(root, 'client', 'src', 'tailwind.overview.css'),
  '-o', twOut,
  '--minify',
], { cwd: root, encoding: 'utf8' });
if (tw.status !== 0) {
  console.error(tw.stderr || tw.stdout);
  throw new Error('tailwind build failed');
}
const tailwindCss = await readFile(twOut, 'utf8');
await mkdir(genDir, { recursive: true });
await writeFile(
  genFile,
  `// 由 scripts/build-client.mjs 生成（scoped tailwind 工具类，preflight 关闭）。请勿手改。\n` +
    `export const OVERVIEW_CSS_ID = '@appilot-labs/appilot/overview.css';\n` +
    `export const OVERVIEW_TAILWIND_CSS = ${JSON.stringify(tailwindCss)};\n`,
);
console.log('tailwind css →', twOut, `(${(tailwindCss.length / 1024).toFixed(0)} KB)`);

/* ── 2. esbuild 打包 ── */
const result = await build({
  entryPoints: [join(root, 'client', 'src', 'index.tsx')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/*'],
  write: false,
  minify: false,
  sourcemap: false,
  logLevel: 'info',
});

const body = result.outputFiles[0].text.trim();

const header = `/**
 * @appilot-labs/appilot — DSH 客户端 UI 插件（构建产物）。
 * 源：client/src（TS/TSX）；构建：scripts/build-client.mjs。请勿手改本文件。
 */
window.__ModuleLoader__.load({
  id: '@appilot-labs/appilot',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
`;

const footer = `
    return module.exports;
  },
});
`;

await writeFile(outFile, header + body + '\n' + footer);
console.log('client built →', outFile, `(${(body.length / 1024).toFixed(0)} KB)`);
