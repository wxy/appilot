#!/usr/bin/env node
// Exercise the built daemon and real SQLite lease through ensureScheduler.
// A live lease without a reachable socket must not report scheduler health.
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, statSync, mkdirSync, writeFileSync, existsSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { openStore } = require('@appilot-labs/appilot-headless');
const { ensureScheduler } = require('../packages/scheduler/dist/ensure.js');
const { createSchedulerServer } = require('../packages/scheduler/dist/server.js');
const { sendSchedulerCommand } = require('../packages/scheduler/dist/client.js');

async function main() {
  const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'appilot-pr312-e2e-'));
  const dbPath = join(dir, 'appilot.db');
  const socketPath = join(dir, 'scheduler.sock');
  const previousDbPath = process.env.APPILOT_DB_FILE;
  let holder;
  try {
    process.env.APPILOT_DB_FILE = dbPath;
    holder = openStore(dbPath);
    assert.equal(holder.lease.acquire('review-holder', 60_000), true);
    const logs = [];
    const available = await ensureScheduler({
      socketPath,
      spawnCommand: [process.execPath, join(__dirname, '../packages/scheduler/dist/cli.js')],
      timeoutMs: 2_000,
      log: (line) => logs.push(line),
    });
    console.log(JSON.stringify({ available, socketPath, logs }, null, 2));
    assert.equal(available, false, 'a live lease without a reachable socket is unavailable');

    const spawnFailure = await ensureScheduler({
      socketPath,
      spawnCommand: [join(dir, 'missing-executable')],
      timeoutMs: 2_000,
    });
    console.log(JSON.stringify({ spawnFailure }, null, 2));
    assert.equal(spawnFailure, false, 'spawn ENOENT must report unavailable without crashing');

    if (process.platform !== 'win32') {
      const previousUmask = process.umask(0o000);
      const server = createSchedulerServer(socketPath, {
        onHello: () => ({ protocolVersion: 1, daemonPid: process.pid }),
        onRunNow: async () => ({}),
        log: () => {},
      });
      try {
        await server.start();
        const mode = statSync(socketPath).mode & 0o777;
        const reachable = (await sendSchedulerCommand(socketPath, 'ping', {}, 1500)).ok;
        const healthy = await ensureScheduler({
          socketPath,
          spawnCommand: [join(dir, 'missing-executable')],
          timeoutMs: 2_000,
        });
        console.log(JSON.stringify({ mode: mode.toString(8), reachable, healthy }, null, 2));
        assert.equal(mode, 0o600, 'socket must be owner-only even with umask 000');
        assert.equal(reachable, true, 'owner can still ping the socket');
        assert.equal(healthy, true, 'reachable socket must report scheduler available');
      } finally {
        await server.close();
        process.umask(previousUmask);
      }

      // Inject an OS chmod failure into a real daemon process. The control
      // socket must never remain available when owner-only mode cannot be set.
      const faultDir = join(dir, 'chmod-failure');
      mkdirSync(faultDir);
      const preload = join(faultDir, 'fail-chmod.cjs');
      writeFileSync(preload, "require('node:fs').chmodSync = () => { throw new Error('injected chmod failure'); };\n");
      const failed = spawnSync(process.execPath, [join(__dirname, '../packages/scheduler/dist/cli.js')], {
        env: {
          ...process.env,
          APPILOT_DB_FILE: join(faultDir, 'appilot.db'),
          NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${preload}`].filter(Boolean).join(' '),
        },
        encoding: 'utf8',
        timeout: 10_000,
      });
      const faultSocketExists = existsSync(join(faultDir, 'scheduler.sock'));
      console.log(JSON.stringify({ chmodFailureExitCode: failed.status, faultSocketExists, stderr: failed.stderr.trim() }, null, 2));
      assert.equal(failed.status, 1, 'chmod failure must fail daemon startup');
      assert.equal(faultSocketExists, false, 'socket must close on chmod failure');
    }
  } finally {
    holder?.close();
    if (previousDbPath === undefined) delete process.env.APPILOT_DB_FILE;
    else process.env.APPILOT_DB_FILE = previousDbPath;
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
