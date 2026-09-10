/**
 * 调度循环的休眠窗口行为（fake clock 集成测试）：
 * - 冻结恢复后按窗口节拍调度：窗口前段派发、末尾停止派发（在途跑完）；
 * - 清醒会话不裁剪（用户在电脑前全速）；
 * - 唤醒后 grace 内的 aborted 错误判为「休眠打断」：不标红、不计失败连击、
 *   排短退避重试（这是「睡一轮就红一批」的直接修复）；
 * - setSuspended（系统休眠通知）暂停派发。
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store';
import type { AppilotStore } from '../src/store';
import { createLeaseScheduler, type TaskExecutor } from '../src/scheduler';

let failures = 0;
const pass = (name: string) => console.log(`✅ PASS: ${name}`);
const fail = (name: string, err: unknown) => {
  failures += 1;
  console.error(`❌ FAIL: ${name} — ${err instanceof Error ? err.message : String(err)}`);
};
const runCase = async (name: string, fn: () => Promise<void> | void): Promise<void> => {
  try {
    await fn();
    pass(name);
  } catch (err) {
    fail(name, err);
  }
};
const tick = () => new Promise((r) => setTimeout(r, 10));
const S = 1000;
const MIN = 60 * S;

function seedDue(store: AppilotStore, id: string, nowMs: number, kind = 'net'): void {
  store.tasks.upsert({
    id,
    title: `${kind} ${id}`,
    intervalMinutes: 1440,
    lastRunAt: null,
    nextRunAt: new Date(nowMs - MIN).toISOString(),
    lastStatus: 'never',
    lastSummary: null,
    runCount: 0,
    source: 'test',
    kind,
    instance: { keyword: id, storefront: 'us' },
  });
}

async function main(): Promise<void> {
  await runCase('窗口末尾停止派发；唤醒后恢复（fake clock）', async () => {
    const store = openStore(join(mkdtempSync(join(tmpdir(), 'sched-sleep-')), 'appilot.db'));
    let clock = 0;
    const runs: string[] = [];
    const exec: TaskExecutor = {
      title: '网络任务',
      intervalMinutes: 1440,
      run: async (ctx) => {
        runs.push(ctx.task.id);
        return 'ok';
      },
    };
    const sched = createLeaseScheduler({
      store,
      leaderId: 'sleep-it',
      jobs: [],
      executors: { net: exec },
      heartbeatMs: 100_000,
      now: () => clock,
      sleepWindow: { gapMs: 120 * S, defaultWindowMs: 45 * S, safetyMs: 8 * S, burstTickMs: 0 },
    });

    // t=0：首个 tick（unknown 阶段，全速派发）
    for (let i = 0; i < 5; i++) seedDue(store, `t${i}`, clock);
    sched.kick();
    await tick();
    assert.equal(runs.length, 5, `首个 tick 派发全部到期实例（实际 ${runs.length}）`);

    // 冻结 1 小时 → 唤醒：进入窗口阶段
    clock = 60 * MIN;
    for (let i = 0; i < 5; i++) seedDue(store, `w${i}`, clock);
    sched.kick();
    await tick();
    assert.equal(runs.length, 10, '唤醒后窗口前段照常派发');
    assert.equal(sched.sleep()?.phase, 'window', 'tracker 进入 window 阶段');

    // 窗口预算（45s − 8s = 37s）内仍可派发
    clock += 30 * S;
    for (let i = 0; i < 3; i++) seedDue(store, `m${i}`, clock);
    sched.kick();
    await tick();
    assert.equal(runs.length, 13, '窗口 30s 时仍在预算内 → 派发');

    // 超过预算（40s > 37s）：停止派发新任务（在途的已跑完）
    clock += 10 * S;
    for (let i = 0; i < 3; i++) seedDue(store, `l${i}`, clock);
    sched.kick();
    await tick();
    assert.equal(runs.length, 13, '窗口末尾停止派发（避免发出即被休眠冻结）');

    // 再次冻结 → 唤醒后恢复派发
    clock += 60 * MIN;
    sched.kick();
    await tick();
    assert.equal(runs.length, 16, '下一次唤醒后继续派发积压任务');
    const snap = sched.sleep();
    assert.ok((snap?.sleepCycles ?? 0) >= 2, `记录休眠周期（实际 ${snap?.sleepCycles}）`);
    sched.dispose();
    store.close();
  });

  await runCase('清醒会话不裁剪（长时间活跃 → 全速派发）', async () => {
    const store = openStore(join(mkdtempSync(join(tmpdir(), 'sched-awake-')), 'appilot.db'));
    let clock = 0;
    let runs = 0;
    const exec: TaskExecutor = {
      title: '网络任务',
      intervalMinutes: 1440,
      run: async () => {
        runs += 1;
        return 'ok';
      },
    };
    const sched = createLeaseScheduler({
      store,
      leaderId: 'awake-it',
      jobs: [],
      executors: { net: exec },
      heartbeatMs: 100_000,
      now: () => clock,
      sleepWindow: { gapMs: 120 * S, defaultWindowMs: 45 * S, safetyMs: 8 * S, burstTickMs: 0 },
    });
    // 先制造一次窗口认知
    sched.kick();
    clock = 60 * MIN;
    sched.kick();
    // 清醒会话：持续活跃远超 awakeFactor × 窗口
    for (let i = 0; i < 20; i++) {
      clock += 30 * S;
      seedDue(store, `a${i}`, clock);
      sched.kick();
      await tick();
    }
    const before = runs;
    clock += 30 * S;
    seedDue(store, 'a-late', clock);
    sched.kick();
    await tick();
    assert.equal(runs, before + 1, '清醒会话里窗口末尾也照常派发（不误伤）');
    sched.dispose();
    store.close();
  });

  await runCase('休眠打断：唤醒 grace 内的 aborted 不标红、不计连击', async () => {
    const store = openStore(join(mkdtempSync(join(tmpdir(), 'sched-intr-')), 'appilot.db'));
    let clock = 0;
    let throwAbort = false;
    const exec: TaskExecutor = {
      title: '网络任务',
      intervalMinutes: 1440,
      run: async () => {
        if (throwAbort) throw new Error('This operation was aborted');
        return 'ok';
      },
    };
    const sched = createLeaseScheduler({
      store,
      leaderId: 'intr-it',
      jobs: [],
      executors: { net: exec },
      heartbeatMs: 100_000,
      now: () => clock,
      sleepWindow: { gapMs: 120 * S, defaultWindowMs: 45 * S, safetyMs: 8 * S, wakeGraceMs: 60 * S, burstTickMs: 0 },
    });
    seedDue(store, 'x', clock);
    sched.kick();
    await tick();
    assert.equal(store.tasks.get('x')?.lastStatus, 'ok', '首次正常成功');

    // 连续 5 轮「休眠 → 唤醒 → aborted」：都不该把任务标红
    throwAbort = true;
    for (let i = 0; i < 5; i++) {
      clock += 60 * MIN; // 冻结 1h（唤醒 grace 起点）
      // 只把排期改回「已到期」（保持 ok 状态），模拟积压任务在唤醒窗口被派发
      const prevRow = store.tasks.get('x') as any;
      store.tasks.upsert({ ...prevRow, nextRunAt: new Date(clock - MIN).toISOString() });
      sched.kick();
      await tick();
      const row = store.tasks.get('x');
      assert.equal(row?.lastStatus, 'ok', `第 ${i + 1} 轮休眠打断后仍为 ok（不标红）`);
      assert.ok(
        String(row?.lastSummary ?? '').startsWith('SLEEP-INTERRUPT'),
        `摘要标注休眠打断（实际 ${row?.lastSummary}）`,
      );
    }
    const snap = sched.sleep();
    assert.equal(snap?.sleepInterrupts, 5, `打断计数（实际 ${snap?.sleepInterrupts}）`);
    const retries = (store.executions.latest(50) as any[]).filter((e) => e.reason === 'sleep-interrupt');
    assert.equal(retries.length, 5, '时间线记录为 retry（reason=sleep-interrupt），不是 failed');
    sched.dispose();
    store.close();
  });

  await runCase('setSuspended（系统休眠通知）：暂停派发，唤醒后恢复', async () => {
    const store = openStore(join(mkdtempSync(join(tmpdir(), 'sched-susp-')), 'appilot.db'));
    let clock = 0;
    let runs = 0;
    const exec: TaskExecutor = {
      title: '网络任务',
      intervalMinutes: 1440,
      run: async () => {
        runs += 1;
        return 'ok';
      },
    };
    const sched = createLeaseScheduler({
      store,
      leaderId: 'susp-it',
      jobs: [],
      executors: { net: exec },
      heartbeatMs: 100_000,
      now: () => clock,
      sleepWindow: { burstTickMs: 0 },
    });
    seedDue(store, 's1', clock);
    sched.setSuspended(true);
    sched.kick();
    await tick();
    assert.equal(runs, 0, '暂停期不派发新任务');
    assert.equal(sched.sleep()?.suspended, true, '状态标记为暂停');

    seedDue(store, 's2', clock);
    sched.setSuspended(false);
    await tick();
    assert.ok(runs >= 1, '唤醒恢复后派发');
    sched.dispose();
    store.close();
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) FAILED`);
    process.exit(1);
  }
  console.log('\n🎉 All scheduler sleep-window integration tests passed!');
}

void main();
