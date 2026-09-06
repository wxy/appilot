/**
 * 阶段二「双写补齐」单测：schema v8 扩展列与 id 的持久化、映射与回读。
 *
 * 覆盖：v8 建表（projects.id / product_records 扩展列）、headless store 的
 * projects(id)/products(扩展列) 往返、registry-sync-core 的 id 写读映射、
 * rich-data-sync 把 electron 富数据（含扩展列）双写进 DB。纯 node（不 import electron）。
 */
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { openStore } from '@appilot-labs/appilot-headless';
import { registryRecordOf, minimalProjectFromRecord } from '../src/main/registry-sync-core';
import { toProductRows, toProjectMeta } from '../src/main/rich-data-sync';

function tempDb() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dualwrite-'));
  return openStore(path.join(dir, 'app.db'));
}

async function main() {
  // 1. schema v8：列就绪
  {
    const store = tempDb();
    store.projects.save({
      name: 'p1',
      id: 'proj-1',
      path: '/x/p1',
      githubUrl: null,
      platform: 'ios',
      languages: ['en'],
      lastResolvedAt: '2026-09-06T00:00:00Z',
      artworkUrl: null,
      updatedAt: '2026-09-06T00:00:00Z',
    });
    const list = store.projects.list();
    assert.equal(list[0].id, 'proj-1', 'projects.id 应持久化');
    store.close();
    console.log('✅ v8 projects.id 往返');
  }

  // 2. product_records 扩展列往返
  {
    const store = tempDb();
    store.products.upsert({
      projectName: 'p1',
      productId: 'x:ios',
      platform: 'ios',
      trackId: null,
      bundleId: null,
      trackName: null,
      artworkUrl: null,
      supportedLanguages: ['en'],
      trackedKeywords: [{ keyword: 'k', status: 'active' }],
      storeLinks: [],
      submissionKeywords: [{ language: 'en', text: 'sub1' }],
      removedKeywords: [{ language: 'en', keyword: 'old', removedAt: '2026-09-01T00:00:00Z' }],
      updatedAt: '2026-09-06T00:00:00Z',
    });
    const rows = store.products.listByProject('p1');
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].submissionKeywords, [{ language: 'en', text: 'sub1' }]);
    assert.deepEqual(rows[0].removedKeywords, [
      { language: 'en', keyword: 'old', removedAt: '2026-09-01T00:00:00Z' },
    ]);
    // 未提供扩展列时默认空数组
    store.products.upsert({
      projectName: 'p1',
      productId: 'y:macos',
      platform: 'macos',
      trackId: null,
      bundleId: null,
      trackName: null,
      artworkUrl: null,
      supportedLanguages: [],
      trackedKeywords: [],
      storeLinks: [],
      updatedAt: '2026-09-06T00:00:00Z',
    });
    const rows2 = store.products.listByProject('p1');
    const mac = rows2.find((r) => r.productId === 'y:macos')!;
    assert.deepEqual(mac.submissionKeywords, []);
    assert.deepEqual(mac.removedKeywords, []);
    store.close();
    console.log('✅ product_records 扩展列往返 + 默认空数组');
  }

  // 3. registry-sync-core：registryRecordOf 带 id；minimalProjectFromRecord 用 rec.id
  {
    const rec = registryRecordOf({
      id: 'electron-id-1',
      name: 'ai',
      localPath: '/x/ai',
      repo: { capturedAt: '2026-09-01T00:00:00Z' },
      supportedLanguages: [{ code: 'en' }],
      productType: 'ios',
    } as any);
    assert.equal(rec.id, 'electron-id-1');

    const minimal = minimalProjectFromRecord({
      name: 'ai',
      id: 'db-id-9',
      path: '/x/ai',
      githubUrl: null,
      platform: 'ios',
      languages: ['en'],
      lastResolvedAt: '2026-09-01T00:00:00Z',
      artworkUrl: null,
      updatedAt: '2026-09-01T00:00:00Z',
    });
    assert.equal(minimal.id, 'db-id-9', 'hydration 优先使用注册表 id');
    // 无 id 记录回退 shared- 路径式 id
    const noId = minimalProjectFromRecord({
      name: 'dsh',
      path: '/x/dsh',
      githubUrl: null,
      platform: null,
      languages: [],
      lastResolvedAt: '2026-09-01T00:00:00Z',
      artworkUrl: null,
      updatedAt: '2026-09-01T00:00:00Z',
    });
    assert.ok(noId.id.startsWith('shared-'), '无 id 时回退 shared-');
    console.log('✅ registry 映射：id 写读/回退');
  }

  // 4. rich-data-sync：electron 富数据（含扩展列）→ DB
  {
    const store = tempDb();
    const project = {
      name: 'glo',
      localPath: '/x/glo',
      repo: { githubUrl: 'https://github.com/wxy/glo', headSha: 'abc', headDate: '2026-09-01T00:00:00Z' },
      storeProducts: [
        {
          id: 'g:ios',
          platform: 'ios',
          trackId: 1,
          supportedLanguages: [{ code: 'en' }],
          trackedKeywords: [{ keyword: 'a' }],
          storeLinks: [],
          submissionKeywords: [{ language: 'en', text: 's' }],
          removedKeywords: [{ keyword: 'r' }],
        },
      ],
    };
    store.projects.save(registryRecordOf(project as any));
    const meta = toProjectMeta(project as any);
    if (meta) store.meta.save(meta);
    for (const row of toProductRows(project as any)) store.products.upsert(row);

    const row = store.products.listByProject('glo')[0];
    assert.equal(row.productId, 'g:ios');
    assert.deepEqual(row.submissionKeywords, [{ language: 'en', text: 's' }]);
    assert.deepEqual(row.removedKeywords, [{ keyword: 'r' }]);
    assert.equal(store.projects.list()[0].id, null, 'electron 项目未传 id 时为 null（双写期由项目级同步补充）');
    store.close();
    console.log('✅ rich-data-sync 扩展列双写入库');
  }

  console.log('phase2-dualwrite 单测全部通过 ✓');
}

main().catch((err) => {
  console.error('phase2-dualwrite 测试失败:', err);
  process.exit(1);
});
