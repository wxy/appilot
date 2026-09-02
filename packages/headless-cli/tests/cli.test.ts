/**
 * headless CLI 端到端测试：spawn bin 进程 + 隔离 DB（APPILOT_DB_FILE），
 * 覆盖 db / register / list / get / tasks list / run / remove 全链路。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import assert from 'node:assert';

const BIN = join(__dirname, '..', 'dist', 'cli.js');

function run(args: string[], dbPath: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      env: { ...process.env, APPILOT_DB_FILE: dbPath },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += String(d)));
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('exit', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

async function main(): Promise<void> {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'appilot-cli-test-')), 'appilot.db');
  const repo = dirname(dirname(__dirname)); // packages 上级 = 仓库根（真实 git 仓库）

  const db = await run(['db'], dbPath);
  assert.equal(db.code, 0, `db 应成功: ${db.stderr}`);
  assert.ok(JSON.parse(db.stdout).dbPath === dbPath, 'db 路径输出');
  console.log('✓ db');

  const reg = await run(['projects', 'register', repo, '--name', 'cli-test-proj'], dbPath);
  assert.equal(reg.code, 0, `register 应成功: ${reg.stderr}`);
  assert.ok(JSON.parse(reg.stdout).registered.name === 'cli-test-proj');
  console.log('✓ projects register');

  const lst = await run(['projects', 'list'], dbPath);
  assert.ok(JSON.parse(lst.stdout).projects.some((p: any) => p.name === 'cli-test-proj'));
  console.log('✓ projects list');

  const get = await run(['projects', 'get', 'cli-test-proj'], dbPath);
  assert.equal(JSON.parse(get.stdout).path, repo);
  console.log('✓ projects get');

  const tasks = await run(['tasks', 'list'], dbPath);
  const defs = JSON.parse(tasks.stdout).definitions;
  assert.ok(defs.some((d: any) => d.id === 'release-sync') && defs.some((d: any) => d.id === 'readiness'));
  console.log('✓ tasks list');

  // run readiness：DB 有真实 git 仓库 → 返回 summary 且任务状态落库
  const runRes = await run(['run', 'readiness'], dbPath);
  assert.equal(runRes.code, 0, `run readiness 应成功: ${runRes.stderr}`);
  const runJson = JSON.parse(runRes.stdout);
  assert.ok(runJson.lastStatus === 'ok' || runJson.lastStatus === 'error', 'run 落库状态');
  assert.ok(runJson.runCount >= 1);
  console.log(`✓ run readiness (status=${runJson.lastStatus})`);

  // run 未知任务 → 非零退出 + stderr
  const bad = await run(['run', 'nope'], dbPath);
  assert.notEqual(bad.code, 0);
  assert.ok(bad.stderr.includes('未知任务'));
  console.log('✓ run 未知任务报错');

  const rem = await run(['projects', 'remove', 'cli-test-proj'], dbPath);
  assert.equal(JSON.parse(rem.stdout).removed, true);
  const lst2 = await run(['projects', 'list'], dbPath);
  assert.ok(!JSON.parse(lst2.stdout).projects.some((p: any) => p.name === 'cli-test-proj'));
  console.log('✓ projects remove');

  console.log('CLI 端到端测试全部通过 ✓');
}

main().catch((err) => {
  console.error('CLI 测试失败:', err);
  process.exit(1);
});
