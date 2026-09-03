/**
 * 自更新机制测试：
 * 1) 指纹原语（fingerprintDirs / isChanged / parseMonitorDirsEnv）
 * 2) daemon 库级：代码变更 → codeChanged()=true → requestRestart 编排
 *    （注入 spawn + exit，进程不真退出）：spawn 收到同命令、租约让位、
 *    stop 干净退出、防抖阻止连发。
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { openStore } from '@appilot-labs/appilot-headless';
import {
  fingerprintDirs,
  isChanged,
  parseMonitorDirsEnv,
  hasFiles,
} from '../src/self-update.js';
import { runDaemon, SCHEDULER_LEADER_ID } from '../src/index.js';
import type { RestartSpec } from '../src/self-update.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'sched-selfupd-'));
  const logs: string[] = [];
  const log = (m: string) => logs.push(m);

  /* ── 1. 指纹原语 ── */
  const mon = join(dir, 'mon');
  mkdirSync(mon, { recursive: true });
  const sentinel = join(mon, 'executors.js');
  writeFileSync(sentinel, 'v1');
  const fp1 = fingerprintDirs([mon]);
  assert.equal(Object.keys(fp1).length, 1, '只应监控到 1 个 js');
  assert.equal(isChanged(fp1, fp1), false, '未变 → false');
  writeFileSync(sentinel, 'v2');
  const fp2 = fingerprintDirs([mon]);
  assert.equal(isChanged(fp1, fp2), true, '内容变 → true');
  writeFileSync(join(mon, 'new-module.js'), 'x');
  assert.equal(isChanged(fp2, fingerprintDirs([mon])), true, '新增文件 → true');
  rmSync(join(mon, 'new-module.js'));
  assert.equal(isChanged(fp2, fingerprintDirs([mon])), false, '删除文件不算变更');
  assert.equal(hasFiles(fp1), true, '有文件 → hasFiles true');
  assert.equal(hasFiles(fingerprintDirs([join(dir, 'no-such-dir')])), false, '空目录 → false');
  assert.deepEqual(parseMonitorDirsEnv(' /a/x ,/b/y;'), ['/a/x', '/b/y'], 'env 目录解析');
  console.log('✓ 指纹原语（fingerprintDirs/isChanged/hasFiles/parseMonitorDirsEnv）');

  /* ── 2. daemon 库级自重启编排（注入 spawn + exit，进程不退出） ── */
  const dbPath = join(dir, 'appilot.db');
  const socketPath = join(dir, 'scheduler.sock');
  const spawned: RestartSpec[] = [];
  let exitCode: number | null = null;
  const d = await runDaemon({
    dbPath,
    socketPath,
    reconcileIntervalMs: 10_000,
    heartbeatMs: 100,
    ttlMs: 2000,
    updateCheckIntervalMs: 0, // 周期关闭——用手动 requestRestart 驱动
    monitorDirs: [mon],
    spawnRestartImpl: (spec) => spawned.push(spec),
    exitProcess: (code) => {
      exitCode = code;
    },
    log,
  });
  assert.equal(d.codeChanged(), false, '基线未变 → codeChanged false');
  // socket 服务正常（重启编排不应在正常运行期干扰）
  assert.equal(d.store.lease.leader(), SCHEDULER_LEADER_ID);

  // 修改监控文件 → codeChanged true
  writeFileSync(sentinel, 'v3');
  assert.equal(d.codeChanged(), true, '文件变更 → codeChanged true');

  // requestRestart：spawn 同命令、租约让位、stop 干净退出（注入 exit，不杀测试进程）
  d.requestRestart();
  await sleep(300);
  assert.equal(spawned.length, 1, '应 spawn 1 个重启进程');
  assert.deepEqual(spawned[0].args, process.argv.slice(1), '重启命令与当前一致');
  assert.equal(spawned[0].command, process.execPath, '重启用同一 node');
  assert.equal(exitCode, 0, 'stop 后应退出（注入 exit 0）');
  assert.ok(logs.some((l) => l.includes('自重启')), '应记录自重启');
  assert.ok(logs.some((l) => l.includes('daemon exited cleanly')), '应记录干净退出');
  // 租约已让位：重新开 store 验证无主
  const probe = openStore(dbPath);
  assert.equal(probe.lease.leader(), null, '让位后无主（新 daemon 可立即接管）');
  probe.close();

  // 防抖：restarting 状态 + 冷却 → 再次 requestRestart 无动作
  const spawnedBefore = spawned.length;
  d.requestRestart();
  await sleep(100);
  assert.equal(spawned.length, spawnedBefore, 'restarting 防抖：不重复 spawn');
  console.log('✓ daemon 自重启编排（spawn 同命令 / 租约让位 / 干净退出 / 防抖）');

  // 库级 handle 暴露的 codeChanged 供 socket/测试使用
  assert.equal(typeof d.codeChanged, 'function');
  assert.equal(typeof d.requestRestart, 'function');
  console.log('自更新机制测试全部通过 ✓');
}

main().catch((err) => {
  console.error('自更新测试失败:', err);
  process.exit(1);
});
