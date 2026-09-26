/**
 * 启动退出码语义测试（审计 2026-09-26 H4）：
 * daemon 必须区分「单例仲裁让位」（exit 0）与「真实启动失败」（exit 1）——
 * 旧实现一律 exit 0，壳 ensure 把 socket/DB 启动失败误判为「让位成功、
 * 调度在跑」，造成无人调度的静默停摆。
 *
 * 1) 库级：租约被占 → runDaemon 抛 YieldToActiveSchedulerError；其他错误不是。
 * 2) 进程级（spawn dist/cli.js）：
 *    - 租约被测试进程持有时启动 → exit 0（让位）；
 *    - DB 路径是目录（openStore 必败）→ exit 1（真实失败）。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { openStore } from '@appilot-labs/appilot-headless';
import { runDaemon, YieldToActiveSchedulerError } from '../src/daemon.js';

const CLI = join(__dirname, '..', 'dist', 'cli.js');

function onceExit(child: ReturnType<typeof spawn>): Promise<number> {
  return new Promise((resolve) => child.on('exit', (code) => resolve(code ?? -1)));
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'sched-exitcode-'));
  const dbPath = join(dir, 'appilot.db');

  /* ── 1. 库级：错误分类 ── */
  // 租约被他人持有 → 让位错误类型
  const holder = openStore(dbPath);
  assert.equal(holder.lease.acquire('blocker', 60_000), true, '测试前置：持住租约');
  await assert.rejects(
    runDaemon({ dbPath, socketPath: join(dir, 'scheduler.sock'), log: () => {} }),
    (err: unknown) => err instanceof YieldToActiveSchedulerError,
    '租约被占 → YieldToActiveSchedulerError',
  );
  // 其他启动失败（缺 dbPath）→ 普通错误，不是让位
  await assert.rejects(
    runDaemon({}),
    (err: unknown) => !(err instanceof YieldToActiveSchedulerError),
    '缺 dbPath → 普通启动错误（非让位）',
  );
  console.log('✓ 库级：让位/非让位错误分类');

  /* ── 2. 进程级：租约被占 → exit 0（让位） ── */
  const codeYield = await onceExit(
    spawn(process.execPath, [CLI], {
      env: { ...process.env, APPILOT_DB_FILE: dbPath },
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
  assert.equal(codeYield, 0, `租约被占应 exit 0（实际 ${codeYield}）`);
  console.log('✓ 进程级：租约被占 → exit 0（让位）');

  /* ── 3. 进程级：DB 打不开 → exit 1（真实失败，非让位） ── */
  const badDbDir = join(dir, 'db-is-a-directory');
  mkdirSync(badDbDir, { recursive: true });
  const codeFail = await onceExit(
    spawn(process.execPath, [CLI], {
      env: { ...process.env, APPILOT_DB_FILE: badDbDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
  assert.equal(codeFail, 1, `DB 打不开应 exit 1（实际 ${codeFail}）`);
  console.log('✓ 进程级：DB 启动失败 → exit 1（真实失败）');

  holder.close();
  rmSync(dir, { recursive: true, force: true });
  console.log('启动退出码测试全部通过 ✓');
}

main().catch((err) => {
  console.error('启动退出码测试失败:', err);
  process.exit(1);
});
