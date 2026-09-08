/**
 * 调度 daemon 拉起/指纹跟踪（Electron 无关，可单测）。
 *
 * 与 packages/scheduler 的 ensureScheduler 同语义（见其 ensure.ts），但由本壳
 * 直接 spawn：
 * - spawn 时经 env（APPILOT_SCHEDULER_FINGERPRINT）把「当时磁盘指纹」注入 daemon
 *   进程（daemon 侧暂未读取，作为后续自报启动指纹的预留通道）；
 * - 壳内记录「最近一次由本壳拉起并确认存活」的 { pid, fingerprint }（内存变量，
 *   与 daemon pid 绑定）。进程重启后记录丢失——对更早启动的 daemon 指纹未知
 *   （unknown=true，UI 提示重启一次以纳入监测）。
 *
 * 边界说明：
 * - daemon 是否「本壳拉起」以 spawn 前 socket 不通为准（本函数先 ping/hello，
 *   已有 daemon 则直接复用、不覆盖记录）；
 * - daemon 自重启（其 self-update 发现磁盘代码变化）后 pid 改变：后续 status
 *   的 live hello 会发现 pid 不吻合 → 运行指纹归 unknown（重启一次重新纳入）。
 */
import { spawn } from "node:child_process";
import { SCHEDULER_FINGERPRINT_ENV } from "./scheduler-fingerprint";

export interface DaemonSpawnRecord {
  pid: number;
  /** spawn 时刻的磁盘指纹（daemon 启动时加载的代码）。 */
  fingerprint: string | null;
}

/** 本壳最近一次拉起并确认存活的 daemon（pid + 启动指纹）。 */
let spawnRecord: DaemonSpawnRecord | null = null;

export function getSpawnRecord(): DaemonSpawnRecord | null {
  return spawnRecord;
}

export function clearSpawnRecord(): void {
  spawnRecord = null;
}

/** @appilot-labs/appilot-scheduler 运行时 require（沿用主进程既有 lazy-require 风格）。 */
function schedulerPkg(): typeof import("@appilot-labs/appilot-scheduler") {
  return require("@appilot-labs/appilot-scheduler") as typeof import("@appilot-labs/appilot-scheduler");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** socket 存活探测（ping 成功即认为 daemon 在服务）。 */
export async function schedulerSocketUp(
  socketPath: string,
  timeoutMs = 1500,
): Promise<boolean> {
  try {
    const res = await schedulerPkg().sendSchedulerCommand(
      socketPath,
      "ping",
      {},
      timeoutMs,
    );
    return res.ok === true;
  } catch {
    return false;
  }
}

/**
 * 当前 daemon pid：hello ack 的 daemonPid；socket 不通/异常 → null。
 * （hello 每次会短暂注册一个客户端连接，成功后即销毁，无残留。）
 */
export async function currentDaemonPid(
  socketPath: string,
  timeoutMs = 1500,
): Promise<number | null> {
  try {
    const res = await schedulerPkg().sendSchedulerCommand(
      socketPath,
      "hello",
      { client: "appilot", pid: process.pid },
      timeoutMs,
    );
    if (!res.ok || !res.result) return null;
    const pid = Number((res.result as { daemonPid?: unknown })?.daemonPid);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** 等待 daemon 完全退出（shutdown 后 socket 移除）；期限内不可达 → true。 */
export async function waitSchedulerDown(
  socketPath: string,
  timeoutMs = 3000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await schedulerSocketUp(socketPath, 400))) return true;
    await sleep(150);
  }
  return !(await schedulerSocketUp(socketPath, 400));
}

export interface EnsureTrackedOptions {
  socketPath: string;
  /** 启动 daemon 的命令（argv）。缺省用 resolveSchedulerCli() 定位。 */
  spawnCommand?: string[];
  /** 拉起时刻的磁盘指纹：写入 daemon env + 本次 spawn 成功后记入壳记录。 */
  fingerprint: string | null;
  /** ping/hello 重试总时长（默认 8s）。 */
  timeoutMs?: number;
  log?(msg: string): void;
}

export interface EnsureTrackedResult {
  ok: boolean;
  /** 本次调用确实由本壳 spawn 了新 daemon 进程（区别于复用在跑的旧 daemon）。 */
  spawned: boolean;
  /** 当前 daemon pid（确认存活时）；socket 未起来/让位时 null。 */
  pid: number | null;
  error?: string;
}

/**
 * 确保调度 daemon 在跑（语义对齐 packages/scheduler 的 ensureScheduler）：
 * - socket 已通 → 复用（通知代码自检）；不覆盖 spawn 记录；
 * - 不通 → spawn detached（env 带指纹）→ 退避重试 hello；确认存活后把
 *   { pid, fingerprint } 写入 spawn 记录；
 * - spawn 的子进程 exit 0（单例仲裁让位：其他壳/daemon 持主）→ 视为成功。
 */
export async function ensureSchedulerTracked(
  opts: EnsureTrackedOptions,
): Promise<EnsureTrackedResult> {
  const log = opts.log ?? (() => {});
  const timeoutMs = opts.timeoutMs ?? 8000;

  // 1) 已有 daemon：直接复用。记录不覆盖——非本次 spawn；若 pid 与既有记录
  //    一致（同一次会话里我们拉起的那个）记录继续有效，否则运行指纹归 unknown。
  const existingPid = await currentDaemonPid(opts.socketPath, Math.min(timeoutMs, 1500));
  if (existingPid != null) {
    try {
      // 顺手通知 daemon 检查代码是否已更新（同 ensure.ts：变更会自重启）。
      schedulerPkg().notifyCheckUpdate(opts.socketPath);
    } catch {
      /* 通知失败无碍 */
    }
    log("scheduler already running");
    return { ok: true, spawned: false, pid: existingPid };
  }

  const spawnCommand = opts.spawnCommand;
  if (!spawnCommand || spawnCommand.length === 0) {
    log("appilot-scheduler cli 不可解析，跳过 ensure（回退壳内调度）");
    return { ok: false, spawned: false, pid: null, error: "cli 不可解析" };
  }

  // 2) spawn detached（不随父死；stdio 忽略；env 带指纹）。
  log(`spawning scheduler: ${spawnCommand.join(" ")}`);
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (opts.fingerprint != null) env[SCHEDULER_FINGERPRINT_ENV] = opts.fingerprint;
  const child = spawn(spawnCommand[0], spawnCommand.slice(1), {
    detached: true,
    stdio: "ignore",
    env,
  });
  child.unref();
  // daemon 快速 exit 0 = 单例仲裁让位（已有调度者——壳或其他 daemon 持主）：
  // 调度已在跑，ensure 视为成功。
  let gaveWay = false;
  child.on("exit", (code) => {
    if (code === 0) gaveWay = true;
  });

  // 3) 退避重试 hello（daemon 启动 + lease 仲裁；冲突输家退出后可能需重连）。
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(400);
    if (gaveWay) {
      // 让位：调度主在别处（通常本壳 electron 先抢到）——记录不写。
      return { ok: true, spawned: true, pid: null };
    }
    const pid = await currentDaemonPid(opts.socketPath, 1000);
    if (pid != null) {
      // 确认存活：写入「本壳拉起并确认存活」的 daemon 记录（pid 绑定）。
      spawnRecord = { pid, fingerprint: opts.fingerprint };
      try {
        schedulerPkg().notifyCheckUpdate(opts.socketPath);
      } catch {
        /* 通知失败无碍 */
      }
      log(`scheduler up (pid ${pid})`);
      return { ok: true, spawned: true, pid };
    }
  }
  log("scheduler did not come up within timeout");
  return { ok: false, spawned: true, pid: null, error: "scheduler did not come up within timeout" };
}
