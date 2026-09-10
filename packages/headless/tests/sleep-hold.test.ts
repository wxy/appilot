/**
 * 休眠保持（sleep-hold）单测：
 * - macOS 启用时 setHold(true) spawn `caffeinate -i -t <max>`（幂等，只 spawn 一次）；
 * - setHold(false)/dispose 释放（kill）；
 * - 子进程异常退出 → 归为未持有（可再次保持）；
 * - spawn 抛错 → 容忍（不抛出，退化为易抖动分类）；
 * - 非 macOS / enabled=false → no-op（不 spawn）。
 */
import assert from 'node:assert/strict';
import { createSleepHold, supportsSleepHold, type SleepHoldSpawned } from '../src/sleep-hold';

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

interface FakeChild extends SleepHoldSpawned {
  killed: boolean;
  emitExit(): void;
}

function fakeSpawner(log: { cmd: string; args: string[] }[]): {
  spawn: (cmd: string, args: string[]) => SleepHoldSpawned;
  children: FakeChild[];
} {
  const children: FakeChild[] = [];
  return {
    children,
    spawn(cmd, args) {
      log.push({ cmd, args });
      const exitHandlers: Array<() => void> = [];
      const child: FakeChild = {
        killed: false,
        kill() {
          child.killed = true;
        },
        once(ev, cb) {
          if (ev === 'exit') exitHandlers.push(cb as () => void);
        },
        emitExit() {
          for (const h of exitHandlers) h();
        },
      };
      children.push(child);
      return child;
    },
  };
}

function main(): void {
  runCase('supportsSleepHold：仅 macOS + 启用', () => {
    assert.equal(supportsSleepHold('darwin'), true);
    assert.equal(supportsSleepHold('win32'), false);
    assert.equal(supportsSleepHold('linux'), false);
    assert.equal(supportsSleepHold('darwin', false), false, 'enabled=false 时不支持');
  });

  runCase('macOS：setHold(true) spawn caffeinate（幂等）；false/dispose 释放', () => {
    const log: { cmd: string; args: string[] }[] = [];
    const { spawn, children } = fakeSpawner(log);
    const hold = createSleepHold({ platform: 'darwin', maxHoldSec: 120, spawn });
    assert.equal(hold.isAvailable(), true);
    assert.equal(hold.isHolding(), false, '初始未持有');

    hold.setHold(true);
    assert.equal(hold.isHolding(), true, '持有中');
    assert.equal(log.length, 1, 'spawn 一次');
    assert.equal(log[0].cmd, 'caffeinate');
    assert.deepEqual(log[0].args, ['-i', '-t', '120'], '参数：阻止空闲休眠 + 兜底自释放秒数');

    hold.setHold(true);
    assert.equal(log.length, 1, '重复 setHold(true) 幂等（不重复 spawn）');

    hold.setHold(false);
    assert.equal(hold.isHolding(), false, '释放后未持有');
    assert.equal(children[0].killed, true, '释放时 kill 子进程');

    hold.setHold(true);
    assert.equal(log.length, 2, '释放后可再次保持');
    hold.dispose();
    assert.equal(children[1].killed, true, 'dispose 也会释放');
    hold.setHold(true);
    assert.equal(log.length, 2, 'dispose 后不再 spawn（已失效）');
  });

  runCase('子进程异常退出 → 归为未持有（可重新保持）', () => {
    const log: { cmd: string; args: string[] }[] = [];
    const { spawn, children } = fakeSpawner(log);
    const hold = createSleepHold({ platform: 'darwin', spawn });
    hold.setHold(true);
    assert.equal(hold.isHolding(), true);
    children[0].emitExit(); // caffeinate -t 到期自然退出
    assert.equal(hold.isHolding(), false, '退出事件后状态归位');
    hold.setHold(true);
    assert.equal(log.length, 2, '可重新保持');
  });

  runCase('spawn 抛错：容忍（不抛出），退化为易抖动分类', () => {
    const logs: string[] = [];
    let calls = 0;
    const hold = createSleepHold({
      platform: 'darwin',
      log: (m) => logs.push(m),
      spawn: () => {
        calls += 1;
        throw new Error('caffeinate 不可用');
      },
    });
    hold.setHold(true); // 不应抛出
    assert.equal(calls, 1, '尝试过 spawn');
    assert.equal(hold.isHolding(), false, '失败后视为未持有');
    assert.ok(logs.some((m) => m.includes('保持唤醒失败')), '记录失败原因（可排查）');
  });

  runCase('非 macOS / 未启用：no-op（不 spawn）', () => {
    for (const opts of [{ platform: 'linux' }, { platform: 'darwin', enabled: false }]) {
      const log: { cmd: string; args: string[] }[] = [];
      const { spawn } = fakeSpawner(log);
      const hold = createSleepHold({ ...opts, spawn });
      assert.equal(hold.isAvailable(), false, `${JSON.stringify(opts)} 不支持`);
      hold.setHold(true);
      assert.equal(log.length, 0, '不 spawn');
      assert.equal(hold.isHolding(), false);
    }
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) FAILED`);
    process.exit(1);
  }
  console.log('\n🎉 All sleep-hold tests passed!');
}

main();
