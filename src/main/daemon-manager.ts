/**
 * 调度 daemon 拉起/指纹跟踪/自状态读取/watchdog（Electron 无关，可单测）。
 *
 * 与 packages/scheduler 的 ensureScheduler 同语义（见其 ensure.ts），但由本壳
 * 直接 spawn：
 * - spawn 时经 env（APPILOT_SCHEDULER_FINGERPRINT）把「当时磁盘指纹」注入 daemon
 *   进程（daemon 侧已读取并在 socket status 中自报，壳优先用 daemon 上报指纹，
 *   未知时才退回 spawn 记录比对）；
 * - 壳内记录「最近一次由本壳拉起并确认存活」的 { pid, fingerprint }（内存变量，
 *   与 daemon pid 绑定）。进程重启后记录丢失——对更早启动的 daemon 指纹未知
 *   （unknown=true，UI 提示重启一次以纳入监测）。
 *
 * 架构收敛（壳不再作为调度执行体）：本模块负责壳侧的
 * - ensure（含失败状态记录 → UI「调度器异常」，不做壳内兜底执行）；
 * - 周期 watchdog 重试拉起（daemon 崩溃/启动失败后自动恢复；用户暂停时停）；
 * - 读取 daemon 自维护状态（socket status：startedAt/uptime/processed 等）。
 *
 * 边界说明：
 * - daemon 是否「本壳拉起」以 spawn 前 socket 不通为准（本函数先 ping/hello，
 *   已有 daemon 则直接复用、不覆盖记录）；
 * - daemon 自重启（其 self-update 发现磁盘代码变化）后 pid 改变：后续 status
 *   的 live hello 会发现 pid 不吻合 → 运行指纹归 unknown（重启一次重新纳入）。
 */
import { spawn } from "node:child_process";
import {
  SCHEDULER_FINGERPRINT_ENV,
  diskSchedulerFingerprint,
} from "./scheduler-fingerprint";

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

/** @appilot-labs/appilot-headless 运行时 require（defaultDbPath）。 */
function headlessPkg(): typeof import("@appilot-labs/appilot-headless") {
  return require("@appilot-labs/appilot-headless") as typeof import("@appilot-labs/appilot-headless");
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

// ────────────────────────────────────────────────────────────────────────────
// ensure 结果状态（架构收敛 A2/C：UI「调度器异常/未运行」的数据源）
// ────────────────────────────────────────────────────────────────────────────

export type DaemonEnsureStatus = "unknown" | "ok" | "error" | "stopped";

export interface DaemonEnsureState {
  /** 最近一次 ensure 的结论。 */
  status: DaemonEnsureStatus;
  /** 拉起失败原因（status=error 时有值）。 */
  error: string | null;
  /** 最近一次 ensure 尝试时刻（ISO；status=stopped 时清空）。 */
  lastAttemptAt: string | null;
}

let ensureState: DaemonEnsureState = {
  status: "unknown",
  error: null,
  lastAttemptAt: null,
};

export function getDaemonEnsureState(): DaemonEnsureState {
  return { ...ensureState };
}

// ────────────────────────────────────────────────────────────────────────────
// 调度器统一状态派生（架构收敛 C）：mode 仅 运行中(daemon) / 已停止 / 异常 /
// 启动中。「壳内/本应用」模式已删除。纯函数（无 electron 依赖，可单测）。
// ────────────────────────────────────────────────────────────────────────────

export type SchedulerEngineMode =
  /** 常驻 daemon 在服务并调度。 */
  | "daemon"
  /** 用户显式暂停（daemonStop）。 */
  | "stopped"
  /** 未运行且最近一次拉起失败（watchdog 继续重试）。 */
  | "error"
  /** 未运行、尚无失败结论（冷启动首次 ensure 进行中/未知）。 */
  | "starting";

export interface SchedulerEngineState {
  mode: SchedulerEngineMode;
  /** mode=error 时的失败原因。 */
  error: string | null;
  /** 最近一次 ensure 尝试时刻（ISO）。 */
  lastAttemptAt: string | null;
}

export function deriveSchedulerEngine(facts: {
  userStopped: boolean;
  daemonRunning: boolean;
  ensureStatus: DaemonEnsureStatus;
  ensureError: string | null;
  ensureLastAttemptAt: string | null;
}): SchedulerEngineState {
  const { userStopped, daemonRunning, ensureStatus, ensureError, ensureLastAttemptAt } = facts;
  if (userStopped) return { mode: "stopped", error: null, lastAttemptAt: null };
  if (daemonRunning) return { mode: "daemon", error: null, lastAttemptAt: ensureLastAttemptAt };
  if (ensureStatus === "error") {
    return { mode: "error", error: ensureError, lastAttemptAt: ensureLastAttemptAt };
  }
  return { mode: "starting", error: null, lastAttemptAt: ensureLastAttemptAt };
}

/** 用户显式「暂停」：停止 watchdog 重试并把状态置为已停止（不再显示异常）。 */
export function markDaemonStopped(): void {
  ensureState = { status: "stopped", error: null, lastAttemptAt: null };
  clearSpawnRecord();
}

/** 用户显式「启动」/壳冷启动：允许 watchdog 与 ensure 再次尝试。 */
export function markDaemonResumed(): void {
  if (ensureState.status === "stopped") {
    ensureState = { status: "unknown", error: null, lastAttemptAt: null };
  }
}

function recordEnsureResult(ok: boolean, error: string | null): void {
  ensureState = {
    status: ok ? "ok" : "error",
    error: ok ? null : error,
    lastAttemptAt: new Date().toISOString(),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// spawn 配置解析（socket 路径 + daemon 命令 + 磁盘指纹）——index/handlers 共用
// ────────────────────────────────────────────────────────────────────────────

export interface DaemonSpawnConfig {
  socketPath: string;
  /** 启动 daemon 的命令（argv）；CLI 不可解析时为 undefined。 */
  spawnCommand?: string[];
  /** 拉起时刻磁盘指纹（写 daemon env + spawn 记录）。 */
  fingerprint: string | null;
}

export function resolveDaemonSpawnConfig(): DaemonSpawnConfig {
  const cli = schedulerPkg().resolveSchedulerCli();
  const socketPath = schedulerPkg().defaultSocketPath(
    process.env.APPILOT_DB_FILE || headlessPkg().defaultDbPath(),
  );
  const fingerprint = diskSchedulerFingerprint(cli ? () => cli : null);
  return {
    socketPath,
    spawnCommand: cli ? [process.execPath, cli] : undefined,
    fingerprint,
  };
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
    log("appilot-scheduler cli 不可解析，跳过 ensure（调度器不可用，稍后周期重试）");
    return { ok: false, spawned: false, pid: null, error: "cli 不可解析" };
  }

  // 2) spawn detached（不随父死；stdio 忽略；env 带指纹）。
  log(`spawning scheduler: ${spawnCommand.join(" ")}`);
  const env: NodeJS.ProcessEnv = { ...process.env };
  // 用 Electron 可执行文件跑 node 脚本时必须标记为 node 模式，否则 daemon 会
  // 作为一个 Electron 应用启动（Dock/任务栏出现图标）。
  env.ELECTRON_RUN_AS_NODE = "1";
  if (opts.fingerprint != null) env[SCHEDULER_FINGERPRINT_ENV] = opts.fingerprint;
  const child = spawn(spawnCommand[0], spawnCommand.slice(1), {
    detached: true,
    stdio: "ignore",
    env,
  });
  child.unref();
  // daemon 快速 exit 0 = 单例仲裁让位（已有调度者——其他壳或 daemon 持主）：
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
      // exit 0 通常表示向现有 daemon 让位，但租约也可能只是崩溃进程留下的
      // 新鲜残影。必须以 socket 可达为准，不能把“无 daemon”误报为成功。
      const winnerPid = await currentDaemonPid(opts.socketPath, 1000);
      if (winnerPid != null) {
        return { ok: true, spawned: true, pid: winnerPid };
      }
      return {
        ok: false,
        spawned: true,
        pid: null,
        error: "daemon 让位后未发现可连接的调度主",
      };
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

/**
 * 壳统一 ensure 入口（index 冷启动 / scheduler:daemonStart / watchdog 共用）：
 * 解析 spawn 配置 → ensureSchedulerTracked → 记录 ensure 结果（UI 状态源）。
 * 壳绝不在此做任何调度执行兜底。
 */
export async function ensureSchedulerDaemon(opts?: {
  socketPath?: string;
  spawnCommand?: string[];
  fingerprint?: string | null;
  timeoutMs?: number;
  log?(msg: string): void;
}): Promise<EnsureTrackedResult> {
  const cfg = resolveDaemonSpawnConfig();
  const res = await ensureSchedulerTracked({
    socketPath: opts?.socketPath ?? cfg.socketPath,
    spawnCommand: opts?.spawnCommand ?? cfg.spawnCommand,
    fingerprint: opts?.fingerprint !== undefined ? opts.fingerprint : cfg.fingerprint,
    timeoutMs: opts?.timeoutMs ?? 5000,
    log: opts?.log ?? ((m) => console.log(`[appilot] ${m}`)),
  });
  recordEnsureResult(res.ok === true, res.ok ? null : res.error ?? "daemon 未能在超时内拉起");
  return res;
}

// ────────────────────────────────────────────────────────────────────────────
// daemon 自维护状态读取（socket status；架构收敛 B/C）
// ────────────────────────────────────────────────────────────────────────────

/** daemon 自状态（对应 packages/scheduler DaemonSelfStatus）。旧 daemon 未实现
 *  status → null（graceful：UI 不显示自状态，其余状态照常）。 */
export interface DaemonSelfState {
  daemonPid: number;
  version: string;
  startedAt: string;
  uptimeMs: number;
  processedExecutions: number;
  processedTasks: number;
  executedToday: number;
  lastRunAt: string | null;
  accel: boolean;
  accelUntil: string | null;
  fingerprint: string | null;
  leaderId: string;
  /**
   * 休眠窗口状态（daemon 侧 headless sleep-window；旧 daemon 无此字段 → undefined）：
   * 任务中心据此显示「窗口 ~45s」/「系统休眠中·已暂停」并说明休眠打断不计失败。
   */
  sleep?: {
    phase: "unknown" | "window" | "awake";
    windowStartedAtMs: number | null;
    sleepCycles: number;
    avgWindowMs: number;
    lastFrozenMs: number;
    lastWakeAtMs: number | null;
    sleepInterrupts: number;
    suspended: boolean;
    dispatchAllowed: boolean;
  } | null;
  /** 是否正持有「保持唤醒」（休眠窗口内收尾在途请求）。 */
  holdingSleep?: boolean;
  /** 本机是否具备保持唤醒能力（macOS）。 */
  sleepHoldAvailable?: boolean;
}

export async function readDaemonSelfState(
  socketPath: string,
  timeoutMs = 3000,
): Promise<DaemonSelfState | null> {
  try {
    const res = await schedulerPkg().sendSchedulerCommand(
      socketPath,
      "status",
      {},
      timeoutMs,
    );
    if (!res.ok || !res.result || typeof res.result !== "object") return null;
    const r = res.result as Record<string, unknown>;
    const pid = Number(r.daemonPid);
    if (!Number.isFinite(pid) || pid <= 0) return null;
    return {
      daemonPid: pid,
      version: String(r.version ?? ""),
      startedAt: String(r.startedAt ?? ""),
      uptimeMs: Number(r.uptimeMs ?? 0),
      processedExecutions: Number(r.processedExecutions ?? 0),
      processedTasks: Number(r.processedTasks ?? 0),
      executedToday: Number(r.executedToday ?? 0),
      lastRunAt: r.lastRunAt == null ? null : String(r.lastRunAt),
      accel: r.accel === true,
      accelUntil: r.accelUntil == null ? null : String(r.accelUntil),
      fingerprint: r.fingerprint == null ? null : String(r.fingerprint),
      leaderId: String(r.leaderId ?? "scheduler"),
    };
  } catch {
    return null;
  }
}

/** 要求 daemon 立即处理到期任务（runDue；daemon 不可达/旧版本 → false）。 */
export async function requestDaemonRunDue(socketPath: string): Promise<boolean> {
  try {
    const res = await schedulerPkg().sendSchedulerCommand(
      socketPath,
      "runDue",
      {},
      5000,
    );
    return res.ok === true;
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// watchdog：壳存续期间周期 ensure（启动失败/daemon 崩溃自动重试拉起）。
// 暂停（用户 daemonStop）时停；已有 daemon 时 ping 快路径，几乎零开销。
// ────────────────────────────────────────────────────────────────────────────

export interface WatchdogOptions {
  /** ensure 重试/健康检查周期（默认 20s）。 */
  intervalMs?: number;
  /** 每次 ensure 的等待窗口（默认 5s）。 */
  timeoutMs?: number;
  /** 用户暂停时返回 true（停止重试）。 */
  paused(): boolean;
  log?(msg: string): void;
}

/** 启动 watchdog；返回停止函数（应用退出/窗口销毁时调用）。 */
export function startSchedulerWatchdog(opts: WatchdogOptions): () => void {
  const intervalMs = opts.intervalMs ?? 20_000;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;

  const tick = async () => {
    if (opts.paused() || inFlight) return;
    inFlight = true;
    try {
      const cfg = resolveDaemonSpawnConfig();
      // 快路径：daemon 已在服务则仅更新状态为 ok（不 spawn）。
      if (await schedulerSocketUp(cfg.socketPath, 800)) {
        recordEnsureResult(true, null);
        return;
      }
      await ensureSchedulerDaemon({ timeoutMs: opts.timeoutMs ?? 5000, log: opts.log });
    } catch (err: any) {
      recordEnsureResult(false, err?.message || String(err));
    } finally {
      inFlight = false;
    }
  };

  // 先空跑一次（不重复冷启动的首次 ensure：由 index 负责第一次）。
  timer = setInterval(() => void tick(), intervalMs);
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}
