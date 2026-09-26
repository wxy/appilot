/**
 * snapshots.prune 破坏性命令防护测试（审计 2026-09-26 H7）：
 * checkedAt 是 TEXT、prune 按字典序比较——旧实现传 "z" 等非 ISO 字符串会
 * 删光项目全部快照并静默返回成功；未知项目静默 removed=0。
 * 修复后：ISO 强校验、未知项目报错、dryRun 预览、>50% 删除需 force。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert';
import { openStore, createHeadlessService } from '../src/index.js';

function mk(projectName: string, keyword: string, rank: number | null, checkedAt: string) {
  return { projectName, productId: null, keyword, language: 'en', storefront: 'us', rank, totalResults: 100, checkedAt };
}

async function main(): Promise<void> {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'prune-guard-')), 'appilot.db');
  const store = openStore(dbPath);
  store.projects.save({ id: 'proj-id', name: 'proj', path: '/proj', githubUrl: null, platform: null, languages: [], lastResolvedAt: '2026-08-01T00:00:00Z', artworkUrl: null, updatedAt: '2026-08-01T00:00:00Z' });
  const svc = createHeadlessService(store);
  // 4 条旧快照（2026-08）+ 1 条新快照（2026-09）→ before=2026-09-01 命中 4/5（>50%）
  svc.snapshots.record([
    mk('proj', 'app', 5, '2026-08-01T00:00:00Z'),
    mk('proj', 'app', 4, '2026-08-02T00:00:00Z'),
    mk('proj', 'app', 3, '2026-08-03T00:00:00Z'),
    mk('proj', 'other', 9, '2026-08-04T00:00:00Z'),
    mk('proj', 'app', 1, '2026-09-01T00:00:00Z'),
  ]);

  // 1. 非 ISO before 一律拒绝（旧实现 "z" 会删光全部）
  for (const bad of ['z', '9999', '', 'not-a-date', '2026-02-30T00:00:00Z', '2026-09-01T00:00:00']) {
    assert.throws(
      () => svc.snapshots.prune('proj', bad),
      /ISO 8601/,
      `非法 before "${bad}" 应被拒绝`,
    );
  }
  assert.equal(svc.snapshots.recent('proj').length, 5, '拒绝路径不删数据');
  console.log('✓ 非 ISO before 强校验（字典序陷阱封堵）');

  // 2. 未知项目 → 明确报错（旧实现静默 removed=0）
  assert.throws(
    () => svc.snapshots.prune('no-such-project', '2026-01-01T00:00:00Z'),
    /项目不存在/,
    '未知项目应报错而非静默 0',
  );
  console.log('✓ 未知项目显式报错');

  // 3. dryRun：只预览不删除
  const dry = svc.snapshots.prune('proj', '2026-09-01T00:00:00Z', { dryRun: true });
  assert.deepEqual(dry, { matched: 4, removed: 0, total: 5 }, 'dryRun 返回影响面且 removed=0');
  assert.equal(svc.snapshots.recent('proj').length, 5, 'dryRun 不删数据');
  console.log('✓ dryRun 预览影响面');

  // 4. >50% 删除量：无 force 拒绝；force 放行
  assert.throws(
    () => svc.snapshots.prune('proj', '2026-09-01T00:00:00Z'),
    /50%.*force/s,
    '删除 4/5（>50%）无 force 应被拦截',
  );
  const forced = svc.snapshots.prune('proj', '2026-09-01T00:00:00Z', { force: true });
  assert.deepEqual(forced, { matched: 4, removed: 4, total: 5 }, 'force 放行并删除 4 条');
  assert.equal(svc.snapshots.recent('proj').length, 1, '只剩新快照');
  console.log('✓ >50% 删除量需 force');

  // 5. 小批量删除（≤50%）：无 force 直接执行
  svc.snapshots.record([mk('proj', 'app', 2, '2026-08-05T00:00:00Z')]);
  const small = svc.snapshots.prune('proj', '2026-08-06T00:00:00Z');
  assert.equal(small.removed, 1, '小批量删除直接执行');
  assert.equal(svc.snapshots.recent('proj').length, 1, '删除后仅剩 1 条');
  console.log('✓ ≤50% 小批量正常执行');

  // 6. ISO 变体兼容：日期 only / 带毫秒 / 带时区偏移
  for (const ok of ['2026-12-31', '2026-12-31T00:00:00.123Z', '2026-12-31T00:00:00+08:00']) {
    assert.doesNotThrow(
      () => svc.snapshots.prune('proj', ok, { dryRun: true }),
      `ISO 变体应放行：${ok}`,
    );
  }
  console.log('✓ ISO 8601 变体兼容');

  store.close();
  console.log('snapshots.prune 防护测试全部通过 ✓');
}

main().catch((err) => {
  console.error('prune 防护测试失败:', err);
  process.exit(1);
});
