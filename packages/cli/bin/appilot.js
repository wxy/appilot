#!/usr/bin/env node
/**
 * appilot — Appilot CLI 启动器。
 *
 * 转发 `dsh --profile appilot`（定制 Harness 发行版，见 profiles/appilot）。
 * 面向不熟悉 Harness 的用户：一条命令获得以 Appilot 为主场的应用运营 Agent。
 *
 * 用法：
 *   appilot                # 启动默认 profile（web 表层）
 *   appilot --port 3099    # 换端口（透传 dsh 启动器 flag）
 *   appilot --help         # 查看 dsh 启动器帮助
 *   appilot "task..."      # 传给 headless 等 profile 的任务文本
 *
 * 环境变量：
 *   APILOT_DSH       指定 dsh 可执行文件路径（默认在 PATH 查找）。
 *   APILOT_PROFILE   指定要启动的 profile 名（默认 appilot）。
 */
'use strict';
const { spawn } = require('node:child_process');
const { statSync } = require('node:fs');

function findDsh() {
  if (process.env.APILOT_DSH) return process.env.APILOT_DSH;
  const pathDirs = (process.env.PATH || '').split(':');
  for (const dir of pathDirs) {
    if (!dir) continue;
    const candidate = `${dir}/dsh`;
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // try next
    }
  }
  return 'dsh'; // 让系统解析（报错时输出 dsh 的原始错误）
}

const profile = process.env.APILOT_PROFILE || 'appilot';
const dsh = findDsh();
const args = ['--profile', profile, ...process.argv.slice(2)];

const child = spawn(dsh, args, { stdio: 'inherit' });
child.on('error', (err) => {
  console.error(
    `appilot: 无法启动 dsh（${err.message}）。请确认已安装 dsh，或用 APILOT_DSH 指定路径。`,
  );
  process.exit(1);
});
child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
