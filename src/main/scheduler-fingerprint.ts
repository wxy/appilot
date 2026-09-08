/**
 * 调度器代码指纹（磁盘/运行）——纯逻辑，无 Electron 依赖，可单测。
 *
 * 背景：常驻调度 daemon（@appilot-labs/appilot-scheduler，独立进程）把代码
 * 加载进内存后不会随应用退出重启而自动重载；应用更新后磁盘代码变了，daemon
 * 可能仍在跑旧代码。这里计算「磁盘调度器 CLI 指纹」用于与「运行中 daemon 的
 * 启动指纹」比对：不一致 → UI 提示重启调度器。
 *
 * 口径：磁盘指纹 = resolveSchedulerCli() 指向的 CLI 入口文件（daemon 进程的
 * 启动入口，dist/cli.js）的内容 SHA-1。CLI 文件通常只有几 KB，status 每次实时
 * 计算代价可忽略。注：daemon 实际执行还依赖 headless/core 的 dist，CLI 入口
 * 是其可解析的代理；如需覆盖全包可在本模块扩展成目录指纹（见 self-update.ts
 * 的 fingerprintDirs 思路）。
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** 本壳拉起 daemon 时注入其 env 的键：值为该时刻的磁盘指纹（daemon 侧暂未
 *  读取，作为后续 daemon 自报启动指纹的预留通道）。 */
export const SCHEDULER_FINGERPRINT_ENV = "APPILOT_SCHEDULER_FINGERPRINT";

export type CliResolver = () => string | null;

/** 内容 SHA-1（40 位十六进制；UI 展示取前 7 位）。 */
export function sha1Hex(data: string | Buffer): string {
  return createHash("sha1").update(data).digest("hex");
}

/** 单文件内容哈希；文件缺失/瞬时不可读 → null（视为「指纹不可得」）。 */
export function fileContentFingerprint(file: string): string | null {
  try {
    return sha1Hex(readFileSync(file));
  } catch {
    return null;
  }
}

/** 解析 appilot-scheduler CLI 入口（require 包失败 → null）。 */
export function resolveSchedulerCliPath(): string | null {
  try {
    const pkg = require("@appilot-labs/appilot-scheduler") as {
      resolveSchedulerCli?: () => string | null;
    };
    return pkg?.resolveSchedulerCli?.() ?? null;
  } catch {
    return null;
  }
}

/**
 * 磁盘调度器 CLI 指纹：resolveSchedulerCli() 指向的入口文件内容哈希。
 * 解析失败 / 文件不可读 → null（unknown 场景）。resolveCli 可注入以便单测。
 */
export function diskSchedulerFingerprint(
  resolveCli: CliResolver | null = resolveSchedulerCliPath,
): string | null {
  const cli = resolveCli ? resolveCli() : null;
  if (!cli) return null;
  return fileContentFingerprint(cli);
}

// ────────────────────────────────────────────────────────────────────────────
// scheduler:status 的 schedulerManager 字段：模式 + 指纹比对判定（纯函数）。
// ────────────────────────────────────────────────────────────────────────────

export type SchedulerManagerMode = "daemon" | "inapp" | "stopped";

export interface SchedulerManagerStatus {
  /** 调度执行源：daemon（常驻）/ inapp（本应用）/ stopped（已停止或未运行）。 */
  mode: SchedulerManagerMode;
  /** 运行中 daemon 的启动指纹；仅当是本壳拉起且 pid 吻合时才已知，否则 null。 */
  runningFingerprint: string | null;
  /** 磁盘 CLI 入口指纹（每次 status 实时计算；不可得为 null）。 */
  diskFingerprint: string | null;
  /** 指纹无法比对：daemon 在跑但运行指纹未知（历史/非本壳拉起）或磁盘指纹不可得。 */
  unknown: boolean;
  /** 运行与磁盘指纹均已知且不一致 → 版本不一致，提示重启调度器。 */
  mismatch: boolean;
}

export interface SchedulerManagerFacts {
  /** daemon 在跑（leader === "scheduler" 且心跳新鲜）。 */
  daemonRunning: boolean;
  /** 本应用壳调度在跑（leader === "electron" 且用户未显式停止）。 */
  shellRunning: boolean;
  /** 用户显式停止（暂停任务中心语义）。 */
  userStopped: boolean;
  /** 运行中 daemon 指纹（本壳拉起且 pid 吻合才非 null）。 */
  runningFingerprint: string | null;
  diskFingerprint: string | null;
}

export function deriveSchedulerManager(
  facts: SchedulerManagerFacts,
): SchedulerManagerStatus {
  const stopped = facts.userStopped;
  const mode: SchedulerManagerMode = !stopped && facts.daemonRunning
    ? "daemon"
    : !stopped && facts.shellRunning
      ? "inapp"
      : "stopped";

  // 非 daemon 模式下没有「运行中 daemon 代码」可比对：不产生 mismatch/unknown。
  if (mode !== "daemon") {
    return {
      mode,
      runningFingerprint: null,
      diskFingerprint: facts.diskFingerprint,
      unknown: false,
      mismatch: false,
    };
  }

  const running = facts.runningFingerprint;
  const disk = facts.diskFingerprint;
  const bothKnown = running != null && disk != null;
  return {
    mode,
    runningFingerprint: running,
    diskFingerprint: disk,
    unknown: !bothKnown,
    mismatch: bothKnown && running !== disk,
  };
}
