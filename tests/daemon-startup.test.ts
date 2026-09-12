import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureSchedulerTracked } from '../src/main/daemon-manager';

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'appilot-startup-'));
  try {
    const db = new DatabaseSync(join(dir, 'appilot.db'));
    db.exec("CREATE TABLE lease (id INTEGER, leaderId TEXT, heartbeatAt TEXT)");
    db.prepare("INSERT INTO lease VALUES (1, ?, ?)").run('synthetic-leader', new Date().toISOString());
    db.close();
    const logs: string[] = [];
    const base = { socketPath: join(dir, 'missing.sock'), fingerprint: null, timeoutMs: 500, log: (s: string) => logs.push(s) };
    const missing = await ensureSchedulerTracked({ ...base, spawnCommand: [join(dir, 'no-executable')] });
    assert.equal(missing.ok, false);
    assert.match(missing.error!, /spawn error/);
    assert(logs.some(s => s.includes('synthetic-leader') && s.includes('ageMs')));

    const exit = await ensureSchedulerTracked({ ...base, spawnCommand: [process.execPath, '-e', 'process.exit(0)'] });
    assert.equal(exit.ok, false, 'exit 0 without a socket is not success');
    assert.match(exit.error!, /exit code=0/);

    const slow = { ...base, spawnCommand: [process.execPath, '-e', 'setTimeout(()=>{}, 2500)'] };
    const before = logs.filter(s => s.startsWith('spawning scheduler:')).length;
    const a = ensureSchedulerTracked(slow);
    const b = ensureSchedulerTracked(slow);
    assert.equal(a, b, 'concurrent callers share the same attempt');
    assert.equal((await a).ok, false);
    assert.equal((await ensureSchedulerTracked(slow)).spawned, false, 'live timed-out child is not duplicated');
    assert.equal(logs.filter(s => s.startsWith('spawning scheduler:')).length, before + 1);
    await new Promise(r => setTimeout(r, 2600));

    const fixture = join(dir, 'report.cjs');
    writeFileSync(fixture, `require('node:fs').writeSync(3, JSON.stringify({ok:false,error:'synthetic startup failure'})+'\\n'); require('node:fs').closeSync(3); process.exit(2);`);
    const failed = await ensureSchedulerTracked({ ...base, spawnCommand: [process.execPath, fixture] });
    assert.equal(failed.ok, false);
    assert.match(failed.error!, /exit code=2/);
    assert(logs.some(s => s.includes('synthetic startup failure')));
    const reporter = join(dir, 'reporter.ts');
    writeFileSync(reporter, `import { reportStartup } from ${JSON.stringify(join(process.cwd(), 'packages/scheduler/src/startup-report.ts'))}; reportStartup({ok:false,pid:process.pid,error:'test reason'}); if(process.env.APPILOT_STARTUP_REPORT_FD) process.exit(7); reportStartup({ok:true,pid:process.pid});`);
    const reported = spawnSync(process.execPath, [...process.execArgv, reporter], {
      env: { ...process.env, APPILOT_STARTUP_REPORT_FD: '3' },
      stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
    });
    assert.equal(reported.status, 0, reported.stderr?.toString());
    assert.equal(JSON.parse(reported.output[3]!.toString()).error, 'test reason');
    const disconnected = spawnSync(process.execPath, [...process.execArgv, reporter], {
      env: { ...process.env, APPILOT_STARTUP_REPORT_FD: '3' },
    });
    assert.equal(disconnected.status, 0, 'missing diagnostic pipe must not crash daemon');
    console.log('daemon startup: spawn error, exit 0, concurrency, live timeout and startup report passed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
void main().catch(err => { console.error(err); process.exitCode = 1; });
