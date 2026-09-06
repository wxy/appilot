/**
 * project_blobs（schema v11）与 kv Record<id,数据> 域镜像单测。
 * 纯 node（不 import electron）。
 */
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { openStore } from '@appilot-labs/appilot-headless';
import { KV_BLOB_DOMAINS, syncKvBlobMap } from '../src/main/kv-blob-mirror';

function tempDb() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'blob-'));
  return openStore(path.join(dir, 'app.db'));
}

async function main() {
  // 1. put/get/all/pruneKeys + 域隔离
  {
    const store = tempDb();
    store.blobs.put('opsStatus', 'p1', { trafficError: 'boom' });
    store.blobs.put('opsStatus', 'p2', { trafficError: null });
    store.blobs.put('competitors', 'p1', [{ name: 'X' }]);
    assert.deepEqual(store.blobs.get('opsStatus', 'p1'), { trafficError: 'boom' });
    assert.deepEqual(store.blobs.all('opsStatus'), {
      p1: { trafficError: 'boom' },
      p2: { trafficError: null },
    });
    assert.equal(Object.keys(store.blobs.all('competitors')).length, 1, '域隔离');
    store.blobs.put('opsStatus', 'p2', { trafficError: 'x' });
    assert.equal((store.blobs.get('opsStatus', 'p2') as any)?.trafficError, 'x', '覆盖更新');
    const pruned = store.blobs.pruneKeys('opsStatus', ['p2']);
    assert.equal(pruned, 1, '清理陈旧 key');
    assert.equal(store.blobs.get('opsStatus', 'p1'), undefined);
    store.close();
    console.log('✅ blobs put/get/all/pruneKeys/域隔离/覆盖');
  }

  // 2. syncKvBlobMap：整体覆盖 + 陈旧清理 + 空 map 全清
  {
    const store = tempDb();
    syncKvBlobMap(store, 'trafficSnapshots', { p1: [{ views: 1 }], p2: [{ views: 2 }] });
    assert.equal(Object.keys(store.blobs.all('trafficSnapshots')).length, 2);
    syncKvBlobMap(store, 'trafficSnapshots', { p1: [{ views: 3 }] }); // p2 陈旧
    const all = store.blobs.all('trafficSnapshots');
    assert.deepEqual(Object.keys(all), ['p1']);
    assert.deepEqual(all.p1, [{ views: 3 }]);
    syncKvBlobMap(store, 'trafficSnapshots', {});
    assert.deepEqual(store.blobs.all('trafficSnapshots'), {});
    store.close();
    console.log('✅ syncKvBlobMap：覆盖镜像 + 陈旧清理 + 清空');
  }

  // 3. 镜像域清单完整（覆盖六个 kv 域）
  {
    const expect = ['opsStatus', 'trafficSnapshots', 'ascCache', 'competitors', 'competitorSnapshots', 'competitorRankSnapshots', 'readinessChecks', 'reviews', 'feedback'];
    assert.deepEqual(Object.values(KV_BLOB_DOMAINS).sort(), [...expect].sort());
    console.log('✅ KV_BLOB_DOMAINS 清单');
  }

  console.log('kv-blob-mirror 单测全部通过 ✓');
}

main().catch((err) => {
  console.error('kv-blob-mirror 测试失败:', err);
  process.exit(1);
});
