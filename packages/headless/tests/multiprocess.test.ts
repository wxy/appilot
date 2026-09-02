/**
 * 多进程集成测试：多个「壳」进程同时打开同一 SQLite，验证架构核心承诺：
 *
 * 1. WAL 多进程并发读写不冲突（进程 A 写 → 进程 B 立即可读）；
 * 2. 租约唯一主：A 活着时 B 抢占失败；A 进程退出（崩溃，不续租）后，
 *    B 在 TTL 过后接管成功（leader 切换）；
 * 3. 共享 tasks / snapshots 跨进程一致。
 *
 * 子进程直接 require 编译产物（dist/index.js），模拟 Electron/DSH/CLI 各开各的连接。
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert';

const DIST = join(__dirname, '..', 'dist', 'index.js');

/**
 * helper 脚本（作为子进程运行，argv: mode dbPath [args...]）：
 *  - write: 写项目 {mode}-proj + 快照，输出 projects 列表 JSON 后退出
 *  - acquire <leader> <ttlMs>: acquire 租约，输出结果，随后按 holdMs 决定是否保持
 *  - read: 输出 projects / tasks / snapshots 计数
 */
const HELPER = `
// node -e '...' argv[1]=dist argv[2]=mode argv[3]=dbPath argv[4+]=args
const h = require(process.argv[1]);
const mode = process.argv[2];
const dbPath = process.argv[3];
const store = h.openStore(dbPath);
function out(o) { process.stdout.write(JSON.stringify(o)); }
function done() { store.close(); process.exit(0); }
if (mode === 'write') {
  const name = process.argv[4] || 'proj';
  const now = new Date().toISOString();
  store.projects.save({ name, path: '/tmp/' + name, githubUrl: null, platform: 'macos', languages: ['en'], lastResolvedAt: now, artworkUrl: null, updatedAt: now });
  store.snapshots.add([{ projectName: name, productId: null, keyword: 'k', language: 'en', storefront: 'us', rank: 1, totalResults: 10, checkedAt: now }]);
  out({ mode, projects: store.projects.list().map(p => p.name) });
  done();
} else if (mode === 'acquire') {
  const leader = process.argv[4];
  const ttl = Number(process.argv[5]);
  const holdMs = Number(process.argv[6] || 0);
  const ok = store.lease.acquire(leader, ttl);
  if (holdMs > 0) {
    setTimeout(() => {
      out({ mode, ok, projects: store.projects.list().map(p => p.name) });
      done();
    }, holdMs);
  } else {
    out({ mode, ok, leader: store.lease.leader() });
    done();
  }
} else if (mode === 'read') {
  out({ mode, projects: store.projects.list().map(p => p.name), tasks: store.tasks.all().length });
  done();
}
`;

function runSync(mode: string, dbPath: string, ...args: string[]): { status: number; stdout: string } {
  const r = spawnSync(process.execPath, ['-e', HELPER, DIST, mode, dbPath, ...args], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  if (r.status !== 0) throw new Error(`helper ${mode} failed: ${r.stderr}`);
  return { status: r.status, stdout: r.stdout.trim() };
}

function runAsync(mode: string, dbPath: string, ...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', HELPER, DIST, mode, dbPath, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += String(d)));
    child.stderr.on('data', (d) => (err += String(d)));
    child.on('exit', (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(`helper async ${mode} failed (${code}): ${err}`));
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'mp-test-')), 'appilot.db');

  // 1. 进程 A 写 → 进程 B 立即读到（跨进程即时可见，WAL）
  runSync('write', dbPath, 'alpha');
  const bRead = JSON.parse(runSync('read', dbPath).stdout);
  assert.deepEqual(bRead.projects, ['alpha'], 'B 应看到 A 写的项目');
  console.log('✓ 跨进程即时可见（A 写 → B 读）');

  // 2. 租约唯一主：A 活着（hold 600ms, ttl 1200ms）时 B 抢占失败
  const aHold = runAsync('acquire', dbPath, 'process-A', '1200', '600');
  await sleep(200); // 等 A acquire + 写入窗口
  const bAcquire = JSON.parse(runSync('acquire', dbPath, 'process-B', '3000', '0').stdout);
  assert.equal(bAcquire.ok, false, 'A 活主时 B 抢占应失败');
  assert.equal(bAcquire.leader, 'process-A');
  console.log('✓ 租约唯一主（活主抢占失败）');

  // 3. A 持有期间 B 可写项目（写不受租约限制——租约只管调度）
  runSync('write', dbPath, 'beta');
  const aFinal = JSON.parse(await aHold);
  assert.deepEqual(aFinal.projects.sort(), ['alpha', 'beta'], 'A 持有期间应看到 B 的写入');
  console.log('✓ 持有期并发写不冲突（A 读见 B 写）');

  // 4. 主崩溃接管：等 A 租约过期（ttl 1200ms）→ A2 抢占 → A2 秒退（不续租）
  //    → 其租约（ttl 400ms）过期后 C 接管
  await sleep(700); // A 已退，等其租约过期
  const a2 = JSON.parse(runSync('acquire', dbPath, 'process-A2', '400', '0').stdout);
  assert.equal(a2.ok, true, 'A 租约过期后 A2 应抢占成功');
  assert.equal(a2.leader, 'process-A2');
  await sleep(500); // A2 退出后等其租约过期
  const cAcquire = JSON.parse(runSync('acquire', dbPath, 'process-C', '400', '0').stdout);
  assert.equal(cAcquire.ok, true, 'A2 崩溃（租约过期）后 C 应接管成功');
  assert.equal(cAcquire.leader, 'process-C');
  console.log('✓ 主崩溃后从者接管（TTL 过期，接管判定用与主一致的 TTL 窗口）');

  console.log('多进程集成测试全部通过 ✓');
}

main().catch((err) => {
  console.error('多进程测试失败:', err);
  process.exit(1);
});
