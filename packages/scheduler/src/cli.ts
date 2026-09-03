#!/usr/bin/env node
/**
 * appilot-scheduler 守护进程入口。
 * - 默认：DB 用 APPILOT_DB_FILE 或 headless 默认路径；socket 与 DB 同目录。
 * - install / uninstall：注册/移除 launchd LaunchAgent（macOS 常驻保活）。
 * - 退出：SIGTERM/SIGINT 优雅退出（升级/关机让位）；单例冲突安静退出(exit 0)。
 */
import { runDaemon, type DaemonOptions } from './daemon.js';
import { defaultDbPath } from '@appilot-labs/appilot-headless';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { connect } from 'node:net';
import { createInterface } from 'node:readline';

function launchAgentPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', 'com.appilot.scheduler.plist');
}

function installLaunchAgent(): void {
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
  const nodeBin = process.execPath;
  const cli = join(__dirname, 'cli.js');
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.appilot.scheduler</string>
  <key>ProgramArguments</key>
  <array><string>${nodeBin}</string><string>${cli}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>EnvironmentVariables</key>
  <dict><key>APPILOT_DB_FILE</key><string>${process.env.APPILOT_DB_FILE || ''}</string></dict>
</dict>
</plist>`;
  const { writeFileSync, mkdirSync } = require('node:fs') as typeof import('node:fs');
  mkdirSync(dirname(launchAgentPath()), { recursive: true });
  writeFileSync(launchAgentPath(), plist);
  execFileSync('launchctl', ['load', launchAgentPath()], { stdio: 'inherit' });
  console.log(`launchd LaunchAgent installed: ${launchAgentPath()}`);
}

function uninstallLaunchAgent(): void {
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
  const { rmSync } = require('node:fs') as typeof import('node:fs');
  try {
    execFileSync('launchctl', ['unload', launchAgentPath()], { stdio: 'ignore' });
  } catch {
    /* 未加载 */
  }
  rmSync(launchAgentPath(), { force: true });
  console.log('launchd LaunchAgent removed');
}

import { sendSchedulerCommand } from './client.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === 'install') {
    installLaunchAgent();
    return;
  }
  if (args[0] === 'uninstall') {
    uninstallLaunchAgent();
    return;
  }
  const dbPath = process.env.APPILOT_DB_FILE || defaultDbPath();
  const socketPath = join(dirname(dbPath), 'scheduler.sock');
  if (args[0] === 'status') {
    const res = await sendSchedulerCommand(socketPath, 'hello', { client: 'cli', pid: process.pid });
    if (res.ok && res.result) {
      console.log(JSON.stringify({ running: true, schedulerDaemon: true, ...(res.result as object) }, null, 2));
      return;
    }
    // daemon 未跑；查共享 DB 租约看是否有壳（dsh/electron）在调度。
    let leader: string | null = null;
    let heartbeatAt: string | null = null;
    try {
      const { openStore } = require('@appilot-labs/appilot-headless') as typeof import('@appilot-labs/appilot-headless');
      const s = openStore(dbPath);
      const info = s.lease.info();
      leader = info?.leaderId ?? null;
      heartbeatAt = info?.heartbeatAt ?? null;
      s.close();
    } catch {
      /* DB 不可读则保持 null */
    }
    const scheduled = leader !== null;
    console.log(
      JSON.stringify(
        {
          running: scheduled,
          schedulerDaemon: false,
          leader,
          heartbeatAt,
          note: scheduled
            ? `调度者 = 壳进程「${leader}」（daemon 让位）——daemon 未在跑但调度在执行`
            : '无调度者（未运行任何壳或 daemon）',
          error: scheduled ? undefined : res.error,
        },
        null,
        2,
      ),
    );
    if (!scheduled) process.exitCode = 1;
    return;
  }
  if (args[0] === 'stop') {
    const res = await sendSchedulerCommand(socketPath, 'shutdown', {});
    console.log(JSON.stringify({ stopped: Boolean(res?.ok), ...(res ?? {}) }, null, 2));
    return;
  }
  if (args[0] === 'accel') {
    const mode = args[1];
    if (mode === 'on' || mode === undefined) {
      const seconds = Number(args[2] ?? 0) || 300;
      const res = await sendSchedulerCommand(socketPath, 'accelerate', { on: true, seconds });
      console.log(JSON.stringify({ accel: true, seconds, ok: Boolean(res?.ok) }, null, 2));
    } else if (mode === 'off') {
      const res = await sendSchedulerCommand(socketPath, 'accelerate', { on: false });
      console.log(JSON.stringify({ accel: false, ok: Boolean(res?.ok) }, null, 2));
    } else {
      console.error('用法: appilot-scheduler accel [on [seconds]|off]');
      process.exit(2);
    }
    return;
  }
  const opts: DaemonOptions = { dbPath };
  let handle: Awaited<ReturnType<typeof runDaemon>> | null = null;
  try {
    handle = await runDaemon(opts);
  } catch (err: any) {
    // 单例仲裁退出：已有调度者（另一 daemon / Electron / DSH 壳内调度）。若持主者
    // 刚退出，租约 TTL（默认 60s）未过也会拒绝——提示等 TTL 或查 status。
    console.log(`[appilot-scheduler] ${err?.message || String(err)}`);
    console.log(`[appilot-scheduler] 提示：若刚停止其他调度者（Electron/DSH），租约 TTL（60s）内会拒绝新主——稍候重试，或用 status 查看当前调度者。`);
    process.exit(0);
  }
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      void (handle?.stop() ?? Promise.resolve()).then(() => process.exit(0));
    });
  }
}

main().catch((err: any) => {
  console.error(`[appilot-scheduler] fatal: ${err?.message || String(err)}`);
  process.exit(1);
});
