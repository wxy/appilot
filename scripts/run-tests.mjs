#!/usr/bin/env node
/**
 * 根目录 tests/ 统一测试运行器（审计 2026-09-26 E1/E2）。
 *
 * 旧实现：根 package.json 的 test 脚本手工枚举 48 个 `tsx tests/xxx.test.ts`，
 * 而 tests/ 下实际有 54 个测试文件——新增测试忘记登记就永远不被 CI 执行
 * （已实际发生：scheduler-engine、data-sync-health 等 6 个孤儿测试）。
 *
 * 新实现：自动发现 tests/*.test.ts 顺序执行（与旧行为等价：逐文件、失败
 * 快照保留），结尾汇总通过/失败清单，任一失败退出码 1。新增测试文件零登记。
 *
 * 用法：node scripts/run-tests.mjs [pattern ...]
 *   pattern 为子串过滤（如 `node scripts/run-tests.mjs rank` 只跑文件名含
 *   rank 的用例），便于本地调试；CI 不传参跑全量。
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const testsDir = join(process.cwd(), 'tests');
const patterns = process.argv.slice(2);

const files = readdirSync(testsDir)
  .filter((f) => f.endsWith('.test.ts'))
  .filter((f) => patterns.length === 0 || patterns.some((p) => f.includes(p)))
  .sort();

if (files.length === 0) {
  console.error(`no test files matched in ${testsDir}${patterns.length ? ` (patterns: ${patterns.join(', ')})` : ''}`);
  process.exit(2);
}

const failed = [];
const startedAt = Date.now();
for (const file of files) {
  const t0 = Date.now();
  process.stdout.write(`▶ ${file} ... `);
  const res = spawnSync(process.execPath, [join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(testsDir, file)], {
    stdio: 'pipe',
    encoding: 'utf8',
  });
  const ms = Date.now() - t0;
  if (res.status === 0) {
    console.log(`ok (${ms}ms)`);
  } else {
    console.log(`FAILED (${ms}ms)`);
    failed.push(file);
    // 失败详情立即回放，便于定位（不吞 stdout/stderr）。
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
  }
}

const ms = Date.now() - startedAt;
console.log(`\n${files.length - failed.length}/${files.length} test files passed in ${(ms / 1000).toFixed(1)}s`);
if (failed.length > 0) {
  console.error(`FAILED (${failed.length}):`);
  for (const f of failed) console.error(`  - ${f}`);
  process.exit(1);
}
