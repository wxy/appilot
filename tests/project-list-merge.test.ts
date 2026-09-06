/**
 * 读侧切换合并层单测：DB 组装视图为主 + kv 兜底补齐，输出与纯 kv 视图等价。
 * 纯 node（不 import electron）。
 */
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { openStore } from '@appilot-labs/appilot-headless';
import { assembleProjectViews } from '../src/main/project-db-view';
import { buildUiProjects } from '../src/main/project-list-merge';

function tempDb() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'merge-'));
  return openStore(path.join(dir, 'app.db'));
}

function seedDb(store: ReturnType<typeof openStore>) {
  store.projects.save({
    name: 'glo',
    id: 'glo-id',
    path: '/x/glo',
    githubUrl: 'https://github.com/wxy/glo',
    platform: 'ios',
    languages: ['en', 'zh-Hans'],
    lastResolvedAt: '2026-09-01T00:00:00Z',
    artworkUrl: null,
    updatedAt: '2026-09-05T00:00:00Z',
  });
  store.meta.save({
    projectName: 'glo',
    githubUrl: 'https://github.com/wxy/glo',
    headSha: 'abc',
    headDate: '2026-09-01T00:00:00Z',
    lastReleaseSha: 'def',
    updatedAt: '2026-09-05T00:00:00Z',
  });
  store.products.upsert({
    projectName: 'glo',
    productId: 'glo:ios',
    platform: 'ios',
    trackId: 7,
    bundleId: 'com.glo.ios',
    trackName: 'GloWalk',
    artworkUrl: 'http://art/glo.png',
    supportedLanguages: ['en', 'zh-Hans'],
    trackedKeywords: [{ language: 'en', keyword: 'path of light', status: 'active' }],
    storeLinks: [{ platform: 'ios' }],
    submissionKeywords: [{ language: 'en', text: 'Find light' }],
    removedKeywords: [{ language: 'en', keyword: 'old', removedAt: '2026-09-01T00:00:00Z' }],
    updatedAt: '2026-09-05T00:00:00Z',
  });
  store.snapshots.add([
    { projectName: 'glo', productId: 'glo:ios', keyword: 'a', language: 'en', storefront: 'us', rank: 5, totalResults: 9, checkedAt: '2026-09-03T00:00:00Z' },
    { projectName: 'glo', productId: 'glo:ios', keyword: 'a', language: 'en', storefront: 'us', rank: 3, totalResults: 9, checkedAt: '2026-09-04T00:00:00Z' },
  ]);
}

function kvProject(): any {
  return {
    id: 'glo-id',
    name: 'glo',
    localPath: '/x/glo',
    productType: 'ios',
    bundleId: 'com.glo.ios',
    trackId: 7,
    trackName: 'GloWalk',
    artworkUrl: null,
    supportedLanguages: [{ code: 'en', name: 'en' }, { code: 'zh-Hans', name: 'zh-Hans' }],
    createdAt: '2026-07-01T00:00:00Z',
    repo: {
      githubUrl: 'https://github.com/wxy/glo',
      remoteUrl: 'https://github.com/wxy/glo',
      branch: 'main',
      headSha: 'abc',
      headMessage: 'init',
      headDate: '2026-09-01T00:00:00Z',
      dirty: false,
      description: null,
      capturedAt: '2026-07-01T00:00:00Z',
    },
    storeProducts: [
      {
        id: 'glo:ios',
        platform: 'ios',
        trackId: 7,
        bundleId: 'com.glo.ios',
        trackName: 'GloWalk',
        artworkUrl: 'http://art/glo.png',
        supportedLanguages: [{ code: 'en', name: 'en' }, { code: 'zh-Hans', name: 'zh-Hans' }],
        storeLinks: [{ platform: 'ios' }],
        trackedKeywords: [{ language: 'en', keyword: 'path of light', status: 'active' }],
        submissionKeywords: [{ language: 'en', text: 'Find light' }],
        removedKeywords: [{ language: 'en', keyword: 'old', removedAt: '2026-09-01T00:00:00Z' }],
        rankSnapshots: [
          { keyword: 'a', language: 'en', storefront: 'us', rank: 5, totalResults: 9, checkedAt: '2026-09-03T00:00:00Z' },
          { keyword: 'a', language: 'en', storefront: 'us', rank: 3, totalResults: 9, checkedAt: '2026-09-04T00:00:00Z' },
        ],
        createdAt: '2026-07-01T00:00:00Z',
      },
    ],
  };
}

async function main() {
  // 1. 等价性：DB 与 kv 一致时，合并输出在 UI 关键字段上与纯 kv 等价
  {
    const store = tempDb();
    seedDb(store);
    const kv = [kvProject()];
    const dbViews = assembleProjectViews(store, { includeSnapshots: true });
    const { projects } = buildUiProjects(dbViews, kv);
    assert.equal(projects.length, 1);
    const p = projects[0];
    assert.equal(p.id, 'glo-id');
    assert.equal(p.createdAt, '2026-07-01T00:00:00Z', 'kv 兜底 createdAt');
    assert.equal((p.repo as any)?.branch, 'main', 'kv 兜底 repo 全字段');
    const prod = p.storeProducts[0];
    assert.deepEqual(prod.trackedKeywords, [{ language: 'en', keyword: 'path of light', status: 'active' }]);
    assert.deepEqual(prod.submissionKeywords, [{ language: 'en', text: 'Find light' }]);
    assert.deepEqual(prod.removedKeywords, [{ language: 'en', keyword: 'old', removedAt: '2026-09-01T00:00:00Z' }]);
    assert.equal(prod.rankSnapshots.length, 2, 'DB 快照为准');
    assert.equal(prod.createdAt, '2026-07-01T00:00:00Z');
    store.close();
    console.log('✅ 等价性：DB 为主 + kv 兜底（repo/createdAt/快照）');
  }

  // 2. 新鲜项目：kv 有而 DB 尚无（registry 防抖窗口）→ 原样保留
  {
    const store = tempDb();
    const fresh = { ...kvProject(), id: 'fresh-id', name: 'fresh' };
    const dbViews = assembleProjectViews(store, { includeSnapshots: true });
    const { projects, fromKvOnlyIds } = buildUiProjects(dbViews, [fresh]);
    assert.deepEqual(fromKvOnlyIds, ['fresh-id']);
    assert.equal(projects.length, 1);
    assert.equal(projects[0].id, 'fresh-id');
    store.close();
    console.log('✅ 新鲜项目（kv-only）不丢');
  }

  // 3. DB 快照为空但 kv 有 → 用 kv 快照（迁移未完成场景兜底）
  {
    const store = tempDb();
    seedDb(store);
    // 让 DB 视图不带快照（模拟 includeSnapshots=false 或镜像未同步）
    const dbViews = assembleProjectViews(store, { includeSnapshots: false });
    const kv = [kvProject()];
    const { projects } = buildUiProjects(dbViews, kv);
    assert.equal(projects[0].storeProducts[0].rankSnapshots.length, 2, 'DB 空时用 kv 快照');
    store.close();
    console.log('✅ DB 快照为空 → kv 快照兜底');
  }

  // 4. DB-only 项目（kv 缺失，如 DSH 新增）也展示
  {
    const store = tempDb();
    seedDb(store);
    const { projects, dbIds } = buildUiProjects(
      assembleProjectViews(store, { includeSnapshots: false }),
      [],
    );
    assert.equal(projects.length, 1);
    assert.equal(dbIds[0], 'glo-id');
    store.close();
    console.log('✅ DB-only 项目展示');
  }

  console.log('project-list-merge 单测全部通过 ✓');
}

main().catch((err) => {
  console.error('project-list-merge 测试失败:', err);
  process.exit(1);
});
