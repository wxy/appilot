/**
 * data-sync-health 单测：镜像成功/失败记账与聚合口径。
 */
import assert from 'node:assert';
import {
  getDataSyncHealth,
  recordMirrorFailure,
  recordMirrorSuccess,
  resetDataSyncHealthForTest,
} from '../src/main/data-sync-health';

async function main(): Promise<void> {
  resetDataSyncHealthForTest();

  // 初始：无记录 = 健康
  assert.equal(getDataSyncHealth().healthy, true);

  // 失败两次 → 连续计数 2，不健康
  recordMirrorFailure('projects', ' mirror 写入失败 #1');
  recordMirrorFailure('projects', 'mirror 写入失败 #2');
  let health = getDataSyncHealth();
  assert.equal(health.healthy, false);
  assert.deepEqual(health.failingDomains, ['projects']);
  assert.equal(health.domains.projects.consecutiveFailures, 2);
  assert.match(health.domains.projects.lastErrorMessage ?? '', /#2/);
  assert.ok(health.domains.projects.lastErrorAt);

  // 成功一次 → 清零恢复健康
  recordMirrorSuccess('projects');
  health = getDataSyncHealth();
  assert.equal(health.domains.projects.consecutiveFailures, 0);
  assert.equal(health.healthy, true);

  // 多域：只标 failing 的域
  recordMirrorFailure('tasks', 'lock busy');
  health = getDataSyncHealth();
  assert.deepEqual(health.failingDomains, ['tasks']);
  assert.equal(health.healthy, false);

  resetDataSyncHealthForTest();
  console.log('🎉 All data-sync-health tests passed!');
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
