/**
 * SSR 冒烟测试：
 * 1) bundle 层：加载 client/client.js，执行 apply，渲染 AppilotWorkbench（空态）——抓渲染期崩溃；
 * 2) 源码层：直接渲染共享组件 OverviewContent（全量数据路径）——验证数据渲染与关键区块。
 * 说明：工作台节点走专属会话的 effect 订阅，renderToString 不跑 effect，故数据路径在源码层测。
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import React from 'react';

// 仓库根：scripts/ → plugins/dsh-appilot → 仓库根（可移植，勿硬编码绝对路径）。
const ROOT = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/, '');
const require2 = createRequire(ROOT + '/');
// tsx 以经典运行时编译 TSX 源码（React.createElement），挂全局供其解析。
globalThis.React = React;

/* ── 1) bundle 层：空态渲染 ── */
const bundleSrc = readFileSync(ROOT + '/plugins/dsh-appilot/client/client.js', 'utf8');
let moduleExports = null;
globalThis.window = globalThis.window || {};
globalThis.window.__ModuleLoader__ = {
  load: ({ id, factory }) => {
    moduleExports = factory((spec) => {
      if (spec === 'react') return require2('react');
      if (spec === 'react/jsx-runtime') return require2('react/jsx-runtime');
      return require2(spec);
    });
  },
};
(0, eval)(bundleSrc);
if (!moduleExports) throw new Error('bundle did not materialize');
console.log('bundle exports:', Object.keys(moduleExports));

let captured = {};
const slots = {
  inject: (name, fn) => { captured[name] = fn(); },
  register: (opts, comp) => comp,
};
moduleExports.apply({
  slots,
  sessions: { scope: () => ({ get: () => null }) },
});
console.log('registered slots:', Object.keys(captured));

const Workbench = captured['conversation.view'];
if (!Workbench) throw new Error('conversation.view component not captured');

const emptyHtml = renderToString(
  React.createElement(Workbench, {
    sessionId: 's1',
    useSessions: (sel) => sel({ current: 's1', byId: { s1: { cwd: '/tmp/ap-fixture' } } }),
    useWorkspaces: (sel) => sel({ items: [] }),
    useProjection: () => null,
    refresh: () => Promise.resolve(),
    dedicatedSession: () => null,
  }),
);
console.log('EMPTY render OK, html len:', emptyHtml.length);

/* ── 2) 源码层：共享组件全量数据渲染 ── */
const { OverviewContent } = await import(
  ROOT + '/src/renderer/components/overview/OverviewContent.tsx'
);

const now = new Date().toISOString();
const fullProps = {
  project: {
    id: 'dsh-project',
    name: 'My App',
    localPath: '/tmp/ap-fixture',
    hasGithubToken: false,
    hasAscKey: false,
    createdAt: now,
    repo: {
      remoteUrl: 'https://github.com/x/app.git',
      githubUrl: 'https://github.com/x/app',
      branch: 'main',
      headSha: 'abc',
      headMessage: 'init',
      headDate: null,
      dirty: false,
      description: 'x',
      capturedAt: now,
    },
    briefActions: [],
    storeProducts: [],
    productType: 'ios',
    bundleId: 'com.x',
    trackId: '123',
    trackName: 'My App',
    artworkUrl: '',
    supportedLanguages: [{ code: 'en', name: 'en' }],
    storeLinks: [],
    trackedKeywords: [
      { language: 'en', keyword: 'notes', rationale: '', translation: '' },
      { language: 'en', keyword: 'notion', rationale: '', translation: '' },
    ],
    submissionKeywords: [],
    removedKeywords: [],
    rankSnapshots: [
      { keyword: 'notes', language: 'en', storefront: 'us', rank: 7, totalResults: 200, checkedAt: now },
      { keyword: 'notion', language: 'en', storefront: 'us', rank: 1, totalResults: 200, checkedAt: now },
    ],
  },
  product: {
    id: 'dsh-product',
    projectId: 'dsh-project',
    platform: 'ios',
    trackId: '123',
    bundleId: 'com.x',
    trackName: 'My App',
    artworkUrl: '',
    supportedLanguages: [{ code: 'en', name: 'en' }],
    storeLinks: [],
    trackedKeywords: [
      { language: 'en', keyword: 'notes', rationale: '', translation: '', status: 'active' },
      { language: 'en', keyword: 'notion', rationale: '', translation: '', status: 'active' },
    ],
    submissionKeywords: [],
    removedKeywords: [],
    rankSnapshots: [
      { keyword: 'notes', language: 'en', storefront: 'us', rank: 7, totalResults: 200, checkedAt: now },
      { keyword: 'notion', language: 'en', storefront: 'us', rank: 1, totalResults: 200, checkedAt: now },
    ],
    createdAt: now,
  },
  releaseOverview: null,
  ascInfo: null,
  storeCurrentVersion: '1.0.0',
  activityData: { commits: { '2026-09-01': 5, '2026-08-31': 2 }, releases: [] },
  feedbackThemes: [],
  briefState: { status: 'idle', suggestions: [], progress: null, error: '' },
  LinkComponent: (p) => React.createElement('span', { className: p.className }, p.children),
  onSelectProduct: () => {},
  onOpenExternal: () => {},
  onRevealInFolder: () => {},
  onOpenSettings: () => {},
  onGenerateBrief: () => {},
  onBriefAction: () => {},
};

const fullHtml = renderToString(React.createElement(OverviewContent, fullProps));
console.log('FULL render OK, html len:', fullHtml.length);
console.log('contains 排名分布:', fullHtml.includes('排名分布'));
console.log('contains 项目活跃:', fullHtml.includes('项目活跃'));
console.log('contains 前 10 指标:', fullHtml.includes('前 10'));
console.log('contains #7:', fullHtml.includes('#7') || fullHtml.includes('7'));

const ok = fullHtml.includes('排名分布') && fullHtml.includes('项目活跃') && fullHtml.includes('前 10');
console.log(ok ? '\nSMOKE ALL OK' : '\nSMOKE FAILED');
process.exit(ok ? 0 : 1);
