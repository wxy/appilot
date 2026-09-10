/**
 * 系统休眠通知（suspend/resume）与休眠状态上报：
 * - socket 'suspend' → daemon 暂停派发（status.sleep.suspended=true、dispatchAllowed=false）；
 * - socket 'resume' → 恢复派发（suspended=false，且立刻 kick 一轮）；
 * - status.sleep 字段齐全（phase/avgWindowMs/sleepCycles/lastWakeAt/sleepInterrupts）。
 *
 * 背景：Mac 空闲时每小时一轮 Maintenance Sleep（DarkWake ~45s），窗口末尾被入睡
 * 打断的请求会在唤醒后才超时失败（见 headless sleep-window.ts）。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { runDaemon, sendSchedulerCommand, SCHEDULER_LEADER_ID } from '../src/index.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'sched-suspend-'));
  const dbPath = join(dir, 'appilot.db');
  const socketPath = join(dir, 'scheduler.sock');
  const logs: string[] = [];
  const d = await runDaemon({
    dbPath,
    socketPath,
    reconcileIntervalMs: 300,
    heartbeatMs: 100,
    ttlMs: 2000,
    updateCheckIntervalMs: 0,
    log: (m: string) => logs.push(m),
  });
  assert.equal(d.store.lease.leader(), SCHEDULER_LEADER_ID, 'daemon 应持租约');

  // 1. status 暴露 sleep 快照（壳据此在任务中心显示「窗口 ~45s / 系统休眠中」）
  const st0 = await sendSchedulerCommand(socketPath, 'status', {}, 3000);
  assert.equal(st0.ok, true, 'status ok');
  const s0 = (st0.result as any)?.sleep;
  assert.ok(s0 && typeof s0 === 'object', `status.sleep 存在（实际 ${JSON.stringify(s0)}）`);
  assert.equal(s0.suspended, false, '初始未暂停');
  assert.equal(s0.phase, 'unknown', '初始阶段 unknown（尚未观测到休眠）');
  assert.equal(typeof s0.avgWindowMs, 'number', 'avgWindowMs 数值');
  assert.equal(s0.sleepCycles, 0, '尚未观测到休眠周期');
  assert.equal(s0.sleepInterrupts, 0, '尚无休眠打断');
  console.log('✓ status.sleep 字段齐全（phase/suspended/avgWindowMs/sleepCycles）');

  // 2. suspend → 暂停派发
  const sus = await sendSchedulerCommand(socketPath, 'suspend', {}, 3000);
  assert.equal(sus.ok, true, 'suspend 应 ok');
  const st1 = await sendSchedulerCommand(socketPath, 'status', {}, 3000);
  const s1 = (st1.result as any)?.sleep;
  assert.equal(s1?.suspended, true, 'suspend → suspended=true');
  assert.equal(s1?.dispatchAllowed, false, 'suspend → 不派发新任务');
  console.log('✓ suspend：status.sleep.suspended=true / dispatchAllowed=false');

  // 3. resume → 恢复（并立刻 kick 一轮：不应抛错）
  const res = await sendSchedulerCommand(socketPath, 'resume', {}, 3000);
  assert.equal(res.ok, true, 'resume 应 ok');
  await sleep(50);
  const st2 = await sendSchedulerCommand(socketPath, 'status', {}, 3000);
  const s2 = (st2.result as any)?.sleep;
  assert.equal(s2?.suspended, false, 'resume → suspended=false');
  assert.equal(s2?.dispatchAllowed, true, 'resume → 允许派发');
  console.log('✓ resume：恢复派发（suspended=false / dispatchAllowed=true）');

  // 4. 日志留痕（排障：休眠/唤醒各一条）
  assert.ok(logs.some((m) => m.includes('system suspend')), '日志记录 suspend');
  assert.ok(logs.some((m) => m.includes('system resume')), '日志记录 resume');
  console.log('✓ 休眠/唤醒日志留痕');

  await d.stop();
  console.log('\n🎉 All suspend/resume tests passed!');
}

main().catch((err) => {
  console.error('suspend/resume 测试失败:', err);
  process.exit(1);
});
