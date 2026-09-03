/**
 * 调度守护进程自更新机制（2026-09-04 事故教训 A 落成）：
 *
 * 问题：daemon 常驻进程把依赖 dist 加载进内存；部署了新代码（覆盖磁盘文件）
 * 但进程不重启 → 执行器仍是旧逻辑（曾导致 rank 大规模「参数不完整」误判）。
 *
 * 方案：daemon 以启动时磁盘代码快照为基线，周期性（或壳启动时经 socket 通知）
 * 对比当前磁盘文件内容哈希；发现变化 → 优雅自重启（释放租约 → spawn 同命令
 * 新进程 → 退出），新进程加载的就是新代码。部署修复后最多一个检查周期即生效，
 * 无需人工重启 daemon。
 *
 * 被监控代码 = 本包 dist + @appilot-labs/appilot-headless dist
 *             + @appilot-labs/appilot-core dist（静态 import 入口在启动时装载）。
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';

export type CodeFingerprint = Record<string, string>;

export interface RestartSpec {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

/** 单文件内容哈希（sha256 前 16 位十六进制；文件极小，代价可忽略）。 */
export function hashOfFile(file: string): string | null {
  try {
    const content = readFileSync(file);
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  } catch {
    return null; // 文件瞬时不可读/被删 → 视为“未知”，后续变更仍会触发（null 处理见 isChanged）
  }
}

/** 采集一组目录下全部 .js 的指纹：绝对路径 → 内容哈希。 */
export function fingerprintDirs(dirs: string[]): CodeFingerprint {
  const fp: CodeFingerprint = {};
  for (const dir of dirs) {
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.js'));
    } catch {
      continue; // 目录不存在 → 跳过（该项不受监控）
    }
    for (const f of files) {
      const file = join(dir, f);
      if (!statSync(file).isFile()) continue;
      fp[file] = hashOfFile(file) ?? '';
    }
  }
  return fp;
}

/**
 * 判定代码是否变化：基线不含或哈希不同的监控文件 = 有更新。
 * 新出现的文件也算更新（部署新增模块）。消失的文件忽略（删除不算重启理由）。
 */
export function isChanged(baseline: CodeFingerprint, current: CodeFingerprint): boolean {
  return Object.keys(current).some((f) => baseline[f] !== current[f]);
}

/** 监控的包目录解析失败时返回 null（调用方应禁用自检并记日志）。 */
export function resolveCodeDirs(fromDir: string): string[] | null {
  const dirs = new Set<string>();
  try {
    // 1) 本包 dist（self-update 同目录）
    dirs.add(fromDir);
    // 2) headless 包 dist（main 指向 dist/index.js → dirname 即 dist）
    const { createRequire } = require('node:module') as typeof import('node:module');
    const req = createRequire(join(fromDir, 'noop.js'));
    const headlessMain = req.resolve('@appilot-labs/appilot-headless');
    dirs.add(dirname(headlessMain));
    // 3) core 包 dist（经导出子路径 project-sync 定位后取其目录）
    try {
      const coreEntry = req.resolve('@appilot-labs/appilot-core/project-sync');
      dirs.add(dirname(coreEntry));
    } catch {
      /* core 非本 daemon 运行依赖时跳过 */
    }
    return [...dirs];
  } catch {
    return null;
  }
}

/** 把 env 形式的监控目录字符串（分隔符 , ; ）解析为绝对目录列表。 */
export function parseMonitorDirsEnv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => (isAbsolute(p) ? p : join(process.cwd(), p)));
}

/** 自重启防抖：两次重启最小间隔（部署持续写入时避免重启风暴）。 */
export const RESTART_COOLDOWN_MS = 30_000;

/** 构建重启子进程的命令（与当前进程同命令同 env——新进程即最新代码）。 */
export function restartSpec(): RestartSpec {
  return {
    command: process.execPath,
    args: process.argv.slice(1),
    env: process.env,
  };
}

/**
 * 执行自重启：spawn 新进程 → 返回其句柄（由调用方负责：让位租约、清理、退出）。
 * 提供 spawnImpl 以便库级测试注入（默认 spawn detached 并 unref）。
 */
export function spawnRestartProcess(
  spec: RestartSpec,
  log: (m: string) => void,
  spawnImpl: (spec: RestartSpec) => unknown = (s) => {
    const child = spawn(s.command, s.args, {
      detached: true,
      stdio: 'inherit',
      env: s.env,
    });
    child.unref();
    return child;
  },
): void {
  log(`spawning self-restart: ${spec.command} ${spec.args.join(' ')}`);
  try {
    spawnImpl(spec);
  } catch (err: any) {
    log(`self-restart spawn 失败（继续以当前代码运行）: ${err?.message || String(err)}`);
    throw err;
  }
}

/** 目录存在性兜底：确保给定目录列表非空且至少有可扫描项（避免空指纹永不变化）。 */
export function hasFiles(fingerprint: CodeFingerprint): boolean {
  return Object.keys(fingerprint).length > 0;
}
