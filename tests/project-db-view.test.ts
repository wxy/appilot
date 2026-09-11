/**
 * DB → 项目视图组装（阶段二读侧）单测：注册表 ∪ product_records ∪ project_meta
 * 组装为项目视图；includeSnapshots 时按产品拉取升序历史点。纯 node（不 import electron）。
 */
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { openStore } from '@appilot-labs/appilot-headless';
import { assembleProjectViews } from '../src/main/project-db-view';

function tempDb(): ReturnType<typeof openStore> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'projdb-'));
  return openStore(path.join(dir, 'app.db'));
}

async function main() {
  // 1. 组装：注册表 + 双产品 + meta
  {
    const store = tempDb();
    store.projects.save({
      id: 'ai-pulse-id',
      name: 'ai-pulse-macos',
      path: '/Users/x/dev/ai-pulse',
      githubUrl: 'https://github.com/wxy/ai-pulse',
      platform: 'ios',
      languages: ['en', 'zh-Hans'],
      lastResolvedAt: '2026-09-01T00:00:00Z',
      artworkUrl: null,
      updatedAt: '2026-09-01T00:00:00Z',
    });
    store.products.upsert({
      projectName: 'ai-pulse-macos',
      productId: 'x:ios',
      platform: 'ios',
      trackId: 100,
      bundleId: 'com.example.pulse',
      trackName: 'AI Pulse',
      artworkUrl: 'http://art/pulse.png',
      supportedLanguages: ['en', 'zh-Hans'],
      trackedKeywords: [{ language: 'en', keyword: 'ai cost', status: 'active' }],
      storeLinks: [{ platform: 'ios', url: 'https://apps.apple.com/x' }],
      updatedAt: '2026-09-02T00:00:00Z',
    });
    store.products.upsert({
      projectName: 'ai-pulse-macos',
      productId: 'x:macos',
      platform: 'macos',
      trackId: null,
      bundleId: null,
      trackName: null,
      artworkUrl: null,
      supportedLanguages: ['en'],
      trackedKeywords: [],
      storeLinks: [],
      updatedAt: '2026-09-02T00:00:00Z',
    });
    store.meta.save({
      projectName: 'ai-pulse-macos',
      githubUrl: 'https://github.com/wxy/ai-pulse',
      headSha: 'abc123',
      headDate: '2026-09-01T00:00:00Z',
      lastReleaseSha: 'def456',
      updatedAt: '2026-09-03T00:00:00Z',
    });

    const views = assembleProjectViews(store);
    assert.equal(views.length, 1);
    const v = views[0];
    assert.equal(v.name, 'ai-pulse-macos');
    assert.equal(v.id, 'ai-pulse-id', '视图保留稳定项目 id');
    assert.equal(v.productType, 'ios');
    assert.equal(v.storeProducts.length, 2);
    const ios = v.storeProducts.find((p) => p.id === 'x:ios')!;
    assert.ok(ios, 'ios 产品存在');
    assert.equal(ios.bundleId, 'com.example.pulse');
    assert.deepEqual(ios.trackedKeywords, [{ language: 'en', keyword: 'ai cost', status: 'active' }]);
    assert.deepEqual(ios.storeLinks, [{ platform: 'ios', url: 'https://apps.apple.com/x' }]);
    assert.deepEqual(v.repo && { sha: v.repo.headSha, date: v.repo.headDate }, { sha: 'abc123', date: '2026-09-01T00:00:00Z' });
    const codes = v.supportedLanguages.map((l) => l.code).sort();
    assert.deepEqual(codes, ['en', 'zh-Hans']);
    store.close();
    console.log('✅ 组装：注册表 + 双产品 + meta');
  }

  // 2. includeSnapshots：按产品拉取升序历史点
  {
    const store = tempDb();
    store.projects.save({
      name: 'glo',
      path: '/x/glo',
      githubUrl: null,
      platform: 'ios',
      languages: ['en'],
      lastResolvedAt: '2026-09-01T00:00:00Z',
      artworkUrl: null,
      updatedAt: '2026-09-01T00:00:00Z',
    });
    store.products.upsert({
      projectName: 'glo',
      productId: 'g:ios',
      platform: 'ios',
      trackId: null,
      bundleId: null,
      trackName: null,
      artworkUrl: null,
      supportedLanguages: ['en'],
      trackedKeywords: [],
      storeLinks: [],
      updatedAt: '2026-09-01T00:00:00Z',
    });
    store.snapshots.add([
      { projectName: 'glo', productId: 'g:ios', keyword: 'a', language: 'en', storefront: 'us', rank: 8, totalResults: 10, checkedAt: '2026-09-01T00:00:00Z' },
      { projectName: 'glo', productId: 'g:ios', keyword: 'a', language: 'en', storefront: 'us', rank: 5, totalResults: 10, checkedAt: '2026-09-02T00:00:00Z' },
      { projectName: 'glo', productId: 'g:ios', keyword: 'b', language: 'en', storefront: 'gb', rank: null, totalResults: 0, checkedAt: '2026-09-02T00:00:00Z' },
    ]);
    const views = assembleProjectViews(store, { includeSnapshots: true });
    const snaps = views[0].storeProducts[0].rankSnapshots as Array<{ rank: number | null; checkedAt: string }>;
    assert.equal(snaps.length, 3);
    assert.ok(new Date(snaps[0].checkedAt).getTime() <= new Date(snaps[1].checkedAt).getTime(), '升序历史点');
    assert.ok(new Date(snaps[1].checkedAt).getTime() <= new Date(snaps[2].checkedAt).getTime());
    assert.equal(snaps[2].rank, null, '未进榜(null)行也保留');
    store.close();
    console.log('✅ includeSnapshots：升序历史点');
  }

  // 3. 默认不拉快照（读侧切换默认视图不含大对象）
  {
    const store = tempDb();
    store.projects.save({
      name: 'p',
      path: '/x/p',
      githubUrl: null,
      platform: null,
      languages: [],
      lastResolvedAt: '2026-09-01T00:00:00Z',
      artworkUrl: null,
      updatedAt: '2026-09-01T00:00:00Z',
    });
    const views = assembleProjectViews(store);
    assert.equal(views[0].storeProducts.length, 0);
    assert.equal(views[0].repo, null);
    store.close();
    console.log('✅ 默认视图（无快照/无产品）');
  }

  console.log('project-db-view 单测全部通过 ✓');
}

main().catch((err) => {
  console.error('project-db-view 测试失败:', err);
  process.exit(1);
});
