/**
 * 写侧切换单测：syncProjectToDb 把 electron 项目完整镜像到共享 DB。
 * 纯 node（不 import electron）。
 */
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { openStore } from '@appilot-labs/appilot-headless';
import { syncProjectToDb } from '../src/main/project-write-sync';

function tempDb() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'writesync-'));
  return openStore(path.join(dir, 'app.db'));
}

function electronProject(): any {
  return {
    id: 'glo-id',
    name: 'glo',
    localPath: '/x/glo',
    productType: 'ios',
    lastReleaseSha: 'release-1',
    repo: {
      githubUrl: 'https://github.com/wxy/glo',
      remoteUrl: 'https://github.com/wxy/glo',
      headSha: 'abc123',
      headDate: '2026-09-02T00:00:00Z',
      capturedAt: '2026-09-01T00:00:00Z',
    },
    storeProducts: [
      {
        id: 'glo:ios',
        platform: 'ios',
        trackId: 9,
        bundleId: 'com.glo.ios',
        trackName: 'GloWalk',
        artworkUrl: 'http://art/glo.png',
        supportedLanguages: [{ code: 'en' }, { code: 'zh-Hans' }],
        trackedKeywords: [{ language: 'en', keyword: 'path of light', status: 'active' }],
        storeLinks: [{ platform: 'ios' }],
        submissionKeywords: [{ language: 'en', text: 'Find your light' }],
        removedKeywords: [{ language: 'en', keyword: 'old kw', removedAt: '2026-09-01T00:00:00Z' }],
      },
    ],
  };
}

async function main() {
  // 1. 完整镜像：注册表(id)/meta/产品(扩展列) 一次性入库
  {
    const store = tempDb();
    const p = electronProject();
    const res = syncProjectToDb(store, p);
    assert.deepEqual(res, { registry: true, meta: 1, products: 1 });

    const rec = store.projects.get('glo');
    assert.equal(rec?.id, 'glo-id');
    assert.equal(rec?.githubUrl, 'https://github.com/wxy/glo');

    const meta = store.meta.get('glo');
    assert.equal(meta?.headSha, 'abc123');
    assert.equal(meta?.lastReleaseSha, 'release-1');

    const rows = store.products.listByProject('glo');
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.productId, 'glo:ios');
    assert.deepEqual(row.trackedKeywords, [{ language: 'en', keyword: 'path of light', status: 'active' }]);
    assert.deepEqual(row.submissionKeywords, [{ language: 'en', text: 'Find your light' }]);
    assert.deepEqual(row.removedKeywords, [{ language: 'en', keyword: 'old kw', removedAt: '2026-09-01T00:00:00Z' }]);
    assert.deepEqual(row.supportedLanguages, ['en', 'zh-Hans']);
    store.close();
    console.log('✅ 完整镜像：注册表 id/meta/产品扩展列');
  }

  // 2. 幂等 upsert：重复同步不产生重复行
  {
    const store = tempDb();
    const p = electronProject();
    syncProjectToDb(store, p);
    (p.storeProducts[0].trackedKeywords as any[]).push({ language: 'en', keyword: 'new kw', status: 'active' });
    syncProjectToDb(store, p);
    const rows = store.products.listByProject('glo');
    assert.equal(rows.length, 1, 'upsert 不产生重复产品行');
    assert.equal((rows[0].trackedKeywords as any[]).length, 2, '内容更新生效');
    assert.equal(store.projects.list().length, 1);
    store.close();
    console.log('✅ 幂等 upsert');
  }

  // 3. 无效项目（缺 name/localPath）跳过
  {
    const store = tempDb();
    const res = syncProjectToDb(store, { name: null, localPath: null } as any);
    assert.deepEqual(res, { registry: false, meta: 0, products: 0 });
    assert.equal(store.projects.list().length, 0);
    store.close();
    console.log('✅ 无效项目跳过');
  }

  console.log('project-write-sync 单测全部通过 ✓');
}

main().catch((err) => {
  console.error('project-write-sync 测试失败:', err);
  process.exit(1);
});
