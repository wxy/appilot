/**
 * config.json → SQLite app_kv 一次性迁移单测。
 *
 * 覆盖：首次导入+归档、幂等跳过、无 config 时直接标记、损坏 JSON 抛错不置标记、
 * 与真实 headless store（appilot.db schema v7 app_kv）的集成往返。
 * 纯 node（不 import electron）。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { openStore } from '@appilot-labs/appilot-headless';
import {
  KV_MIGRATE_MARK,
  migrateConfigJsonIntoKv,
} from '../src/main/kv-migrate';

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'kv-migrate-'));
}

function dbPath(dir: string): string {
  return path.join(dir, 'app.db');
}

async function main() {
  // 1. 首次导入：全量键入库并归档 config.json，置完成标记
  {
    const dir = tempDir();
    const store = openStore(dbPath(dir));
    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        projects: [{ name: 'AI Pulse', storeProducts: [{ id: 'x:ios' }] }],
        rankExecutions: [{ ts: '2026-09-06T00:00:00Z', rank: 3 }],
        aiApiKey: 'sk-test',
        note: '中文与 Unicode ✓',
      }),
    );

    const outcome = migrateConfigJsonIntoKv(store.kv, configPath);
    assert.equal(outcome.imported, 4);
    assert.ok(outcome.archivedTo && outcome.archivedTo.startsWith(configPath + '.migrated-'));
    assert.equal(fs.existsSync(configPath), false, 'config.json 应已改名归档');
    assert.ok(fs.existsSync(outcome.archivedTo as string), '归档文件应存在');

    assert.deepEqual(JSON.parse(store.kv.get('projects')!), [
      { name: 'AI Pulse', storeProducts: [{ id: 'x:ios' }] },
    ]);
    assert.deepEqual(JSON.parse(store.kv.get('rankExecutions')!), [
      { ts: '2026-09-06T00:00:00Z', rank: 3 },
    ]);
    assert.equal(JSON.parse(store.kv.get('aiApiKey')!), 'sk-test');
    assert.equal(JSON.parse(store.kv.get('note')!), '中文与 Unicode ✓');
    assert.ok(store.kv.get(KV_MIGRATE_MARK), '完成标记应已写入');
    store.close();
    console.log('✅ 首次导入：全量键入库 + 归档 + 完成标记');
  }

  // 2. 幂等：再次执行跳过（alreadyDone），不再触碰文件
  {
    const dir = tempDir();
    const store = openStore(dbPath(dir));
    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ k: 1 }));
    const first = migrateConfigJsonIntoKv(store.kv, configPath);
    assert.equal(first.imported, 1);

    const second = migrateConfigJsonIntoKv(store.kv, configPath);
    assert.equal(second.alreadyDone, true);
    assert.equal(second.imported, 0);
    assert.equal(JSON.parse(store.kv.get('k')!), 1, '值保持首次导入的内容');
    store.close();
    console.log('✅ 幂等：完成标记后跳过');
  }

  // 3. 无 config.json：直接置完成标记，不抛错
  {
    const dir = tempDir();
    const store = openStore(dbPath(dir));
    const outcome = migrateConfigJsonIntoKv(store.kv, path.join(dir, 'config.json'));
    assert.equal(outcome.imported, 0);
    assert.ok(store.kv.get(KV_MIGRATE_MARK));
    store.close();
    console.log('✅ 无 config.json：置标记不抛错');
  }

  // 4. 损坏 JSON：抛错、不置标记、原文件保留（下次重试）
  {
    const dir = tempDir();
    const store = openStore(dbPath(dir));
    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(configPath, '{broken json!!');
    assert.throws(() => migrateConfigJsonIntoKv(store.kv, configPath));
    assert.equal(store.kv.get(KV_MIGRATE_MARK), undefined, '失败不应置完成标记');
    assert.equal(fs.existsSync(configPath), true, '失败不应归档原文件');
    store.close();
    console.log('✅ 损坏 JSON：抛错且不置标记、原文件保留');
  }

  // 5. app_kv 表随 schema v7 就绪（openStore 即建表）
  {
    const dir = tempDir();
    const store = openStore(dbPath(dir));
    store.kv.set('probe', '"ok"');
    assert.equal(store.kv.get('probe'), '"ok"');
    store.close();
    console.log('✅ app_kv 表随 schema v7 就绪');
  }

  console.log('kv-migrate 单测全部通过 ✓');
}

main().catch((err) => {
  console.error('kv-migrate 测试失败:', err);
  process.exit(1);
});
