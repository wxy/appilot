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
  const opts: DaemonOptions = {
    dbPath: process.env.APPILOT_DB_FILE || defaultDbPath(),
  };
  let handle: Awaited<ReturnType<typeof runDaemon>> | null = null;
  try {
    handle = await runDaemon(opts);
  } catch (err: any) {
    // 单例仲裁退出：已有调度者（本仓库 dev 时 Electron/DSH 壳内调度可能持主）→ 安静退出。
    console.log(`[appilot-scheduler] ${err?.message || String(err)}`);
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
