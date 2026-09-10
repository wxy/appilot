/**
 * 休眠窗口感知（sleep-window）纯逻辑单测：
 * - 冻结检测（tick 间隔异常 → 判定被系统休眠冻结、刚唤醒）；
 * - 窗口长度 EWMA（只学短窗口 DarkWake，不被「清醒几小时」污染）；
 * - 窗口末尾停止派发（safetyMs 预留，避免请求发出即被冻结）；
 * - 清醒会话识别（窗口远长于估计 → 不裁剪、全速）；
 * - 外部暂停（系统休眠通知）与唤醒 grace 内的「休眠打断」判定。
 */
import assert from 'node:assert/strict';
import { createSleepWindowTracker } from '../src/sleep-window';

let failures = 0;
const pass = (name: string) => console.log(`✅ PASS: ${name}`);
const fail = (name: string, err: unknown) => {
  failures += 1;
  console.error(`❌ FAIL: ${name} — ${err instanceof Error ? err.message : String(err)}`);
};
const runCase = (name: string, fn: () => void): void => {
  try {
    fn();
    pass(name);
  } catch (err) {
    fail(name, err);
  }
};

const S = 1000;
const MIN = 60 * S;

function main(): void {
  runCase('未知阶段：未观测到休眠前不裁剪派发', () => {
    const t = createSleepWindowTracker();
    t.noteTick(0);
    assert.equal(t.snapshot(0).phase, 'unknown', '首个 tick 前为 unknown');
    assert.equal(t.canDispatch(0), true, 'unknown 阶段派发不受限');
    assert.equal(t.canDispatch(10 * MIN), true, '未知阶段长时间也不裁剪（避免误伤清醒会话）');
    assert.equal(t.isSleepInterrupted(0), false, '没唤醒过就没有休眠打断');
  });

  runCase('冻结检测：tick 间隔异常 → woke + 冻结时长', () => {
    const t = createSleepWindowTracker({ gapMs: 120 * S });
    t.noteTick(0);
    const a = t.noteTick(15 * S);
    assert.equal(a.woke, false, '正常心跳间隔不算唤醒');
    const b = t.noteTick(15 * S + 50 * MIN);
    assert.equal(b.woke, true, '间隔 50min 判为冻结恢复');
    assert.equal(b.frozenMs, 50 * MIN, '冻结时长 = 间隔');
    const snap = t.snapshot(15 * S + 50 * MIN);
    assert.equal(snap.phase, 'window', '唤醒后进入窗口阶段');
    assert.equal(snap.sleepCycles, 1, '记录 1 次休眠周期');
    assert.equal(snap.lastWakeAtMs, 15 * S + 50 * MIN, '记录唤醒时刻');
  });

  runCase('窗口估计：只学短窗口（DarkWake ≈45s），不被清醒数小时污染', () => {
    const t = createSleepWindowTracker({ gapMs: 120 * S, defaultWindowMs: 45 * S, alpha: 0.5 });
    // 第 1 个窗口：清醒 40s → 睡 1h
    let now = 0;
    t.noteTick(now);
    for (let i = 1; i <= 8; i++) t.noteTick((now += 5 * S));
    now += 60 * MIN;
    t.noteTick(now);
    const afterFirst = t.snapshot(now).avgWindowMs;
    assert.equal(afterFirst, 40 * S, `首次观测即采用实测窗口 40s（实际 ${afterFirst}）`);
    // 第 2 个窗口：清醒 40s → 睡 1h（观测后 EWMA 向 40s 收敛）
    for (let i = 1; i <= 8; i++) t.noteTick((now += 5 * S));
    now += 60 * MIN;
    t.noteTick(now);
    const snap2 = t.snapshot(now);
    assert.ok(
      snap2.avgWindowMs < 45 * S && snap2.avgWindowMs >= 40 * S,
      `EWMA 向实测 40s 收敛（实际 ${snap2.avgWindowMs}）`,
    );
    // 清醒会话（5h）不应被当成窗口：估计保持不变
    const before = t.snapshot(now).avgWindowMs;
    for (let i = 1; i <= 60; i++) t.noteTick((now += 5 * MIN));
    now += 60 * MIN;
    t.noteTick(now);
    assert.equal(t.snapshot(now).avgWindowMs, before, '长会话不参与窗口估计（不被污染）');
  });

  runCase('窗口末尾停止派发：预算 = 估计窗口 − safety', () => {
    const t = createSleepWindowTracker({ gapMs: 120 * S, defaultWindowMs: 45 * S, safetyMs: 8 * S });
    t.noteTick(0);
    const wake = 60 * MIN;
    t.noteTick(wake); // 冻结恢复 → 进入窗口
    assert.equal(t.canDispatch(wake + 10 * S), true, '窗口前段可派发');
    assert.equal(t.canDispatch(wake + 36 * S), true, '37s 预算内仍可派发');
    assert.equal(t.canDispatch(wake + 40 * S), false, '临近入睡（≥37s）停止派发，避免发出即被冻结');
    assert.equal(t.canDispatch(wake + 44 * S), false, '窗口末尾仍不派发');
  });

  runCase('清醒会话：窗口远超估计 → 恢复全速派发', () => {
    const t = createSleepWindowTracker({ gapMs: 120 * S, defaultWindowMs: 45 * S, awakeFactor: 4, safetyMs: 8 * S });
    t.noteTick(0);
    const wake = 60 * MIN;
    t.noteTick(wake);
    assert.equal(t.canDispatch(wake + 40 * S), false, '先按窗口裁剪');
    const later = wake + 4 * 45 * S + S; // 超过 awakeFactor × 估计
    assert.equal(t.canDispatch(later), true, '判定为清醒会话后不再裁剪（用户在电脑前，全速跑）');
  });

  runCase('外部暂停（系统休眠通知）：暂停期不派发，恢复后进入窗口模式', () => {
    const t = createSleepWindowTracker();
    t.noteTick(0);
    assert.equal(t.canDispatch(10 * S), true, '未暂停时可派发');
    t.setSuspended(true);
    assert.equal(t.isSuspended(), true);
    assert.equal(t.canDispatch(11 * S), false, '暂停期不派发新任务');
    t.setSuspended(false);
    assert.equal(t.canDispatch(12 * S), true, '恢复后允许派发');
    t.noteTick(12 * S);
    assert.equal(t.snapshot(12 * S).phase, 'unknown', '恢复后重新观测（unknown 不裁剪）');
  });

  runCase('休眠打断：唤醒 grace 内的瞬时错误判为打断并计数', () => {
    const t = createSleepWindowTracker({ gapMs: 120 * S, wakeGraceMs: 60 * S });
    t.noteTick(0);
    const wake = 60 * MIN;
    t.noteTick(wake);
    assert.equal(t.isSleepInterrupted(wake + 5 * S), true, '唤醒后 5s 内的错误 = 被休眠打断');
    assert.equal(t.isSleepInterrupted(wake + 30 * S), true, 'grace(60s) 内仍判打断（冻结期间超时定时器此刻才触发）');
    assert.equal(t.isSleepInterrupted(wake + 61 * S), false, '超出 grace 后按真实瞬时错误处理（正常重试连击）');
    t.noteSleepInterrupt();
    t.noteSleepInterrupt();
    assert.equal(t.snapshot(wake + 5 * S).sleepInterrupts, 2, '打断次数累计（观测用）');
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) FAILED`);
    process.exit(1);
  }
  console.log('\n🎉 All sleep-window tests passed!');
}

main();
