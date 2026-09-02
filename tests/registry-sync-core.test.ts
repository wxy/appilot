/**
 * 注册表双向同步核心逻辑单测（Electron ↔ DSH 共享 DB）。
 *
 * 验证（无 electron，隔离 DB）：
 * 1. DSH 侧注册（DB 有记录）→ hydrateFromDbCore 生成 minimal Project 补进本侧列表；
 * 2. 本侧（Electron）富数据 project → syncRegistryCore 写 DB（identity 子集）；
 * 3. DB 更新（名称/platform/languages/githubUrl）→ 已有项目字段被覆盖（changed=true）；
 * 4. 旧时间戳不覆盖新数据（isNewer 语义）；
 * 5. 富数据字段（trackedKeywords 等）不因 hydrate/sync 丢失（列表对象保留）。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert';
import { openStore } from '@appilot-labs/appilot-headless';
import {
  hydrateFromDbCore,
  minimalProjectFromRecord,
  registryRecordOf,
  syncRegistryCore,
} from '../src/main/registry-sync-core';

const PATH_A = '/Users/dev/Projects/proj-a';

function richElectronProject(): any {
  return {
    id: 'local-1',
    name: 'proj-a',
    localPath: PATH_A,
    productType: 'macos',
    bundleId: 'com.demo.a',
    trackId: 123456,
    artworkUrl: 'https://x/art.png',
    supportedLanguages: [{ code: 'en', name: 'English' }],
    trackedKeywords: [{ keyword: 'app', language: 'en' }],
    rankSnapshots: [{ keyword: 'app', language: 'en', storefront: 'us', rank: 1, checkedAt: '2026-08-01T00:00:00Z' }],
    createdAt: '2026-07-01T00:00:00Z',
    repo: { githubUrl: 'https://github.com/wxy/proj-a', remoteUrl: 'https://github.com/wxy/proj-a', capturedAt: '2026-07-01T00:00:00Z' },
  };
}

async function main(): Promise<void> {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'reg-sync-test-')), 'appilot.db');
  const store = openStore(dbPath);

  // 1. 本侧项目 → DB（syncRegistryCore）：DB 行只含 identity 子集
  const local = richElectronProject();
  const n1 = syncRegistryCore(store, [local]);
  assert.equal(n1, 1);
  const row = store.projects.get('proj-a');
  assert.equal(row?.path, PATH_A);
  assert.equal(row?.githubUrl, 'https://github.com/wxy/proj-a');
  assert.equal(row?.platform, 'macos');
  assert.deepEqual(row?.languages, ['en']);
  assert.equal((row as any)?.rankSnapshots, undefined, 'DB 行不应含富数据');
  console.log('✓ 本侧项目 → DB（identity 子集，无富数据）');

  // 2. 对侧（DSH）注册新项目 → hydrateFromDbCore 补 minimal Project
  const now = new Date().toISOString();
  store.projects.save({
    name: 'dsh-proj',
    path: '/Users/dev/Projects/dsh-proj',
    githubUrl: null,
    platform: 'ios',
    languages: ['zh'],
    lastResolvedAt: now,
    artworkUrl: null,
    updatedAt: now,
  });
  const { projects: afterHydrate, changed: changedHydrate } = hydrateFromDbCore(store, [local]);
  assert.equal(changedHydrate, true, '新项目应触发 changed');
  const added = afterHydrate.find((p: any) => p.name === 'dsh-proj');
  assert.ok(added, 'hydrate 应补入 dsh-proj');
  assert.equal(added.localPath, '/Users/dev/Projects/dsh-proj');
  assert.equal(added.registryShared, true);
  assert.equal(added.productType, 'ios');
  assert.deepEqual(added.supportedLanguages.map((l: any) => l.code), ['zh']);
  assert.deepEqual(added.rankSnapshots, [], 'minimal Project 富数据留空待完善');
  // 原富数据项目不被破坏（对象仍在、字段未动）
  const kept = afterHydrate.find((p: any) => p.name === 'proj-a');
  assert.deepEqual(kept.trackedKeywords, local.trackedKeywords, '既有富数据应保留');
  console.log('✓ DB 新项目 → minimal Project 补入（富数据对象保留）');

  // 3. 重复 hydrate 幂等（无变化 → changed=false）
  const second = hydrateFromDbCore(store, afterHydrate);
  assert.equal(second.changed, false, '无变化 hydrate 应 changed=false');
  console.log('✓ hydrate 幂等');

  // 4. DB 更新（名称/语言/githubUrl）→ 覆盖本侧已有项目字段
  store.projects.save({
    name: 'proj-a-renamed',
    path: PATH_A,
    githubUrl: 'https://github.com/wxy/proj-a-updated',
    platform: 'macos',
    languages: ['en', 'zh'],
    lastResolvedAt: now,
    artworkUrl: null,
    updatedAt: new Date(Date.now() + 10_000).toISOString(), // 更新晚于本侧 capturedAt
  });
  const { projects: afterUpdate, changed: changedUpdate } = hydrateFromDbCore(store, afterHydrate);
  assert.equal(changedUpdate, true, 'DB 更新应触发 changed');
  const updated = afterUpdate.find((p: any) => p.localPath === PATH_A);
  assert.equal(updated.name, 'proj-a-renamed');
  assert.equal(updated.repo.githubUrl, 'https://github.com/wxy/proj-a-updated');
  assert.deepEqual(updated.supportedLanguages.map((l: any) => l.code), ['en', 'zh']);
  // 富数据字段在覆盖后仍保留（未被重建）
  assert.ok(Array.isArray(updated.trackedKeywords) && updated.trackedKeywords.length > 0);
  console.log('✓ DB 更新字段覆盖本侧（富数据仍保留）');

  // 5. isNewer 语义：DB 时间戳更旧 → 不覆盖
  store.projects.save({
    name: 'proj-a-old',
    path: PATH_A,
    githubUrl: 'https://github.com/old/url',
    platform: null,
    languages: [],
    lastResolvedAt: '2020-01-01T00:00:00Z',
    artworkUrl: null,
    updatedAt: '2020-01-01T00:00:00Z',
  });
  const stale = hydrateFromDbCore(store, afterUpdate);
  const staleProj = stale.projects.find((p: any) => p.localPath === PATH_A);
  assert.equal(staleProj.name, 'proj-a-renamed', '旧 DB 记录不应覆盖更新的本侧数据');
  console.log('✓ 旧时间戳不覆盖（isNewer 语义）');

  // 6. registryRecordOf / minimalProjectFromRecord 往返（无富数据丢失字段要求）
  const rec = registryRecordOf(richElectronProject());
  const back = minimalProjectFromRecord(rec);
  assert.equal(back.name, 'proj-a');
  assert.equal(back.localPath, PATH_A);
  assert.ok(back.id.startsWith('shared-'));
  console.log('✓ record 往返映射');

  store.close();
  console.log('registry-sync-core 单测全部通过 ✓');
}

main().catch((err) => {
  console.error('registry-sync-core 测试失败:', err);
  process.exit(1);
});
