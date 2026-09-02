/**
 * 服务端工具冒烟：appilot_snapshots 装配 + 隔离 DB 上真实 execute。
 *
 * 验证：工具对象可创建、latest/history 两种模式在隔离 DB（APPILOT_DB_FILE）
 * 上返回正确结构——不依赖 ctx / 凭据 / 网络，纯 headless 共享 DB 只读路径。
 * 运行：npx tsx scripts/tool-smoke.mjs
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSharedHeadlessStore } from '@appilot-labs/appilot-common';
import { createSnapshotsQueryTool } from '../src/snapshots.js';
import { createTaskRunTool, createTasksStatusTool } from '../src/tasks.js';

const tmp = mkdtempSync(join(tmpdir(), 'tool-smoke-'));
process.env.APPILOT_DB_FILE = join(tmp, 'appilot.db');
process.env.APPILOT_REGISTRY_FILE = join(tmp, 'absent-registry.json'); // 跳过旧 JSON 迁移

async function main() {
  // seed：项目 + DSH 维度快照两行
  const store = openSharedHeadlessStore();
  const now = new Date().toISOString();
  store.projects.save({
    name: 'demo',
    path: '/tmp/demo',
    githubUrl: null,
    platform: 'macos',
    languages: ['en'],
    lastResolvedAt: now,
    artworkUrl: null,
    updatedAt: now,
  });
  store.snapshots.add([
    { projectName: 'demo', productId: null, keyword: 'app', language: 'en', storefront: 'us', rank: 3, totalResults: 100, checkedAt: '2026-08-01T00:00:00Z' },
    { projectName: 'demo', productId: null, keyword: 'app', language: 'en', storefront: 'us', rank: 1, totalResults: 100, checkedAt: '2026-08-02T00:00:00Z' },
  ]);

  const tool = createSnapshotsQueryTool();
  console.log('tool:', tool.name, '| params:', Object.keys(tool.parameters || {}).join(','));

  const latest = await tool.execute({ projectName: 'demo' });
  const latestObj = typeof latest === 'string' ? JSON.parse(latest) : latest;
  const latestSnaps = latestObj.snapshots || [];
  if (latestSnaps[0]?.rank !== 1) throw new Error(`latest 应返回最新 rank=1: ${JSON.stringify(latest).slice(0, 200)}`);
  console.log('✓ appilot_snapshots mode=latest（最新 rank=1）');

  const hist = await tool.execute({ projectName: 'demo', mode: 'history', keyword: 'app', limit: 10 });
  const histObj = typeof hist === 'string' ? JSON.parse(hist) : hist;
  if (histObj.count !== 2) throw new Error(`history 应 count=2: ${JSON.stringify(hist).slice(0, 200)}`);
  console.log('✓ appilot_snapshots mode=history（keyword 过滤 count=2）');

  const miss = await tool.execute({ projectName: 'nope' });
  console.log('✓ 未知项目（空结果不抛）:', JSON.stringify(miss).slice(0, 80));

  // appilot_tasks 装配 + appilot_task_run（调度器未启动 → 明确 error）
  const statusTool = createTasksStatusTool();
  const runTool = createTaskRunTool();
  const statusVal = await statusTool.execute({});
  if (!Array.isArray(statusVal.tasks)) throw new Error('appilot_tasks 应返回 tasks 数组');
  console.log(`✓ appilot_tasks（tasks=${statusVal.tasks.length}）`);
  const runErr = await runTool.execute({ taskId: 'release-sync' });
  if (!runErr.error || !runErr.error.includes('调度器未运行')) {
    throw new Error(`run 未启动应报错: ${JSON.stringify(runErr).slice(0, 200)}`);
  }
  console.log('✓ appilot_task_run（调度器未启动 → 明确错误）');

  // appilot_task_run 成功路径（注入 fake scheduler）+ 未知任务
  const fakeScheduler = {
    runNow: async (id) =>
      id === 'release-sync'
        ? { id, title: '发布同步', intervalMinutes: 60, lastRunAt: new Date().toISOString(), nextRunAt: null, lastStatus: 'ok', lastSummary: 'app: tag=v1 · 发布 1', runCount: 1, source: 'dsh' }
        : undefined,
  };
  const runOkTool = createTaskRunTool(fakeScheduler);
  const okVal = await runOkTool.execute({ taskId: 'release-sync' });
  if (!okVal.task || okVal.task.id !== 'release-sync' || okVal.task.lastStatus !== 'ok') {
    throw new Error(`run 成功路径应返回 task: ${JSON.stringify(okVal).slice(0, 200)}`);
  }
  console.log('✓ appilot_task_run（成功路径 → 返回 task 新状态）');
  const unknownVal = await runOkTool.execute({ taskId: 'nope' });
  if (!unknownVal.error || !unknownVal.error.includes('未知任务')) {
    throw new Error(`run 未知任务应报错: ${JSON.stringify(unknownVal).slice(0, 200)}`);
  }
  console.log('✓ appilot_task_run（未知任务 → 明确错误）');
  console.log('工具冒烟通过 ✓');
}

main().catch((err) => {
  console.error('工具冒烟失败:', err);
  process.exit(1);
});
