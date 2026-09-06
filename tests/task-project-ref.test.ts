/**
 * 任务↔项目关联判定单测（demo 残留任务场景）。
 * 纯 node（不 import electron）。
 */
import assert from 'node:assert';
import { taskReferencesProject } from '../src/main/task-project-ref';

const demoTask = {
  id: 'github-sync:demo',
  kind: 'github-sync',
  source: 'dsh',
  instance: { projectName: 'demo', path: '/path/to/git-repo' },
};

async function main() {
  // 1. demo 残留：按 projectName / id 前缀 / path 命中
  assert.equal(
    taskReferencesProject(demoTask as any, { name: 'demo', path: '/path/to/git-repo', productIds: [] }),
    true,
  );
  assert.equal(
    taskReferencesProject(demoTask as any, { name: 'demo', path: '/path/to/git-repo/' }), // 尾斜杠归一
    true,
  );
  // 2. 无关任务不误伤
  assert.equal(
    taskReferencesProject(
      { id: 'github-sync:glo', kind: 'github-sync', instance: { projectName: 'glo', path: '/x/glo' } },
      { name: 'demo', path: '/path/to/git-repo', productIds: [] },
    ),
    false,
  );
  // 3. 按产品命中（rank 实例行：id 前缀 / instance.productId）
  assert.equal(
    taskReferencesProject(
      { id: 'p1:en:us:kw', kind: 'rank', instance: { productId: 'p1', keyword: 'kw' } },
      { name: 'ai', path: '/x', productIds: ['p1'] },
    ),
    true,
  );
  assert.equal(
    taskReferencesProject(
      { id: 'other:en:us:kw', kind: 'rank', instance: { productId: 'x1', keyword: 'kw' } },
      { name: 'ai', path: '/x', productIds: ['p1'] },
    ),
    false,
  );
  console.log('task-project-ref 单测全部通过 ✓');
}

main().catch((err) => {
  console.error('task-project-ref 测试失败:', err);
  process.exit(1);
});
