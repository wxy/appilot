import assert from 'node:assert/strict';
import { shouldRunElectronOnlyTask } from '../src/main/electron-task-policy';

const now = Date.parse('2026-09-10T10:00:00Z');
const due = { enabled: true, nextRunAt: '2026-09-10T09:59:00Z' };

for (const kind of ['ops-sync', 'build-status']) {
  assert.equal(shouldRunElectronOnlyTask({ ...due, kind }, now), true, `${kind} 到期应由 Electron 补跑`);
}
assert.equal(shouldRunElectronOnlyTask({ ...due, kind: 'rank' }, now), false, 'rank 只由 daemon 执行');
assert.equal(shouldRunElectronOnlyTask({ ...due, kind: 'github-sync' }, now), false, 'github 只由 daemon 执行');
assert.equal(shouldRunElectronOnlyTask({ ...due, kind: 'reviews-sync' }, now), false, '已下线的评论任务不再执行');
assert.equal(shouldRunElectronOnlyTask({ ...due, kind: 'ops-sync', enabled: false }, now), false);
assert.equal(shouldRunElectronOnlyTask({ ...due, kind: 'ops-sync' }, now, true), false, '任务中心停止时不执行');
assert.equal(
  shouldRunElectronOnlyTask({ kind: 'ops-sync', enabled: true, nextRunAt: '2026-09-10T10:01:00Z' }, now),
  false,
  '未到期不执行',
);
assert.equal(shouldRunElectronOnlyTask({ kind: 'ops-sync', enabled: true, nextRunAt: 'bad' }, now), false);

console.log('electron-task-policy 单测全部通过 ✓');
